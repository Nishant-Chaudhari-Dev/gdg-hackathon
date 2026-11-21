import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, Sparkles, XCircle } from "lucide-react";
import { DECISION_STYLES, HUMAN_STYLES, STATUS_STYLES, priorityStyle } from "@/lib/semantics";
import type { EscalationDecision, HumanState, TicketStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const chip = "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium whitespace-nowrap";

export function PriorityBadge({ priority, className }: { priority?: string | null; className?: string }) {
  const s = priorityStyle(priority);
  return (
    <span className={cn(chip, s.className, className)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function DecisionBadge({ action, className }: { action?: EscalationDecision["action"] | null; className?: string }) {
  if (!action) return <span className={cn(chip, "border-border text-muted-foreground", className)}>—</span>;
  const s = DECISION_STYLES[action];
  const Icon = action === "escalate" ? ShieldAlert : Sparkles;
  return (
    <span className={cn(chip, s.className, className)}>
      <Icon className="size-3" />
      {s.label}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  const s = STATUS_STYLES[status];
  const Icon = status === "processing" || status === "queued" ? Loader2 : status === "failed" ? XCircle : CheckCircle2;
  return (
    <span className={cn(chip, s.className, className)}>
      <Icon className={cn("size-3", (status === "processing" || status === "queued") && "animate-spin")} />
      {s.label}
    </span>
  );
}

export function HumanBadge({ state, className }: { state: HumanState; className?: string }) {
  const s = HUMAN_STYLES[state];
  return <span className={cn(chip, s.className, className)}>{s.label}</span>;
}

export function LangBadge({ lang, className }: { lang?: string | null; className?: string }) {
  const l = (lang ?? "?").toUpperCase();
  const tone =
    l === "DE"
      ? "border-amber-500/25 bg-amber-500/[0.07] text-amber-700 dark:text-amber-300"
      : "border-sky-500/25 bg-sky-500/[0.07] text-sky-700 dark:text-sky-300";
  return (
    <span className={cn(chip, "font-mono tracking-wide", tone, className)} title={l === "DE" ? "German" : l === "EN" ? "English" : l}>
      {l}
    </span>
  );
}

export function OutageChip({ className }: { className?: string }) {
  return (
    <span className={cn(chip, "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300", className)}>
      <AlertTriangle className="size-3" /> Outage
    </span>
  );
}

export function MonoId({ id, className }: { id: string; className?: string }) {
  return <span className={cn("font-mono text-[11px] text-muted-foreground", className)}>{id}</span>;
}
