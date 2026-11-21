"""Confidence & risk escalation gate (rule set `gate-v1`).

Severity semantics: critical/warning reasons force escalation; info reasons are annotations only.
Thresholds are env-tunable so ML/RAG teams can hand over calibrated values without code changes.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

from sentinel_core.schemas import (
    Classification,
    DraftResponse,
    EscalationDecision,
    EscalationReason,
    RetrieveResponse,
)


@dataclass
class GateConfig:
    min_confidence: float = float(os.getenv("GATE_MIN_CONFIDENCE", "0.55"))
    min_retrieval: float = float(os.getenv("GATE_MIN_RETRIEVAL", "0.45"))
    no_precedent: float = float(os.getenv("GATE_NO_PRECEDENT", "0.20"))
    min_groundedness: float = float(os.getenv("GATE_MIN_GROUNDEDNESS", "0.35"))
    high_priorities: set[str] = field(default_factory=lambda: {"high", "critical"})


CFG = GateConfig()

_INJECTION = re.compile(
    r"(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)"
    r"|system\s+prompt|you\s+are\s+now\s+|act\s+as\s+(an?\s+)?(admin|developer|dan)|jailbreak"
    r"|ignoriere\s+(alle\s+)?(vorherigen\s+)?anweisungen|reveal\s+your\s+(prompt|instructions)",
    re.I,
)
_SENSITIVE = re.compile(
    r"\b(refund|chargeback|compensation|lawsuit|legal action|lawyer|attorney|gdpr|delete (all )?my data|"
    r"sla credit|guarantee|rückerstattung|schadensersatz|anwalt|klage|dsgvo|daten löschen|garantie)\b",
    re.I,
)


# Ported from Edwin's src/escalation.py (eval/test_gate.py): a risky topic the customer raises
# that NONE of the retrieved historical answers covers is unsupported -> human review.
RISKY_TOPICS = {
    "refund": [r"refund", r"reimburs", r"money back", r"erstattung", r"rückzahlung", r"geld zurück"],
    "compensation": [r"compensat", r"entschädig"],
    "pricing": [r"pric(e|ing)", r"discount", r"preis", r"rabatt"],
    "guarantee/SLA": [r"guarantee", r"warrant(y|ies)", r"garantie", r"gewährleist", r"\bsla\b"],
    "legal": [r"legal", r"lawsuit", r"lawyer", r"attorney", r"anwalt", r"klage"],
    "cancellation": [r"cancel", r"kündig"],
}
MIN_BODY_CHARS = int(os.getenv("GATE_MIN_BODY_CHARS", "10"))

# Safety net (ML team): obvious outage / security wording escalates even if the classifier under-rates priority.
# Val: HP-incident escalation 87.6% -> 88.8% for +2.4 pts escalations; test (confirmed once): 86.2% -> 87.6%.
KEYWORD_NET = os.getenv("GATE_KEYWORD_NET", "1") == "1"
_OUTAGE = re.compile(
    r"\b(outage|is down|are down|went down|offline|unreachable|not reachable|cannot access|can't access|unable to access|"
    r"no access|breach|hacked|ransomware|malware|data leak|security incident|ausfall|ausgefallen|nicht erreichbar|"
    r"kein zugriff|sicherheitsvorfall|datenleck|gehackt)\b",
    re.I,
)


def _mentions(text: str, patterns: list[str]) -> bool:
    text = (text or "").lower()
    return any(re.search(p, text) for p in patterns)


def unsupported_topics(text: str, ret: RetrieveResponse | None) -> list[str]:
    answers = " ".join(h.answer or "" for h in (ret.hits if ret else []))
    return [t for t, pats in RISKY_TOPICS.items() if _mentions(text, pats) and not _mentions(answers, pats)]


def _r(code, msg, sev="warning") -> EscalationReason:
    return EscalationReason(code=code, message=msg, severity=sev)


def pre_draft(
    text: str,
    cls: Classification | None,
    ret: RetrieveResponse | None,
    outage_id: str | None,
    degraded: list[str],
) -> tuple[list[EscalationReason], bool]:
    """Returns (reasons, allow_draft)."""
    reasons: list[EscalationReason] = []
    allow_draft = True

    for d in degraded:
        reasons.append(_r("PIPELINE_DEGRADED", f"{d} unavailable; failing safe to human review", "critical"))

    if _INJECTION.search(text):
        reasons.append(_r("PROMPT_INJECTION", "Ticket contains instructions aimed at the AI system", "critical"))
        allow_draft = False

    if cls is not None:
        if cls.priority.label.lower() in CFG.high_priorities and cls.type.label == "Incident":
            reasons.append(_r("HIGH_PRIORITY_INCIDENT",
                              f"High-priority incident ({cls.queue.label}) requires on-call engineer", "critical"))
        if cls.confidence < CFG.min_confidence:
            reasons.append(_r("LOW_CLASSIFIER_CONFIDENCE",
                              f"Classifier confidence {cls.confidence:.2f} < {CFG.min_confidence:.2f}"))

    if KEYWORD_NET and _OUTAGE.search(text) and not any(r.code == "HIGH_PRIORITY_INCIDENT" for r in reasons):
        reasons.append(_r("HIGH_PRIORITY_INCIDENT",
                          "Outage/security wording detected (keyword safety net, independent of classifier labels)", "critical"))

    if ret is not None:
        if not ret.hits or ret.max_score < CFG.no_precedent:
            reasons.append(_r("NO_PRECEDENT", f"No comparable historical ticket (best similarity {ret.max_score:.2f})", "critical"))
            allow_draft = False
        elif ret.max_score < CFG.min_retrieval:
            reasons.append(_r("LOW_RETRIEVAL_SIMILARITY",
                              f"Best precedent similarity {ret.max_score:.2f} < {CFG.min_retrieval:.2f}"))

    if outage_id:
        reasons.append(_r("ACTIVE_OUTAGE", f"Part of active major incident {outage_id}", "critical"))

    if len(text.strip()) < MIN_BODY_CHARS:
        reasons.append(_r("INSUFFICIENT_DETAIL", f"Ticket text under {MIN_BODY_CHARS} characters; too little to assess"))

    topics = unsupported_topics(text, ret)
    if topics:
        reasons.append(_r("UNSUPPORTED_REQUEST",
                          "Asks about " + ", ".join(topics) + "; no retrieved precedent covers it"))

    if _SENSITIVE.search(text):
        reasons.append(_r("SENSITIVE_REQUEST", "Mentions refunds/legal/data-rights; reply must not promise outcomes", "info"))

    if cls is None or ret is None:
        allow_draft = allow_draft and ret is not None
    return reasons, allow_draft


def post_draft(draft: DraftResponse | None) -> list[EscalationReason]:
    if draft is None:
        return []
    reasons: list[EscalationReason] = []
    if draft.refused or not draft.grounded:
        reasons.append(_r("UNGROUNDED_DRAFT", draft.refusal_reason or "Draft could not be grounded in precedents", "critical"))
    elif draft.groundedness_score is not None and draft.groundedness_score < CFG.min_groundedness:
        reasons.append(_r("UNGROUNDED_DRAFT", f"Groundedness {draft.groundedness_score:.2f} < {CFG.min_groundedness:.2f}"))
    if draft.reply and not draft.cited_ticket_ids:
        reasons.append(_r("UNGROUNDED_DRAFT", "Draft cites no historical ticket"))
    if draft.unsupported_requests:
        reasons.append(_r("UNSUPPORTED_REQUEST", "; ".join(draft.unsupported_requests)[:300]))
    return reasons


def decide(reasons: list[EscalationReason]) -> EscalationDecision:
    escalate = any(r.severity in ("critical", "warning") for r in reasons)
    order = {"critical": 0, "warning": 1, "info": 2}
    return EscalationDecision(action="escalate" if escalate else "auto_draft",
                              reasons=sorted(reasons, key=lambda r: order[r.severity]), rule_version="gate-v3")
