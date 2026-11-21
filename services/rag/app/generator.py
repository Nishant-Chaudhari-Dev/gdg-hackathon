"""
=====================  RAG TEAM: THIS IS YOUR FILE (2/2)  =====================

Implement `Generator.load()` and `Generator.draft()`.

Contract (docs/CONTRACT.md §4):
  - reply language == req.language ("en" or "de"), even if precedents are in the other language
  - grounded ONLY in req.hits; cite as inline tokens exactly like [TKT-01234] (UI turns them into links)
  - cited_ticket_ids = the ids you actually cited (subset of hit ids; validate post-generation!)
  - never invent pricing, refunds/SLA credits, legal guarantees, integrations, or risky commands;
    list such customer asks in `unsupported_requests` (=> gate escalates to a human)
  - grounded=False / refused=True when evidence is insufficient (=> gate escalates)
  - req.body is already PII-masked ([EMAIL], [PHONE], ...) -- keep the placeholders as-is
  - p95 latency target: < 4 s  (Gemini Flash via Vertex AI; use GEMINI_MODEL env)

Until you ship, a deterministic template drafter is used so the pipeline works end-to-end.
================================================================================
"""
from __future__ import annotations

import os
import re

from sentinel_core.schemas import DraftRequest, DraftResponse

_SENSITIVE = re.compile(r"\b(refund|compensation|credit|discount|price|pricing|legal|lawsuit|guarantee|sla|rückerstattung|gutschrift|preis|rabatt|anwalt|garantie)\b", re.I)

_TEMPLATES = {
    "en": (
        "Hello,\n\nThank you for reaching out about \"{subject}\". Based on how we resolved similar cases "
        "{cites}, here is what we recommend:\n\n{steps}\n\nIf this does not resolve the issue, reply to this "
        "message and an engineer will follow up.\n\nBest regards,\nSupport Team"
    ),
    "de": (
        "Hallo,\n\nvielen Dank für Ihre Nachricht zu \"{subject}\". Auf Basis ähnlicher, bereits gelöster Fälle "
        "{cites} empfehlen wir Folgendes:\n\n{steps}\n\nFalls das Problem weiterhin besteht, antworten Sie bitte "
        "auf diese Nachricht; ein Techniker meldet sich dann bei Ihnen.\n\nMit freundlichen Grüßen\nIhr Support-Team"
    ),
}


class Generator:
    model = "template-0"

    def load(self) -> None:
        # RAG TEAM: init Vertex AI here, e.g.
        #   import vertexai; from vertexai.generative_models import GenerativeModel
        #   vertexai.init(project=os.environ["GCP_PROJECT"], location=os.getenv("GCP_REGION", "us-central1"))
        #   self._llm = GenerativeModel(os.getenv("GEMINI_MODEL", "gemini-2.5-flash"))
        self.model = "template-0"

    def draft(self, req: DraftRequest) -> DraftResponse:
        lang = req.language if req.language in _TEMPLATES else "en"
        top = req.hits[0].score if req.hits else 0.0
        used = [h for h in req.hits[:3] if h.answer and h.score >= 0.6 * top]
        if not used:
            return DraftResponse(language=lang, grounded=False, refused=True,
                                 refusal_reason="No historical precedent with a resolution was retrieved.", model=self.model)
        steps = "\n".join(f"- {h.answer.split('.')[0].strip()[:220]}. [{h.ticket_id}]" for h in used)
        cites = ", ".join(f"[{h.ticket_id}]" for h in used)
        subject = req.subject or (req.body[:60] + "…")
        reply = _TEMPLATES[lang].format(subject=subject, cites=cites, steps=steps)
        unsupported = sorted({m.group(0).lower() for m in _SENSITIVE.finditer(req.body)})
        return DraftResponse(
            reply=reply,
            language=lang,
            cited_ticket_ids=[h.ticket_id for h in used],
            grounded=True,
            groundedness_score=round(max(h.score for h in used), 3),
            unsupported_requests=[f"Customer mentions '{u}' — no policy evidence in precedents" for u in unsupported],
            model=self.model,
        )
