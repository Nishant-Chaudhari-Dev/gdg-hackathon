"""SentinelDesk API gateway: public REST + SSE for the console; PII guardrail; publishes to the ticket bus."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field

from sentinel_core.http import ServiceClient
from sentinel_core.lang import detect_language
from sentinel_core.pii import mask
from sentinel_core.schemas import AuditEvent, Outage, PiiEntity, TicketMessage, TicketRecord, utcnow
from sentinel_core.store import FirestoreStore, MemoryStore, Store

from . import metrics, samples
from .bus import HttpBus, PubSubBus

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("gateway")

STORE_KIND = os.getenv("STORE", "memory")  # memory | firestore
BUS_KIND = os.getenv("BUS", "http")  # http | pubsub
ORCH_URL = os.getenv("ORCHESTRATOR_URL", "http://localhost:8003")
ML_URL = os.getenv("ML_URL", "http://localhost:8001")
RAG_URL = os.getenv("RAG_URL", "http://localhost:8002")
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "dev-token")
EVAL_REPORT_URI = os.getenv("EVAL_REPORT_URI", "eval/results/latest.json")
MAX_BODY_CHARS = int(os.getenv("MAX_BODY_CHARS", "8000"))
OUTAGE_TTL_MIN = float(os.getenv("OUTAGE_TTL_MIN", "30"))  # keep in sync with orchestrator burst.py

store: Store = FirestoreStore() if STORE_KIND == "firestore" else MemoryStore()
bus = PubSubBus(os.environ.get("GCP_PROJECT", ""), os.getenv("PUBSUB_TOPIC", "tickets")) if BUS_KIND == "pubsub" else HttpBus(ORCH_URL)


async def expire_stale_outages() -> int:
    """Auto-resolve active outages with no new matching ticket for OUTAGE_TTL_MIN (stops stale banners)."""
    n = 0
    now = utcnow()
    for o in await store.list_outages("active"):
        if (now - o.last_seen).total_seconds() > OUTAGE_TTL_MIN * 60:
            o.status = "resolved"
            await store.upsert_outage(o)
            await store.add_audit(AuditEvent(id=uuid.uuid4().hex, actor="system", action="outage:expired",
                                             details={"outage_id": o.id, "count": o.count,
                                                      "idle_minutes": round((now - o.last_seen).total_seconds() / 60, 1)}))
            n += 1
    return n


async def _expiry_loop() -> None:
    while True:
        try:
            await expire_stale_outages()
        except Exception as e:  # noqa: BLE001
            log.warning("outage expiry failed: %r", e)
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(_: FastAPI):
    log.info("gateway up: store=%s bus=%s", store.name, bus.name)
    task = asyncio.create_task(_expiry_loop())
    yield
    task.cancel()


app = FastAPI(title="SentinelDesk Gateway", version="0.1", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Ingest
# --------------------------------------------------------------------------- #
class TicketIn(BaseModel):
    subject: str | None = ""
    body: str = Field(min_length=1)
    operator: str | None = None
    source: str = "console"


async def ingest(subject: str | None, body: str, source: str, operator: str | None) -> TicketRecord:
    subject = (subject or "").strip()[:500]
    body = body.strip()[:MAX_BODY_CHARS]
    s_masked, s_counts = mask(subject)
    b_masked, b_counts = mask(body)
    counts: dict[str, int] = {}
    for c in (s_counts, b_counts):
        for k, v in c.items():
            counts[k] = counts.get(k, 0) + v
    lang = detect_language(f"{subject}\n{body}")
    rec = TicketRecord(
        id=f"LIVE-{uuid.uuid4().hex[:8].upper()}",
        source=source, operator=operator, subject=subject, body=body,
        subject_masked=s_masked, body_masked=b_masked, language=lang,
        pii_entities=[PiiEntity(type=k, count=v) for k, v in counts.items()],
    )
    await store.create_ticket(rec)
    if counts:
        await store.add_audit(AuditEvent(id=uuid.uuid4().hex, actor="pii-guardrail", action="pii_masked",
                                         ticket_id=rec.id, details=counts))
    await bus.publish(TicketMessage(ticket_id=rec.id, subject=s_masked, body=b_masked, language=lang,
                                    source=source, created_at=rec.created_at))
    return rec


async def wait_done(ticket_id: str, timeout: float = 45.0) -> TicketRecord | None:
    deadline = time.monotonic() + timeout
    rec = None
    while time.monotonic() < deadline:
        rec = await store.get_ticket(ticket_id)
        if rec and rec.status in ("done", "failed"):
            return rec
        await asyncio.sleep(0.25)
    return rec


@app.post("/api/tickets", response_model=TicketRecord)
async def create_ticket(t: TicketIn, wait: bool = False) -> TicketRecord:
    rec = await ingest(t.subject, t.body, t.source, t.operator)
    if wait:
        rec = await wait_done(rec.id) or rec
    return rec


@app.get("/api/tickets")
async def list_tickets(limit: int = Query(100, le=500), status: str | None = None) -> dict:
    return {"items": await store.list_tickets(limit, status)}


@app.get("/api/tickets/{ticket_id}", response_model=TicketRecord)
async def get_ticket(ticket_id: str) -> TicketRecord:
    rec = await store.get_ticket(ticket_id)
    if not rec:
        raise HTTPException(404, "ticket not found")
    return rec


# --------------------------------------------------------------------------- #
# Human-in-the-loop
# --------------------------------------------------------------------------- #
class ActionIn(BaseModel):
    action: Literal["approve", "edit", "reject", "acknowledge", "override"]
    reply: str | None = None
    override: dict[str, str] | None = None
    note: str | None = None
    operator: str | None = None


_STATE = {"approve": "approved", "edit": "edited", "reject": "rejected", "acknowledge": "acknowledged", "override": "overridden"}


@app.post("/api/tickets/{ticket_id}/actions", response_model=TicketRecord)
async def ticket_action(ticket_id: str, a: ActionIn) -> TicketRecord:
    rec = await store.get_ticket(ticket_id)
    if not rec:
        raise HTTPException(404, "ticket not found")
    human: dict[str, Any] = {"state": _STATE[a.action], "by": a.operator or "operator", "at": utcnow().isoformat(), "note": a.note}
    if a.action == "approve":
        human["final_reply"] = a.reply or (rec.draft.reply if rec.draft else None)
    elif a.action == "edit":
        if not a.reply:
            raise HTTPException(422, "reply required for edit")
        human["final_reply"] = a.reply
    elif a.action == "override":
        if not a.override:
            raise HTTPException(422, "override required")
        human["override"] = a.override
    updated = await store.update_ticket(ticket_id, {"human": human})
    await store.add_audit(AuditEvent(id=uuid.uuid4().hex, actor=a.operator or "operator", action=f"human:{a.action}",
                                     ticket_id=ticket_id, details={k: v for k, v in a.model_dump().items() if v and k != "operator"}))
    return updated  # type: ignore[return-value]


# --------------------------------------------------------------------------- #
# Outages, audit, metrics, eval, system
# --------------------------------------------------------------------------- #
@app.get("/api/outages")
async def list_outages(status: str | None = None) -> dict:
    await expire_stale_outages()
    return {"items": await store.list_outages(status)}


class ResolveIn(BaseModel):
    operator: str | None = None


@app.post("/api/outages/{outage_id}/resolve", response_model=Outage)
async def resolve_outage(outage_id: str, body: ResolveIn | None = None) -> Outage:
    o = await store.get_outage(outage_id)
    if not o:
        raise HTTPException(404, "outage not found")
    o.status = "resolved"
    o = await store.upsert_outage(o)
    await store.add_audit(AuditEvent(id=uuid.uuid4().hex, actor=(body.operator if body else None) or "operator",
                                     action="outage:resolved", details={"outage_id": outage_id, "count": o.count}))
    return o


@app.get("/api/audit")
async def list_audit(limit: int = Query(200, le=1000)) -> dict:
    return {"items": await store.list_audit(limit)}


@app.get("/api/metrics")
async def get_metrics() -> dict:
    await expire_stale_outages()
    tickets, outages = await asyncio.gather(store.list_tickets(500), store.list_outages())
    return metrics.compute(tickets, outages)


@app.get("/api/eval")
async def get_eval() -> dict:
    try:
        if EVAL_REPORT_URI.startswith("gs://"):
            from google.cloud import storage  # type: ignore

            bucket, _, path = EVAL_REPORT_URI[5:].partition("/")
            text = await asyncio.to_thread(lambda: storage.Client().bucket(bucket).blob(path).download_as_text())
        else:
            with open(EVAL_REPORT_URI, encoding="utf-8") as f:
                text = f.read()
        return json.loads(text)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(404, f"no eval report yet ({e.__class__.__name__})") from e


NOTIFIER_URL = os.getenv("NOTIFIER_URL", "").strip()
_health_clients = {n: ServiceClient(u, timeout=5) for n, u in (("orchestrator", ORCH_URL), ("ml", ML_URL), ("rag", RAG_URL),
                                                               ("notifier", NOTIFIER_URL)) if u}


@app.get("/api/system")
async def system() -> dict:
    async def ping(name: str, c: ServiceClient) -> dict:
        t = time.perf_counter()
        try:
            info = await c.get("/health")
            return {"name": name, "url": c.base_url, "ok": True, "latency_ms": round((time.perf_counter() - t) * 1000, 1), "info": info}
        except Exception as e:  # noqa: BLE001
            return {"name": name, "url": c.base_url, "ok": False, "latency_ms": None, "error": repr(e)[:200]}

    services = await asyncio.gather(*(ping(n, c) for n, c in _health_clients.items()))
    gw = {"name": "gateway", "url": "self", "ok": True, "latency_ms": 0, "info": {"store": store.name, "bus": bus.name}}
    return {"mode": "gcp" if STORE_KIND == "firestore" else "local", "store": store.name, "bus": bus.name,
            "services": [gw, *services]}


@app.get("/api/samples")
def get_samples() -> dict:
    return {"items": samples.SAMPLES}


class SimulateIn(BaseModel):
    scenario: Literal["mixed", "outage", "german", "adversarial"] = "mixed"
    count: int = Field(8, ge=1, le=100)
    interval_ms: int = Field(600, ge=0, le=10_000)


@app.post("/api/simulate")
async def simulate(s: SimulateIn) -> dict:
    items = samples.scenario(s.scenario, s.count)

    async def run() -> None:
        for subj, body in items:
            try:
                await ingest(subj, body, "simulator", "simulator")
            except Exception as e:  # noqa: BLE001
                log.error("simulate ingest failed: %r", e)
            await asyncio.sleep(s.interval_ms / 1000)

    task = asyncio.create_task(run())
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return {"started": len(items), "scenario": s.scenario}


_bg_tasks: set[asyncio.Task] = set()


# --------------------------------------------------------------------------- #
# Server-Sent Events
# --------------------------------------------------------------------------- #
@app.get("/api/events")
async def events(request: Request) -> StreamingResponse:
    q: asyncio.Queue = asyncio.Queue(maxsize=1000)

    async def pump() -> None:
        async for kind, obj in store.watch():
            await q.put((kind, obj))

    async def gen():
        task = asyncio.create_task(pump())
        try:
            yield "retry: 3000\n\n"
            while not await request.is_disconnected():
                try:
                    kind, obj = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"event: {kind}\ndata: {obj.model_dump_json()}\n\n"
                except asyncio.TimeoutError:
                    yield f"event: ping\ndata: {json.dumps({'ts': utcnow().isoformat()})}\n\n"
        finally:
            task.cancel()

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    """The gateway is an API; send people who open the bare URL to the interactive docs."""
    return RedirectResponse("/docs")


@app.get("/healthz")  # local; Cloud Run reserves paths ending in "z"
@app.get("/health")
def healthz() -> dict:
    return {"service": "gateway", "version": "0.1", "ready": True, "details": {"store": store.name, "bus": bus.name}}


# --------------------------------------------------------------------------- #
# Internal store API (LOCAL_MODE only: lets the orchestrator share the gateway's memory store)
# --------------------------------------------------------------------------- #
def _internal(x_internal_token: str = Header("")) -> None:
    if STORE_KIND != "memory" or x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(403, "forbidden")


@app.get("/internal/tickets/{ticket_id}", dependencies=[Depends(_internal)])
async def i_get_ticket(ticket_id: str):
    rec = await store.get_ticket(ticket_id)
    if not rec:
        raise HTTPException(404)
    return rec


@app.patch("/internal/tickets/{ticket_id}", dependencies=[Depends(_internal)])
async def i_patch_ticket(ticket_id: str, patch: dict[str, Any]):
    rec = await store.update_ticket(ticket_id, patch)
    if not rec:
        raise HTTPException(404)
    return rec


@app.get("/internal/tickets", dependencies=[Depends(_internal)])
async def i_recent(since: datetime):
    return await store.recent_tickets(since)


@app.get("/internal/outages/{outage_id}", dependencies=[Depends(_internal)])
async def i_get_outage(outage_id: str):
    o = await store.get_outage(outage_id)
    if not o:
        raise HTTPException(404)
    return o


@app.put("/internal/outages/{outage_id}", dependencies=[Depends(_internal)])
async def i_put_outage(outage_id: str, o: Outage):
    return await store.upsert_outage(o)


@app.get("/internal/outages", dependencies=[Depends(_internal)])
async def i_list_outages(status: str | None = None):
    return await store.list_outages(status)


@app.post("/internal/audit", dependencies=[Depends(_internal)])
async def i_audit(ev: AuditEvent):
    await store.add_audit(ev)
    return {"ok": True}
