import { ShieldAlert, Sparkles } from "lucide-react";
import { DECISION_STYLES, SEVERITY_STYLES, reasonLabel } from "@/lib/semantics";
import type { EscalationDecision } from "@/lib/types";
import { cn } from "@/lib/utils";

export function DecisionBanner({ decision }: { decision: EscalationDecision }) {
  const esc = decision.action === "escalate";
  const s = DECISION_STYLES[decision.action];
  const Icon = esc ? ShieldAlert : Sparkles;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border p-4",
        esc
          ? "border-red-500/35 bg-gradient-to-br from-red-500/[0.13] via-red-500/[0.05] to-transparent"
          : "border-emerald-500/35 bg-gradient-to-br from-emerald-500/[0.13] via-emerald-500/[0.05] to-transparent",
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("grid size-10 shrink-0 place-items-center rounded-lg shadow-sm", s.solid)}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("text-[11px] font-semibold uppercase tracking-[0.12em]", esc ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
            Gate decision
          </div>
          <div className="text-lg font-semibold tracking-tight">{s.long}</div>
        </div>
        <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline" title="rule_version">
          {decision.rule_version}
        </span>
      </div>
      {decision.reasons.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {decision.reasons.map((r, i) => (
            <li key={`${r.code}-${i}`} className="flex flex-wrap items-start gap-2 text-sm">
              <span className={cn("inline-flex h-5 shrink-0 items-center rounded border px-1.5 font-mono text-[10px] font-semibold", SEVERITY_STYLES[r.severity])} title={reasonLabel(r.code)}>
                {r.code}
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-5 text-foreground/85">{r.message}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.severity}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">All gate checks passed — confident classification, strong precedent, grounded draft.</p>
      )}
    </div>
  );
}
