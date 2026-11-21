import type { EscalationReason, HumanState, ReasonCode, TicketRecord, TicketStatus } from "./types";

/** Consistent color semantics across the console. */
export const PRIORITY_STYLES: Record<string, { label: string; className: string; dot: string; bar: string }> = {
  high: {
    label: "High",
    className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
    bar: "bg-red-500",
  },
  medium: {
    label: "Medium",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
  },
  low: {
    label: "Low",
    className: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    dot: "bg-slate-400",
    bar: "bg-slate-400",
  },
};

export function priorityStyle(p?: string | null) {
  return PRIORITY_STYLES[(p ?? "").toLowerCase()] ?? {
    label: p ?? "—",
    className: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
    bar: "bg-muted-foreground",
  };
}

export const DECISION_STYLES = {
  escalate: {
    label: "Escalate",
    long: "Escalate to On-Call Engineer",
    className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    solid: "bg-red-600 text-white",
    dot: "bg-red-500",
  },
  auto_draft: {
    label: "Auto-Draft",
    long: "Auto-Draft Ready",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    solid: "bg-emerald-600 text-white",
    dot: "bg-emerald-500",
  },
} as const;

export const SEVERITY_STYLES: Record<EscalationReason["severity"], string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

export const STATUS_STYLES: Record<TicketStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  processing: { label: "Processing", className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  done: { label: "Done", className: "border-border bg-muted/60 text-muted-foreground" },
  failed: { label: "Failed", className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" },
};

export const HUMAN_STYLES: Record<HumanState, { label: string; className: string }> = {
  pending: { label: "Pending review", className: "border-border bg-muted/60 text-muted-foreground" },
  approved: { label: "Approved & sent", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  edited: { label: "Edited", className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  rejected: { label: "Rejected", className: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" },
  acknowledged: { label: "Acknowledged", className: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  overridden: { label: "Overridden", className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
};

export const REASON_LABELS: Record<ReasonCode, string> = {
  HIGH_PRIORITY_INCIDENT: "High-priority incident",
  LOW_CLASSIFIER_CONFIDENCE: "Low classifier confidence",
  LOW_RETRIEVAL_SIMILARITY: "Low retrieval similarity",
  NO_PRECEDENT: "No precedent",
  UNSUPPORTED_REQUEST: "Unsupported request",
  UNGROUNDED_DRAFT: "Ungrounded draft",
  SENSITIVE_REQUEST: "Sensitive request",
  PROMPT_INJECTION: "Prompt injection",
  ACTIVE_OUTAGE: "Active outage",
  PIPELINE_DEGRADED: "Pipeline degraded",
  INSUFFICIENT_DETAIL: "Insufficient detail",
};

export function reasonLabel(code: string): string {
  return (REASON_LABELS as Record<string, string>)[code] ?? code;
}

export const LANGUAGE_LABELS: Record<string, string> = { en: "English", de: "German" };

/** Pipeline stage order + colors (categorical slots, fixed order). */
export const STAGES = [
  { key: "queue", label: "Queue", color: "var(--chart-7)" },
  { key: "classify", label: "Classify", color: "var(--chart-1)" },
  { key: "retrieve", label: "Retrieve", color: "var(--chart-3)" },
  { key: "gate", label: "Gate", color: "var(--chart-4)" },
  { key: "draft", label: "Draft", color: "var(--chart-2)" },
] as const;

export function stageColor(key: string): string {
  return STAGES.find((s) => s.key === key)?.color ?? "var(--chart-5)";
}

export function decisionOf(t: TicketRecord) {
  return t.decision?.action ?? null;
}

/** One-line plain-English explanation of each gate reason code (tooltips + escalation callout). */
export const REASON_EXPLANATIONS: Record<ReasonCode, string> = {
  HIGH_PRIORITY_INCIDENT: "The model rated this a high-priority incident, so a human engineer must handle it.",
  LOW_CLASSIFIER_CONFIDENCE: "The classifier wasn't sure about type, queue or priority, so a human should double-check.",
  LOW_RETRIEVAL_SIMILARITY: "No sufficiently similar past ticket was found, so the AI has little to base a reply on.",
  NO_PRECEDENT: "Nothing like this exists in the resolved-ticket knowledge base.",
  UNSUPPORTED_REQUEST: "The customer asked for something past tickets can't answer (off-topic or out-of-policy).",
  UNGROUNDED_DRAFT: "The AI reply isn't well supported by the cited past tickets, so it might be made up.",
  SENSITIVE_REQUEST: "The ticket touches credentials, money, legal or personal data — a human must decide.",
  PROMPT_INJECTION: "The text tries to manipulate the AI (e.g. “ignore your instructions”), so auto-reply is blocked.",
  ACTIVE_OUTAGE: "This looks like part of an ongoing major incident, so it's linked to the outage instead of auto-replied.",
  PIPELINE_DEGRADED: "Part of the AI pipeline was slow or unavailable, so the result can't be trusted automatically.",
  INSUFFICIENT_DETAIL: "The ticket is too short or vague to act on — someone needs to ask the customer for details.",
};

export function reasonExplanation(code: string): string {
  return (REASON_EXPLANATIONS as Record<string, string>)[code] ?? "";
}

export const SEVERITY_LABELS: Record<EscalationReason["severity"], string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

/** Short human labels for what an operator did (Done column, activity feed). */
export const HUMAN_DONE_LABELS: Record<HumanState, string> = {
  pending: "Pending",
  approved: "Reply sent",
  edited: "Reply edited",
  rejected: "Draft rejected",
  acknowledged: "Acknowledged",
  overridden: "Fields overridden",
};
