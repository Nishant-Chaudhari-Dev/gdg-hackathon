"""Triage pipeline: classify || retrieve -> burst -> gate -> draft -> gate -> persist."""
from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from typing import Any, Awaitable, Callable

from sentinel_core.http import ServiceClient
from sentinel_core.schemas import (
    AuditEvent,
    Classification,
    ClassifyRequest,
    DraftRequest,
    DraftResponse,
    RetrieveRequest,
    RetrieveResponse,
    TicketMessage,
    utcnow,
)
from sentinel_core.store import Store

from . import burst, gate

log = logging.getLogger("orchestrator")

ML_URL = os.getenv("ML_URL", "http://localhost:8001")
RAG_URL = os.getenv("RAG_URL", "http://localhost:8002")
TOP_K = int(os.getenv("TOP_K", "5"))

ml = ServiceClient(ML_URL, timeout=float(os.getenv("ML_TIMEOUT_S", "10")))
rag = ServiceClient(RAG_URL, timeout=float(os.getenv("RAG_TIMEOUT_S", "30")))


async def _timed(fn: Callable[[], Awaitable[Any]]) -> tuple[Any, float, Exception | None]:
    t = time.perf_counter()
    try:
        return await fn(), (time.perf_counter() - t) * 1000, None
    except Exception as e:  # noqa: BLE001 - degrade, never crash the pipeline
        log.warning("downstream call failed: %r", e)
        return None, (time.perf_counter() - t) * 1000, e


async def process(store: Store, msg: TicketMessage) -> dict:
    existing = await store.get_ticket(msg.ticket_id)
    if existing and existing.status == "done":
        return {"skipped": "already processed"}

    t0 = time.perf_counter()
    queue_ms = max((utcnow() - msg.created_at).total_seconds() * 1000, 0.0)
    await store.update_ticket(msg.ticket_id, {"status": "processing"})

    creq = ClassifyRequest(subject=msg.subject, body=msg.body, language=msg.language)
    rreq = RetrieveRequest(subject=msg.subject, body=msg.body, language=msg.language, k=TOP_K)
    (cls_raw, cls_ms, cls_err), (ret_raw, ret_ms, ret_err) = await asyncio.gather(
        _timed(lambda: ml.post("/classify", creq.model_dump())),
        _timed(lambda: rag.post("/retrieve", rreq.model_dump())),
    )
    cls = Classification.model_validate(cls_raw) if cls_raw else None
    ret = RetrieveResponse.model_validate(ret_raw) if ret_raw else None
    degraded = [n for n, e in (("ml-service", cls_err), ("rag-retrieval", ret_err)) if e]

    tg = time.perf_counter()
    sig = burst.signature(msg.subject, msg.body, ret)
    outage = None
    try:
        # Publish signature early so concurrent tickets in a burst can see each other.
        await store.update_ticket(msg.ticket_id, {"signature": sig})
        incident_like = cls is None or cls.type.label in ("Incident", "Problem") or cls.priority.label in ("high", "critical")
        if incident_like:
            outage = await burst.detect(store, msg.ticket_id, sig, cls.queue.label if cls else None)
    except Exception as e:  # noqa: BLE001
        log.warning("burst detection failed: %r", e)
    text = f"{msg.subject}\n{msg.body}"
    reasons, allow_draft = gate.pre_draft(text, cls, ret, outage.id if outage else None, degraded)
    gate_ms = (time.perf_counter() - tg) * 1000

    draft: DraftResponse | None = None
    draft_ms = 0.0
    if allow_draft and ret is not None:
        dreq = DraftRequest(subject=msg.subject, body=msg.body, language=msg.language, hits=ret.hits, classification=cls)
        d_raw, draft_ms, d_err = await _timed(lambda: rag.post("/draft", dreq.model_dump(mode="json")))
        if d_err:
            reasons += gate.pre_draft("", None, None, None, ["rag-generation"])[0]
        else:
            draft = DraftResponse.model_validate(d_raw)
            reasons += gate.post_draft(draft)

    decision = gate.decide(reasons)
    total_ms = (time.perf_counter() - t0) * 1000
    timings = {"queue": queue_ms, "classify": cls_ms, "retrieve": ret_ms, "gate": gate_ms, "draft": draft_ms, "total": total_ms}
    patch = {
        "status": "done",
        "classification": cls.model_dump(mode="json") if cls else None,
        "retrieval": ret.model_dump(mode="json") if ret else None,
        "draft": draft.model_dump(mode="json") if draft else None,
        "decision": decision.model_dump(mode="json"),
        "signature": sig,
        "outage_id": outage.id if outage else None,
        "timings_ms": {k: round(v, 1) for k, v in timings.items()},
        "latency_ms": round(queue_ms + total_ms, 1),
        "error": "; ".join(f"{n}: {e}" for n, e in (("ml", cls_err), ("rag", ret_err)) if e) or None,
    }
    await store.update_ticket(msg.ticket_id, patch)
    await store.add_audit(AuditEvent(
        id=uuid.uuid4().hex, actor="orchestrator", action=f"triaged:{decision.action}", ticket_id=msg.ticket_id,
        details={"reasons": [r.code for r in decision.reasons], "latency_ms": patch["latency_ms"]},
    ))
    return {"ticket_id": msg.ticket_id, "action": decision.action}
