"""The SentinelDesk service contract.

Every request/response that crosses a service boundary is defined here.
ML and RAG teams: these models ARE the interface you implement against.
Do not change field names without telling the app owner (see docs/CONTRACT.md).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Known label sets (informational; services must accept unseen labels as plain strings).
TICKET_TYPES = ["Incident", "Request", "Problem", "Change"]
PRIORITIES = ["high", "medium", "low"]
QUEUES = [
    "Technical Support",
    "Product Support",
    "Customer Service",
    "IT Support",
    "Billing and Payments",
    "Returns and Exchanges",
    "Service Outages and Maintenance",
    "Sales and Pre-Sales",
    "Human Resources",
    "General Inquiry",
]


# --------------------------------------------------------------------------- #
# ML service: POST /classify, POST /classify/batch
# --------------------------------------------------------------------------- #
class ClassifyRequest(BaseModel):
    subject: str = ""  # may be empty: dataset has null subjects
    body: str
    language: str | None = None  # "en" | "de" | None (detected upstream by gateway)


class HeadPrediction(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1, description="Calibrated probability of `label`.")
    probs: dict[str, float] = Field(default_factory=dict, description="Full distribution over labels.")


class Classification(BaseModel):
    type: HeadPrediction
    queue: HeadPrediction
    priority: HeadPrediction
    confidence: float = Field(ge=0, le=1, description="Overall calibrated confidence used by the escalation gate.")
    model_version: str = "unknown"


class ClassifyBatchRequest(BaseModel):
    items: list[ClassifyRequest]


class ClassifyBatchResponse(BaseModel):
    results: list[Classification]


# --------------------------------------------------------------------------- #
# RAG service: POST /retrieve, POST /draft
# --------------------------------------------------------------------------- #
class RetrieveRequest(BaseModel):
    subject: str = ""
    body: str
    language: str | None = None
    k: int = Field(default=5, ge=1, le=20)
    classification: Classification | None = None  # optional hint for metadata filtering / reranking


class RetrievedTicket(BaseModel):
    ticket_id: str  # e.g. "TKT-01234" -- MUST come from kb_train split only
    score: float = Field(ge=0, le=1, description="Similarity in [0,1]; higher = more similar. Used by the gate.")
    subject: str = ""
    body: str = ""  # snippet is fine (<= 600 chars)
    answer: str = ""  # historical resolution (snippet ok, <= 1200 chars)
    language: str | None = None
    type: str | None = None
    queue: str | None = None
    priority: str | None = None
    tags: list[str] = Field(default_factory=list)


class RetrieveResponse(BaseModel):
    hits: list[RetrievedTicket]
    max_score: float = 0.0
    cross_lingual: bool = False  # true if any hit language != query language
    retriever_version: str = "unknown"


class DraftRequest(BaseModel):
    subject: str = ""
    body: str  # PII-masked text
    language: str  # reply MUST be in this language
    hits: list[RetrievedTicket]
    classification: Classification | None = None


class DraftResponse(BaseModel):
    reply: str = ""
    language: str
    cited_ticket_ids: list[str] = Field(default_factory=list, description="Subset of hit ticket_ids actually used.")
    grounded: bool = True  # False if the model could not support the reply with evidence
    groundedness_score: float | None = Field(default=None, ge=0, le=1)
    unsupported_requests: list[str] = Field(
        default_factory=list,
        description="Things the customer asked for that no precedent supports (refund guarantees, pricing, legal...).",
    )
    refused: bool = False
    refusal_reason: str | None = None
    model: str = "unknown"


# --------------------------------------------------------------------------- #
# Escalation gate (owned by orchestrator)
# --------------------------------------------------------------------------- #
ReasonCode = Literal[
    "HIGH_PRIORITY_INCIDENT",
    "LOW_CLASSIFIER_CONFIDENCE",
    "LOW_RETRIEVAL_SIMILARITY",
    "NO_PRECEDENT",
    "UNSUPPORTED_REQUEST",
    "UNGROUNDED_DRAFT",
    "SENSITIVE_REQUEST",
    "PROMPT_INJECTION",
    "ACTIVE_OUTAGE",
    "PIPELINE_DEGRADED",
    "INSUFFICIENT_DETAIL",
]


class EscalationReason(BaseModel):
    code: ReasonCode
    message: str
    severity: Literal["critical", "warning", "info"] = "warning"


class EscalationDecision(BaseModel):
    action: Literal["auto_draft", "escalate"]
    reasons: list[EscalationReason] = Field(default_factory=list)
    rule_version: str = "gate-v1"


# --------------------------------------------------------------------------- #
# Ticket record (stored in Firestore / memory, streamed to UI)
# --------------------------------------------------------------------------- #
TicketStatus = Literal["queued", "processing", "done", "failed"]
HumanState = Literal["pending", "approved", "edited", "rejected", "acknowledged", "overridden"]


class PiiEntity(BaseModel):
    type: str
    count: int


class HumanReview(BaseModel):
    state: HumanState = "pending"
    final_reply: str | None = None
    override: dict[str, str] | None = None  # e.g. {"priority": "high", "queue": "IT Support"}
    note: str | None = None
    by: str | None = None
    at: datetime | None = None


class PagingInfo(BaseModel):
    """On-call paging outcome for a ticket (set by the notifier service)."""
    state: Literal["sent", "rate_limited", "failed"]
    at: datetime = Field(default_factory=utcnow)
    channel: str = "email"
    keywords: list[str] = Field(default_factory=list)
    detail: str | None = None


class TicketRecord(BaseModel):
    id: str
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    status: TicketStatus = "queued"
    source: str = "console"  # console | simulator | api | eval
    operator: str | None = None

    subject: str = ""
    body: str = ""
    subject_masked: str = ""
    body_masked: str = ""
    pii_entities: list[PiiEntity] = Field(default_factory=list)
    language: str = "en"

    classification: Classification | None = None
    retrieval: RetrieveResponse | None = None
    draft: DraftResponse | None = None
    decision: EscalationDecision | None = None
    signature: list[str] = Field(default_factory=list)  # burst-detection keywords
    outage_id: str | None = None

    timings_ms: dict[str, float] = Field(default_factory=dict)
    latency_ms: float | None = None
    error: str | None = None
    human: HumanReview = Field(default_factory=HumanReview)
    paging: PagingInfo | None = None


class Outage(BaseModel):
    id: str
    title: str
    signature: list[str]
    queue: str | None = None
    ticket_ids: list[str] = Field(default_factory=list)
    count: int = 0
    first_seen: datetime = Field(default_factory=utcnow)
    last_seen: datetime = Field(default_factory=utcnow)
    status: Literal["active", "resolved"] = "active"
    updated_at: datetime = Field(default_factory=utcnow)


class AuditEvent(BaseModel):
    id: str
    ts: datetime = Field(default_factory=utcnow)
    actor: str = "system"
    action: str
    ticket_id: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Pub/Sub message: gateway -> orchestrator (topic `tickets`)
# --------------------------------------------------------------------------- #
class TicketMessage(BaseModel):
    ticket_id: str
    subject: str  # masked
    body: str  # masked
    language: str
    source: str = "console"
    created_at: datetime = Field(default_factory=utcnow)


# --------------------------------------------------------------------------- #
# Pub/Sub message: orchestrator -> notifier (topic `alerts`)
# --------------------------------------------------------------------------- #
class AlertEvent(BaseModel):
    ticket_id: str
    subject: str  # PII-masked
    snippet: str  # PII-masked, short
    language: str = "en"
    keywords: list[str]  # critical keywords that matched
    reasons: list[str] = Field(default_factory=list)  # escalation reason codes
    priority: str | None = None
    queue: str | None = None
    outage_id: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class ServiceInfo(BaseModel):
    service: str
    version: str
    ready: bool = True
    details: dict[str, Any] = Field(default_factory=dict)
