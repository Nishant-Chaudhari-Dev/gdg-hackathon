// SentinelDesk gateway API types (source of truth: shared/sentinel_core/schemas.py + services/gateway).
// The frontend copies this file to web/lib/types.ts. Keep both in sync.

export type ISODate = string;

export interface HeadPrediction { label: string; confidence: number; probs: Record<string, number>; }
export interface Classification {
  type: HeadPrediction; queue: HeadPrediction; priority: HeadPrediction;
  confidence: number; model_version: string;
}
export interface RetrievedTicket {
  ticket_id: string; score: number; subject: string; body: string; answer: string;
  language?: string | null; type?: string | null; queue?: string | null; priority?: string | null; tags: string[];
}
export interface RetrieveResponse { hits: RetrievedTicket[]; max_score: number; cross_lingual: boolean; retriever_version: string; }
export interface DraftResponse {
  reply: string; language: string; cited_ticket_ids: string[]; grounded: boolean;
  groundedness_score?: number | null; unsupported_requests: string[]; refused: boolean;
  refusal_reason?: string | null; model: string;
}
export type ReasonCode =
  | "HIGH_PRIORITY_INCIDENT" | "LOW_CLASSIFIER_CONFIDENCE" | "LOW_RETRIEVAL_SIMILARITY" | "NO_PRECEDENT"
  | "UNSUPPORTED_REQUEST" | "UNGROUNDED_DRAFT" | "SENSITIVE_REQUEST" | "PROMPT_INJECTION"
  | "ACTIVE_OUTAGE" | "PIPELINE_DEGRADED" | "INSUFFICIENT_DETAIL";
export interface EscalationReason { code: ReasonCode; message: string; severity: "critical" | "warning" | "info"; }
export interface EscalationDecision { action: "auto_draft" | "escalate"; reasons: EscalationReason[]; rule_version: string; }

export type TicketStatus = "queued" | "processing" | "done" | "failed";
export type HumanState = "pending" | "approved" | "edited" | "rejected" | "acknowledged" | "overridden";
export interface HumanReview {
  state: HumanState; final_reply?: string | null; override?: Record<string, string> | null;
  note?: string | null; by?: string | null; at?: ISODate | null;
}
export interface TicketRecord {
  id: string; created_at: ISODate; updated_at: ISODate; status: TicketStatus; source: string; operator?: string | null;
  subject: string; body: string; subject_masked: string; body_masked: string;
  pii_entities: { type: string; count: number }[]; language: string;
  classification?: Classification | null; retrieval?: RetrieveResponse | null; draft?: DraftResponse | null;
  decision?: EscalationDecision | null; signature: string[]; outage_id?: string | null;
  timings_ms: Record<string, number>; // keys: queue, classify, retrieve, draft, gate, total
  latency_ms?: number | null; error?: string | null; human: HumanReview;
  paging?: PagingInfo | null; // set when on-call was paged (notifier service)
}
export interface PagingInfo {
  state: "sent" | "rate_limited" | "failed"; at: ISODate; channel: string; keywords: string[]; detail?: string | null;
}
export interface Outage {
  id: string; title: string; signature: string[]; queue?: string | null; ticket_ids: string[]; count: number;
  first_seen: ISODate; last_seen: ISODate; status: "active" | "resolved"; updated_at: ISODate;
}
export interface AuditEvent { id: string; ts: ISODate; actor: string; action: string; ticket_id?: string | null; details: Record<string, unknown>; }

export interface Percentiles { p50: number; p95: number; mean: number; n: number; }
export interface OpsMetrics {
  window_tickets: number;
  by_status: Record<string, number>; by_decision: Record<string, number>; escalation_rate: number;
  by_reason: Record<string, number>; by_priority: Record<string, number>; by_queue: Record<string, number>;
  by_type: Record<string, number>; by_language: Record<string, number>; by_human_state: Record<string, number>;
  latency_ms: Percentiles; stage_latency_ms: Record<string, Percentiles>;
  throughput: { minute: ISODate; count: number }[]; pii_masked_tickets: number; active_outages: number;
}
export interface HeadEval {
  macro_f1: number; accuracy: number; labels: string[]; confusion: number[][];
  per_class: Record<string, { precision: number; recall: number; f1: number; support: number }>;
}
export interface EvalReport {
  generated_at: ISODate; n_test: number; model_version: string;
  heads: { type: HeadEval; queue: HeadEval; priority: HeadEval };
  high_priority_incident_recall: number;
  latency_ms: Percentiles;
  escalation?: { rate: number; hp_incident_escalated_recall: number } | null;
  notes?: string | null;
}
export interface ServiceHealth { name: string; url: string; ok: boolean; latency_ms: number | null; info?: Record<string, unknown> | null; error?: string | null; }
export interface SystemStatus { mode: "local" | "gcp"; store: string; bus: string; services: ServiceHealth[]; }
export interface SampleTicket { id: string; label: string; language: string; subject: string; body: string; expect: string; }

// ---- Endpoints (base = NEXT_PUBLIC_API_URL, e.g. http://localhost:8080) ----
// GET  /api/tickets?limit=100&status=done            -> { items: TicketRecord[] }   (newest first)
// GET  /api/tickets/:id                              -> TicketRecord
// POST /api/tickets?wait=true  {subject, body, operator?}  -> TicketRecord (wait=true blocks until done, <=45s)
// POST /api/tickets/:id/actions {action:"approve"|"edit"|"reject"|"acknowledge"|"override", reply?, override?, note?, operator?} -> TicketRecord
// GET  /api/outages                                  -> { items: Outage[] }
// POST /api/outages/:id/resolve {operator?}          -> Outage
// GET  /api/audit?limit=200                          -> { items: AuditEvent[] }
// GET  /api/metrics                                  -> OpsMetrics
// GET  /api/eval                                     -> EvalReport  (404 if no eval run yet)
// GET  /api/system                                   -> SystemStatus
// GET  /api/samples                                  -> { items: SampleTicket[] }
// POST /api/simulate {scenario:"mixed"|"outage"|"german"|"adversarial", count?, interval_ms?} -> { started: number, scenario: string }
// GET  /api/events  (Server-Sent Events)  event names: "ticket" (TicketRecord), "outage" (Outage), "audit" (AuditEvent), "ping"
