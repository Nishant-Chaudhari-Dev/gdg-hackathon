"""Tests for outage/burst detection (services/orchestrator/app/burst.py).
    python -m pytest eval/test_burst.py -q
Run on its own: every service's package is named `app`, so mixing service test files in one pytest
process can import the wrong `app`.
"""
import asyncio
import os
import sys
from datetime import timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "shared"))
sys.path.insert(0, os.path.join(ROOT, "services", "orchestrator"))
import app.burst as burst  # noqa: E402
from sentinel_core.schemas import Outage, TicketRecord, utcnow  # noqa: E402
from sentinel_core.store import MemoryStore  # noqa: E402

VPN = [
    ("VPN down for entire office", "Nobody in the Berlin office can connect to the VPN since 8am. Client says tunnel negotiation failed."),
    ("VPN nicht erreichbar", "Seit heute Morgen bricht die VPN Verbindung sofort ab, Tunnel negotiation failed. Alle Mitarbeiter betroffen."),
    ("Cannot connect to VPN", "VPN connection keeps failing with tunnel negotiation error, remote staff cannot work."),
    ("URGENT VPN outage", "Clinic staff lost VPN access, EMR and telemedicine unavailable. Tunnel negotiation failed repeatedly."),
]
# Real false alarms seen on the live site: unrelated tickets sharing generic dataset vocabulary.
MEDICAL = [
    ("Security Measures for Medical Data Protection", "We would like to discuss security measures for protecting medical data in our system."),
    ("Customer Support Regarding Data Breach", "Our healthcare organization reported a data breach affecting medical records in the system."),
    ("Unapproved Access Incidents on Medical Data Detected", "We detected unapproved access incidents on medical data in our system."),
    ("Concern Regarding Security Breach of Medical Information", "There is a concern regarding a security breach of medical information in our data system."),
]
MARKETING = [
    ("Concerns Over Digital Campaign Performance", "Our digital marketing campaign performance is poor, the agency strategies are not working."),
    ("Digital Marketing Strategy Question", "Which digital marketing strategies does your agency recommend for our campaign?"),
    ("Improve Digital Campaign", "We want to improve the digital campaign performance with new marketing strategies."),
]


async def _feed(tickets, store=None, preset_outage=None):
    store = store or MemoryStore()
    found = None
    for i, (s, b) in enumerate(tickets):
        tid = f"T{i}"
        await store.create_ticket(TicketRecord(id=tid, subject=s, body=b, outage_id=preset_outage))
        sig = burst.signature(s, b, None)
        await store.update_ticket(tid, {"signature": sig})
        found = await burst.detect(store, tid, sig, None) or found
    return found


def test_real_vpn_burst_is_detected_across_languages():
    o = asyncio.run(_feed(VPN))
    assert o is not None and o.count == 4 and "vpn" in o.signature


def test_generic_vocabulary_does_not_create_outages():
    assert asyncio.run(_feed(MEDICAL)) is None
    assert asyncio.run(_feed(MARKETING)) is None


def test_generic_words_excluded_from_signature():
    sig = burst.signature(*MEDICAL[0], None)
    assert not {"data", "medical", "security", "system"} & set(sig)


def test_identical_resubmissions_count_once():
    assert asyncio.run(_feed([VPN[0]] * 5)) is None


def test_stale_outage_is_not_rejoined():
    async def run():
        st = MemoryStore()
        await st.upsert_outage(Outage(id="OUT-OLD", title="old", signature=["vpn", "tunnel"], count=2))
        st._outages["OUT-OLD"].last_seen = utcnow() - timedelta(minutes=burst.OUTAGE_TTL_MIN + 5)
        return await _feed(VPN[:3], st, preset_outage="OUT-OLD")
    o = asyncio.run(run())
    assert o is not None and o.id != "OUT-OLD"
