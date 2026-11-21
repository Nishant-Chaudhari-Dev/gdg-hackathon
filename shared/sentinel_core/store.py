"""Persistence + change feed.

Backends
  MemoryStore    - gateway in LOCAL_MODE (single process, asyncio broadcast for SSE)
  FirestoreStore - cloud; shared by gateway + orchestrator instances; SSE via polling updated_at
  RemoteStore    - orchestrator in LOCAL_MODE; proxies to the gateway's /internal API

Convention: `patch` dicts passed to update_ticket are JSON-mode (model_dump(mode="json")) values.
The store always stamps updated_at itself.
"""
from __future__ import annotations

import asyncio
import os
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Protocol

from .schemas import AuditEvent, Outage, TicketRecord, utcnow

Event = tuple[str, Any]  # ("ticket"|"outage"|"audit", model)


class Store(Protocol):
    name: str

    async def create_ticket(self, rec: TicketRecord) -> TicketRecord: ...
    async def get_ticket(self, ticket_id: str) -> TicketRecord | None: ...
    async def update_ticket(self, ticket_id: str, patch: dict[str, Any]) -> TicketRecord | None: ...
    async def list_tickets(self, limit: int = 100, status: str | None = None) -> list[TicketRecord]: ...
    async def recent_tickets(self, since: datetime) -> list[TicketRecord]: ...
    async def get_outage(self, outage_id: str) -> Outage | None: ...
    async def upsert_outage(self, outage: Outage) -> Outage: ...
    async def list_outages(self, status: str | None = None) -> list[Outage]: ...
    async def add_audit(self, ev: AuditEvent) -> None: ...
    async def list_audit(self, limit: int = 200) -> list[AuditEvent]: ...
    def watch(self) -> AsyncIterator[Event]: ...


def _merge(base: dict, patch: dict) -> dict:
    out = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict) and k == "human":
            out[k] = {**out[k], **v}
        else:
            out[k] = v
    return out


# --------------------------------------------------------------------------- #
class MemoryStore:
    name = "memory"

    def __init__(self, max_tickets: int = 5000) -> None:
        self._tickets: OrderedDict[str, TicketRecord] = OrderedDict()
        self._outages: dict[str, Outage] = {}
        self._audit: list[AuditEvent] = []
        self._subs: set[asyncio.Queue[Event]] = set()
        self._max = max_tickets

    def _emit(self, kind: str, obj: Any) -> None:
        for q in list(self._subs):
            try:
                q.put_nowait((kind, obj))
            except asyncio.QueueFull:
                pass

    async def create_ticket(self, rec: TicketRecord) -> TicketRecord:
        self._tickets[rec.id] = rec
        while len(self._tickets) > self._max:
            self._tickets.popitem(last=False)
        self._emit("ticket", rec)
        return rec

    async def get_ticket(self, ticket_id: str) -> TicketRecord | None:
        return self._tickets.get(ticket_id)

    async def update_ticket(self, ticket_id: str, patch: dict[str, Any]) -> TicketRecord | None:
        cur = self._tickets.get(ticket_id)
        if cur is None:
            return None
        data = _merge(cur.model_dump(mode="json"), patch)
        data["updated_at"] = utcnow().isoformat()
        rec = TicketRecord.model_validate(data)
        self._tickets[ticket_id] = rec
        self._emit("ticket", rec)
        return rec

    async def list_tickets(self, limit: int = 100, status: str | None = None) -> list[TicketRecord]:
        items = [t for t in reversed(self._tickets.values()) if status is None or t.status == status]
        return items[:limit]

    async def recent_tickets(self, since: datetime) -> list[TicketRecord]:
        return [t for t in self._tickets.values() if t.created_at >= since]

    async def get_outage(self, outage_id: str) -> Outage | None:
        return self._outages.get(outage_id)

    async def upsert_outage(self, outage: Outage) -> Outage:
        outage.updated_at = utcnow()
        self._outages[outage.id] = outage
        self._emit("outage", outage)
        return outage

    async def list_outages(self, status: str | None = None) -> list[Outage]:
        items = sorted(self._outages.values(), key=lambda o: o.last_seen, reverse=True)
        return [o for o in items if status is None or o.status == status]

    async def add_audit(self, ev: AuditEvent) -> None:
        self._audit.append(ev)
        self._audit = self._audit[-5000:]
        self._emit("audit", ev)

    async def list_audit(self, limit: int = 200) -> list[AuditEvent]:
        return list(reversed(self._audit))[:limit]

    async def watch(self) -> AsyncIterator[Event]:
        q: asyncio.Queue[Event] = asyncio.Queue(maxsize=1000)
        self._subs.add(q)
        try:
            while True:
                yield await q.get()
        finally:
            self._subs.discard(q)


# --------------------------------------------------------------------------- #
class FirestoreStore:
    name = "firestore"

    def __init__(self, project: str | None = None, prefix: str = "") -> None:
        from google.cloud import firestore  # type: ignore

        self._fs = firestore
        self._db = firestore.AsyncClient(project=project or os.getenv("GCP_PROJECT"))
        self._t = self._db.collection(f"{prefix}tickets")
        self._o = self._db.collection(f"{prefix}outages")
        self._a = self._db.collection(f"{prefix}audit")

    def _filter(self, field: str, op: str, value: Any):
        from google.cloud.firestore_v1.base_query import FieldFilter  # type: ignore

        return FieldFilter(field, op, value)

    async def create_ticket(self, rec: TicketRecord) -> TicketRecord:
        await self._t.document(rec.id).set(rec.model_dump())
        return rec

    async def get_ticket(self, ticket_id: str) -> TicketRecord | None:
        snap = await self._t.document(ticket_id).get()
        return TicketRecord.model_validate(snap.to_dict()) if snap.exists else None

    async def update_ticket(self, ticket_id: str, patch: dict[str, Any]) -> TicketRecord | None:
        ref = self._t.document(ticket_id)
        flat: dict[str, Any] = {}
        for k, v in patch.items():
            if k == "human" and isinstance(v, dict):
                flat.update({f"human.{hk}": hv for hk, hv in v.items()})
            else:
                flat[k] = v
        flat["updated_at"] = utcnow()
        await ref.update(flat)
        return await self.get_ticket(ticket_id)

    async def list_tickets(self, limit: int = 100, status: str | None = None) -> list[TicketRecord]:
        q = self._t.order_by("created_at", direction=self._fs.Query.DESCENDING).limit(limit if not status else limit * 4)
        items = [TicketRecord.model_validate(d.to_dict()) async for d in q.stream()]
        return [t for t in items if status is None or t.status == status][:limit]

    async def recent_tickets(self, since: datetime) -> list[TicketRecord]:
        q = self._t.where(filter=self._filter("created_at", ">=", since)).limit(500)
        return [TicketRecord.model_validate(d.to_dict()) async for d in q.stream()]

    async def get_outage(self, outage_id: str) -> Outage | None:
        snap = await self._o.document(outage_id).get()
        return Outage.model_validate(snap.to_dict()) if snap.exists else None

    async def upsert_outage(self, outage: Outage) -> Outage:
        outage.updated_at = utcnow()
        await self._o.document(outage.id).set(outage.model_dump())
        return outage

    async def list_outages(self, status: str | None = None) -> list[Outage]:
        items = [Outage.model_validate(d.to_dict()) async for d in self._o.limit(200).stream()]
        items.sort(key=lambda o: o.last_seen, reverse=True)
        return [o for o in items if status is None or o.status == status]

    async def add_audit(self, ev: AuditEvent) -> None:
        await self._a.document(ev.id).set(ev.model_dump())

    async def list_audit(self, limit: int = 200) -> list[AuditEvent]:
        q = self._a.order_by("ts", direction=self._fs.Query.DESCENDING).limit(limit)
        return [AuditEvent.model_validate(d.to_dict()) async for d in q.stream()]

    async def watch(self) -> AsyncIterator[Event]:
        """Poll-based change feed (robust on Cloud Run, no background threads needed)."""
        cursor = {"t": utcnow(), "o": utcnow(), "a": utcnow()}
        interval = float(os.getenv("WATCH_INTERVAL_S", "1.0"))
        while True:
            for key, coll, field, model, kind in (
                ("t", self._t, "updated_at", TicketRecord, "ticket"),
                ("o", self._o, "updated_at", Outage, "outage"),
                ("a", self._a, "ts", AuditEvent, "audit"),
            ):
                q = coll.where(filter=self._filter(field, ">", cursor[key])).order_by(field).limit(100)
                async for d in q.stream():
                    obj = model.model_validate(d.to_dict())
                    cursor[key] = max(cursor[key], getattr(obj, field))
                    yield kind, obj
            await asyncio.sleep(interval)


# --------------------------------------------------------------------------- #
class RemoteStore:
    """Orchestrator-side store in LOCAL_MODE: talks to gateway /internal endpoints."""

    name = "remote"

    def __init__(self, base_url: str, token: str) -> None:
        import httpx

        self._c = httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=10, headers={"X-Internal-Token": token})

    async def _json(self, method: str, path: str, **kw) -> Any:
        r = await self._c.request(method, path, **kw)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json() if r.content else None

    async def create_ticket(self, rec: TicketRecord) -> TicketRecord:
        raise NotImplementedError

    async def get_ticket(self, ticket_id: str) -> TicketRecord | None:
        d = await self._json("GET", f"/internal/tickets/{ticket_id}")
        return TicketRecord.model_validate(d) if d else None

    async def update_ticket(self, ticket_id: str, patch: dict[str, Any]) -> TicketRecord | None:
        d = await self._json("PATCH", f"/internal/tickets/{ticket_id}", json=patch)
        return TicketRecord.model_validate(d) if d else None

    async def list_tickets(self, limit: int = 100, status: str | None = None) -> list[TicketRecord]:
        raise NotImplementedError

    async def recent_tickets(self, since: datetime) -> list[TicketRecord]:
        d = await self._json("GET", "/internal/tickets", params={"since": since.isoformat()})
        return [TicketRecord.model_validate(x) for x in d or []]

    async def get_outage(self, outage_id: str) -> Outage | None:
        d = await self._json("GET", f"/internal/outages/{outage_id}")
        return Outage.model_validate(d) if d else None

    async def upsert_outage(self, outage: Outage) -> Outage:
        d = await self._json("PUT", f"/internal/outages/{outage.id}", json=outage.model_dump(mode="json"))
        return Outage.model_validate(d)

    async def list_outages(self, status: str | None = None) -> list[Outage]:
        d = await self._json("GET", "/internal/outages", params={"status": status} if status else None)
        return [Outage.model_validate(x) for x in d or []]

    async def add_audit(self, ev: AuditEvent) -> None:
        await self._json("POST", "/internal/audit", json=ev.model_dump(mode="json"))

    async def list_audit(self, limit: int = 200) -> list[AuditEvent]:
        raise NotImplementedError

    async def watch(self) -> AsyncIterator[Event]:  # pragma: no cover
        raise NotImplementedError
        yield  # noqa


def since_minutes(minutes: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)
