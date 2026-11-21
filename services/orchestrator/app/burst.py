"""Live outage / burst detection.

A ticket's signature = its most salient DISTINCTIVE content words. Words found in >= 1.5% of KB tickets
("data", "system", "medical", "security"...) are excluded (common_words.txt, built from kb_train only),
because the synthetic dataset reuses them across unrelated tickets and they caused false outages.
Only incident-like tickets get a signature (the pipeline decides), so requests never form outages.
Two tickets match when the words they share are rare enough: sum of IDF (from word_df.tsv, KB document
frequencies) >= BURST_MIN_SCORE. Sharing "vpn" (0.18% of tickets) is strong evidence, sharing "open" is weak.
If >= BURST_MIN *distinct* matching tickets arrive inside BURST_WINDOW_MIN, raise/extend a Major Incident. Identical re-submissions count once. An outage with no new matching
ticket for OUTAGE_TTL_MIN is stale: it is never joined again and the gateway auto-resolves it.
"""
from __future__ import annotations

import hashlib
import math
import os
import re
from collections import Counter

from sentinel_core.schemas import Outage, RetrieveResponse, TicketRecord, utcnow
from sentinel_core.store import Store, since_minutes

BURST_MIN = int(os.getenv("BURST_MIN", "3"))
BURST_WINDOW_MIN = float(os.getenv("BURST_WINDOW_MIN", "15"))
BURST_MIN_SCORE = float(os.getenv("BURST_MIN_SCORE", "12.0"))
OUTAGE_TTL_MIN = float(os.getenv("OUTAGE_TTL_MIN", "30"))

_COMMON_PATH = os.path.join(os.path.dirname(__file__), "common_words.txt")
try:
    with open(_COMMON_PATH, encoding="utf-8") as _f:
        COMMON = {w.strip() for w in _f if w.strip() and not w.startswith("#")}
except FileNotFoundError:  # detector still works, just less precise
    COMMON = set()

_DF: dict[str, int] = {}
_N_DOCS = 20000
try:
    with open(os.path.join(os.path.dirname(__file__), "word_df.tsv"), encoding="utf-8") as _f:
        for _line in _f:
            _w, _, _c = _line.rstrip("\n").partition("\t")
            if _w == "#n_docs":
                _N_DOCS = int(_c)
            elif _w and _c:
                _DF[_w] = int(_c)
except FileNotFoundError:
    pass


def idf(word: str) -> float:
    """log(N/df). Words never seen in the KB count as if seen in 3 tickets (rare but capped)."""
    return math.log(_N_DOCS / max(_DF.get(word, 3), 3))

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
    counts = Counter(w for w in words
                     if w not in _STOP and w not in COMMON and not w.isdigit() and not w.startswith("["))
    return [w for w, _ in counts.most_common(15)]


def is_stale(outage: Outage, now=None) -> bool:
    now = now or utcnow()
    return (now - outage.last_seen).total_seconds() > OUTAGE_TTL_MIN * 60


def match_score(a: set[str], b: set[str]) -> float:
    return sum(idf(w) for w in a & b)


def _matches(a: set[str], b: set[str]) -> bool:
    return match_score(a, b) >= BURST_MIN_SCORE


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
    if outage is not None and (outage.status != "active" or is_stale(outage)):
        outage = None
    if outage is None:
        shared = Counter(w for t in cluster for w in set(t.signature) & s)
        top = [w for w, _ in shared.most_common(4)]
        oid = "OUT-" + hashlib.sha1(" ".join(sorted(top[:2])).encode()).hexdigest()[:6].upper()
        outage = await store.get_outage(oid)
        if outage is None or outage.status != "active" or is_stale(outage):
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
