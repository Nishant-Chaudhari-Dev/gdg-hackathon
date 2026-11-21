"""Live outage / burst detection.

A ticket's signature = its most salient content words (precedent tags are too generic in this dataset).
If >= BURST_MIN *distinct* incident-like tickets inside BURST_WINDOW_MIN share >= BURST_MIN_SHARED
signature terms, raise/extend a Major Incident. Identical re-submissions count once.
"""
from __future__ import annotations

import hashlib
import os
import re
from collections import Counter

from sentinel_core.schemas import Outage, RetrieveResponse, TicketRecord, utcnow
from sentinel_core.store import Store, since_minutes

BURST_MIN = int(os.getenv("BURST_MIN", "3"))
BURST_WINDOW_MIN = float(os.getenv("BURST_WINDOW_MIN", "15"))
BURST_MIN_SHARED = int(os.getenv("BURST_MIN_SHARED", "3"))

_STOP = set(
    """the and for with that this have has are was were you your our ours from not but can cannot cant unable
    please help hello dear thanks thank regards since today now still again issue issues problem problems
    error errors need would could should will just also any all some get got working work works does did
    customer support team hi there when what which who how why been being into about after before very
    der die das und ist nicht mit wir ich sie bitte hallo danke seit heute noch problem fehler können kann
    unser unsere unseren eine einer einen ein den dem des auf für von bei wird werden haben hat sind auch
    mehr kein keine grüße freundlichen dass wie was wenn oder aber nach sehr geehrte geehrter geehrtes damen
    herren nich liebe lieber mfg best kind sincerely dear wir uns ihr ihre ihnen dear assistance thank""".split()
)
_WORD = re.compile(r"[a-zA-ZäöüÄÖÜß0-9][\w\-]{2,}")


def signature(subject: str, body: str, ret: RetrieveResponse | None) -> list[str]:
    words = [w.lower() for w in _WORD.findall(f"{subject} {subject} {body}")]
    counts = Counter(w for w in words if w not in _STOP and not w.isdigit() and not w.startswith("["))
    return [w for w, _ in counts.most_common(10)]


def _matches(a: set[str], b: set[str]) -> bool:
    return len(a & b) >= BURST_MIN_SHARED


async def detect(store: Store, rec_id: str, sig: list[str], queue: str | None) -> Outage | None:
    if not sig:
        return None
    s = set(sig)
    recent: list[TicketRecord] = await store.recent_tickets(since_minutes(BURST_WINDOW_MIN))
    cluster = [t for t in recent if t.id != rec_id and t.signature and _matches(s, set(t.signature))]
    distinct = {frozenset(t.signature) for t in cluster} - {frozenset(sig)}
    if len(distinct) + 1 < BURST_MIN:
        return None

    # Join an existing active outage if any member already belongs to one.
    existing_id = next((t.outage_id for t in cluster if t.outage_id), None)
    outage = await store.get_outage(existing_id) if existing_id else None
    if outage is None or outage.status != "active":
        shared = Counter(w for t in cluster for w in set(t.signature) & s)
        top = [w for w, _ in shared.most_common(4)]
        oid = "OUT-" + hashlib.sha1(" ".join(sorted(top[:2])).encode()).hexdigest()[:6].upper()
        outage = await store.get_outage(oid)
        if outage is None or outage.status != "active":
            outage = Outage(
                id=oid,
                title=f"Possible major incident: {' / '.join(w.upper() if len(w) <= 4 else w.title() for w in top[:3])}",
                signature=top,
                queue=queue,
                ticket_ids=[t.id for t in cluster],
                first_seen=min(t.created_at for t in cluster),
            )
    ids = list(dict.fromkeys([*outage.ticket_ids, *[t.id for t in cluster], rec_id]))
    outage.ticket_ids = ids
    outage.count = len(ids)
    outage.last_seen = utcnow()
    return await store.upsert_outage(outage)
