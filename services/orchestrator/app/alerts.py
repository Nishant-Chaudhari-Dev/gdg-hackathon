"""On-call paging trigger: an ESCALATED ticket that mentions a critical keyword raises an AlertEvent.

The keyword list is hardcoded on purpose (product decision): obvious "the system is broken" wording,
English + German. The notifier service decides delivery, rate limiting and the daily cap.

Transport
  ALERTS_TOPIC set (cloud)   -> Pub/Sub topic (push subscription -> notifier /pubsub/push)
  NOTIFIER_URL set (local)   -> POST {NOTIFIER_URL}/notify
  neither                    -> paging disabled (logged once)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re

from sentinel_core.http import ServiceClient
from sentinel_core.schemas import AlertEvent, Classification, EscalationDecision

log = logging.getLogger("orchestrator.alerts")

# Phrase -> pattern. Keep phrases specific: these page a human on their phone.
CRITICAL_KEYWORDS: dict[str, str] = {
    "system crash": r"system\s*(crash|crashed|has crashed)|crash(ed)?\s+(the\s+)?system",
    "server crash": r"server\s*(crash|crashed|has crashed)",
    "application crash": r"(app|application)\s+(keeps\s+)?crash(es|ed|ing)?",
    "page down": r"\b(page|pages|site|website|web\s*site|portal)\s+(is\s+|are\s+|went\s+)?down\b",
    "server down": r"\bserver(s)?\s+(is\s+|are\s+|went\s+)?down\b",
    "service down": r"\b(service|system|systems|platform|app|application|api)\s+(is\s+|are\s+|went\s+)?down\b",
    "production down": r"\b(prod|production)\s+(is\s+|went\s+)?down\b|production\s+outage",
    "outage": r"\b(total|complete|major|full)\s+outage\b|\boutage\s+(affecting|across|for\s+all)",
    "data loss": r"\bdata\s+loss\b|\blost\s+(all\s+)?(our\s+)?data\b",
    "data breach": r"\bdata\s+breach\b|\bwe\s+(were|have\s+been|got)\s+hacked\b|\bransomware\b",
    "500 errors": r"\b(http\s+)?50[023]\s+errors?\b|internal\s+server\s+error",
    # German
    "Systemabsturz": r"systemabsturz|system\s+(ist\s+)?abgestürzt|server\s+(ist\s+)?abgestürzt",
    "Seite nicht erreichbar": r"(seite|webseite|portal|server|dienst)\s+(ist\s+)?(nicht\s+(mehr\s+)?erreichbar|ausgefallen)",
    "Totalausfall": r"totalausfall|kompletter\s+ausfall|produktion\s+(ist\s+)?ausgefallen",
    "Datenverlust": r"datenverlust|daten\s+(sind\s+)?verloren",
}
_COMPILED = {k: re.compile(p, re.I) for k, p in CRITICAL_KEYWORDS.items()}


def matched_keywords(text: str) -> list[str]:
    return [k for k, p in _COMPILED.items() if p.search(text or "")]


def should_page(decision: EscalationDecision, text: str) -> list[str]:
    """Keywords that trigger paging; empty list = no page. Only escalated tickets can page."""
    if decision.action != "escalate":
        return []
    return matched_keywords(text)


class AlertPublisher:
    def __init__(self) -> None:
        self.topic = os.getenv("ALERTS_TOPIC", "").strip()
        self.notifier_url = os.getenv("NOTIFIER_URL", "").strip()
        self._pub = None
        self._client = ServiceClient(self.notifier_url, timeout=10) if self.notifier_url and not self.topic else None
        self.mode = "pubsub" if self.topic else ("http" if self._client else "disabled")
        if self.mode == "disabled":
            log.info("on-call paging disabled (set ALERTS_TOPIC or NOTIFIER_URL)")

    async def publish(self, ev: AlertEvent) -> None:
        if self.mode == "pubsub":
            if self._pub is None:
                from google.cloud import pubsub_v1  # type: ignore

                self._pub = pubsub_v1.PublisherClient()
            path = self._pub.topic_path(os.environ["GCP_PROJECT"], self.topic)
            fut = self._pub.publish(path, json.dumps(ev.model_dump(mode="json")).encode(), ticket_id=ev.ticket_id)
            await asyncio.to_thread(fut.result, 30)
        elif self.mode == "http":
            await self._client.post("/notify", ev.model_dump(mode="json"))


publisher = AlertPublisher()


def build_event(ticket_id: str, subject: str, body: str, language: str, keywords: list[str],
                decision: EscalationDecision, cls: Classification | None, outage_id: str | None) -> AlertEvent:
    snippet = re.sub(r"\s+", " ", body or "").strip()[:160]
    return AlertEvent(
        ticket_id=ticket_id, subject=(subject or "")[:120], snippet=snippet, language=language, keywords=keywords,
        reasons=[r.code for r in decision.reasons if r.severity != "info"],
        priority=cls.priority.label if cls else None, queue=cls.queue.label if cls else None, outage_id=outage_id,
    )
