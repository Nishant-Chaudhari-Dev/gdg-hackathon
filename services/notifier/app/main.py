"""Notifier: pages the on-call engineer when the orchestrator raises an AlertEvent.

Cloud: Pub/Sub topic `alerts` -> push subscription -> POST /pubsub/push
Local: orchestrator -> POST /notify

Delivery is an ntfy push notification (https://ntfy.sh): free, no account, instant on the phone's
ntfy app. The topic name is the only secret: anyone who knows it can read the alerts, so it is
random, kept out of git (NTFY_TOPIC env), and only PII-masked text is ever sent.

Spam protection: at most one push per ALERT_COOLDOWN_S (default 300 s) and ALERT_DAILY_CAP (default 20)
per UTC day. Alerts held back are counted and reported as "+N more" in the next push.
State is in memory; deploy with --max-instances 1 so one instance owns the counters.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, Header, HTTPException, Request, Response

from sentinel_core.schemas import AlertEvent, AuditEvent, PagingInfo, ServiceInfo
from sentinel_core.store import FirestoreStore, RemoteStore, Store

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("notifier")
VERSION = "notifier-0.1"

NTFY_SERVER = os.getenv("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "").strip()
CONSOLE_URL = os.getenv("CONSOLE_URL", "").rstrip("/")
COOLDOWN_S = float(os.getenv("ALERT_COOLDOWN_S", "300"))
DAILY_CAP = int(os.getenv("ALERT_DAILY_CAP", "20"))
DRY_RUN = os.getenv("ALERTS_DRY_RUN", "0") == "1"
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "dev-token")


def _make_store() -> Store:
    if os.getenv("STORE", "remote") == "firestore":
        return FirestoreStore()
    return RemoteStore(os.getenv("GATEWAY_URL", "http://localhost:8080"), INTERNAL_TOKEN)


class RateLimiter:
    def __init__(self, cooldown_s: float, daily_cap: int) -> None:
        self.cooldown_s, self.daily_cap = cooldown_s, daily_cap
        self.last_sent: float | None = None
        self.day = ""
        self.sent_today = 0
        self.suppressed = 0  # held back since the last successful push

    def check(self, now: float | None = None) -> str:
        """'ok' | 'cooldown' | 'daily_cap'. Does not record anything."""
        now = time.time() if now is None else now
        day = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d")
        if day != self.day:
            self.day, self.sent_today = day, 0
        if self.sent_today >= self.daily_cap:
            return "daily_cap"
        if self.last_sent is not None and now - self.last_sent < self.cooldown_s:
            return "cooldown"
        return "ok"

    def record_sent(self, now: float | None = None) -> int:
        """Record a push; returns how many alerts were held back before it (and resets that count)."""
        self.last_sent = time.time() if now is None else now
        self.sent_today += 1
        held, self.suppressed = self.suppressed, 0
        return held

    def record_suppressed(self) -> None:
        self.suppressed += 1


def build_push(ev: AlertEvent, held_back: int) -> dict:
    kw = ", ".join(ev.keywords[:3])
    lines = [f"{ev.ticket_id} · {ev.priority or '?'} priority · {ev.queue or 'unrouted'}"]
    if ev.subject:
        lines.append(f"“{ev.subject}”")
    if ev.snippet:
        lines.append(ev.snippet)
    if ev.outage_id:
        lines.append(f"Part of major incident {ev.outage_id}")
    if held_back:
        lines.append(f"+{held_back} more critical alert(s) held back by rate limit since the last page")
    push = {
        "topic": NTFY_TOPIC,
        "title": f"🚨 SentinelDesk on-call: {kw}",
        "message": "\n".join(lines)[:900],
        "priority": 5,
        "tags": ["rotating_light", "sentineldesk"],
    }
    if CONSOLE_URL:
        push["click"] = f"{CONSOLE_URL}/queue?ticket={ev.ticket_id}"
    return push


store = _make_store()
limiter = RateLimiter(COOLDOWN_S, DAILY_CAP)
_http = httpx.AsyncClient(timeout=10)
app = FastAPI(title="SentinelDesk notifier")


async def _send(push: dict) -> None:
    if DRY_RUN:
        log.info("DRY RUN push: %s", json.dumps(push, ensure_ascii=False))
        return
    if not NTFY_TOPIC:
        raise RuntimeError("NTFY_TOPIC not configured")
    r = await _http.post(NTFY_SERVER, json=push)
    r.raise_for_status()


async def _record(ev: AlertEvent, state: str, detail: str | None) -> None:
    info = PagingInfo(state=state, keywords=ev.keywords, detail=detail)
    try:
        await store.update_ticket(ev.ticket_id, {"paging": info.model_dump(mode="json")})
        await store.add_audit(AuditEvent(id=uuid.uuid4().hex, actor="notifier", action=f"oncall:{state}",
                                         ticket_id=ev.ticket_id, details={"keywords": ev.keywords, "detail": detail}))
    except Exception as e:  # noqa: BLE001 - never lose the page because bookkeeping failed
        log.warning("could not record paging for %s: %r", ev.ticket_id, e)


async def handle(ev: AlertEvent) -> dict:
    verdict = limiter.check()
    if verdict != "ok":
        limiter.record_suppressed()
        detail = "held back: one page per %ds" % COOLDOWN_S if verdict == "cooldown" else f"daily cap of {DAILY_CAP} reached"
        await _record(ev, "rate_limited", detail)
        return {"state": "rate_limited", "reason": verdict}
    push = build_push(ev, limiter.suppressed)
    try:
        await _send(push)
    except Exception as e:  # noqa: BLE001
        await _record(ev, "failed", repr(e)[:200])
        raise
    held = limiter.record_sent()
    await _record(ev, "sent", f"push to ntfy{' (dry run)' if DRY_RUN else ''}" + (f"; +{held} held back" if held else ""))
    return {"state": "sent", "held_back": held}


@app.get("/healthz", response_model=ServiceInfo)  # local; Cloud Run reserves paths ending in "z"
@app.get("/health", response_model=ServiceInfo)
def health() -> ServiceInfo:
    return ServiceInfo(service="notifier", version=VERSION, ready=bool(NTFY_TOPIC) or DRY_RUN, details={
        "channel": "ntfy", "topic_configured": bool(NTFY_TOPIC), "dry_run": DRY_RUN,
        "cooldown_s": COOLDOWN_S, "daily_cap": DAILY_CAP, "sent_today": limiter.sent_today,
        "held_back": limiter.suppressed, "store": store.name,
    })


@app.post("/notify")
async def notify(ev: AlertEvent) -> dict:
    """LOCAL_MODE path (orchestrator calls directly instead of Pub/Sub)."""
    try:
        return await handle(ev)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"push failed: {e!r}") from e


@app.post("/pubsub/push", status_code=204)
async def pubsub_push(request: Request) -> Response:
    envelope = await request.json()
    try:
        ev = AlertEvent.model_validate(json.loads(base64.b64decode(envelope["message"]["data"]).decode()))
    except Exception as e:  # malformed -> ack so it is not redelivered forever
        log.error("bad alert message: %r", e)
        return Response(status_code=204)
    try:
        await handle(ev)
    except Exception as e:  # delivery failure -> 500 so Pub/Sub retries (then dead-letters)
        log.error("push failed for %s: %r", ev.ticket_id, e)
        raise HTTPException(500, "push failed") from e
    return Response(status_code=204)


@app.post("/test")
async def test_push(x_internal_token: str = Header("")) -> dict:
    """Send one test push (bypasses the rate limiter). Requires the internal token."""
    if x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(403, "forbidden")
    await _send({"topic": NTFY_TOPIC, "title": "✅ SentinelDesk on-call test",
                 "message": "Paging works. Critical escalations will arrive here.", "priority": 4,
                 "tags": ["white_check_mark", "sentineldesk"]})
    return {"sent": True, "dry_run": DRY_RUN}
