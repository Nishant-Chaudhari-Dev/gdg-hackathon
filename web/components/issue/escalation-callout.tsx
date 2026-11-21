import { CircleAlert, Info, ShieldAlert, Sparkles, TriangleAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SEVERITY_LABELS, reasonExplanation, reasonLabel } from "@/lib/semantics";
import type { EscalationDecision, EscalationReason } from "@/lib/types";
import { cn } from "@/lib/utils";

const SEV: Record<EscalationReason["severity"], { icon: typeof Info; className: string }> = {
  critical: { icon: CircleAlert, className: "text-[#c9372c] dark:text-[#fd9891]" },
  warning: { icon: TriangleAlert, className: "text-[#b38600] dark:text-[#f5cd47]" },
  info: { icon: Info, className: "text-[#0c66e4] dark:text-[#85b8ff]" },
};

const SEV_ORDER = { critical: 0, warning: 1, info: 2 } as const;

/** Jira "section message"-style callout explaining the escalation gate's decision in plain English. */
export function EscalationCallout({ decision }: { decision: EscalationDecision }) {
  const esc = decision.action === "escalate";
  const Icon = esc ? ShieldAlert : Sparkles;
  const reasons = [...decision.reasons].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  return (
    <section
      className={cn(
        "rounded-md border-l-4 p-4",
        esc ? "border-l-[#c9372c] bg-[#ffeceb] dark:bg-[#42221f]" : "border-l-[#22a06b] bg-[#dcfff1] dark:bg-[#1c3329]",
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", esc ? "text-[#c9372c] dark:text-[#fd9891]" : "text-[#22a06b] dark:text-[#7ee2b8]")} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Escalation decision</div>
          <h3 className="text-base font-semibold text-foreground">{esc ? "Escalate to on-call engineer" : "Auto-draft ready for review"}</h3>
          <p className="mt-0.5 text-sm text-foreground/80">
            {esc
              ? "The AI did not trust itself to answer this one. A human engineer needs to take it — here's why:"
              : reasons.length
                ? "The AI drafted a reply. It passed the safety checks, with these notes:"
                : "All safety checks passed: confident classification, a strong matching past ticket and a grounded draft. Review the reply and send it."}
          </p>
          {reasons.length > 0 && (
            <ul className="mt-2.5 space-y-2">
              {reasons.map((r, i) => {
                const s = SEV[r.severity];
                const explain = reasonExplanation(r.code);
                return (
                  <li key={`${r.code}-${i}`} className="flex items-start gap-2 text-sm">
                    <s.icon className={cn("mt-0.5 size-4 shrink-0", s.className)} aria-label={SEVERITY_LABELS[r.severity]} />
                    <div className="min-w-0">
                      <Tooltip>
                        <TooltipTrigger render={<span className="cursor-help font-semibold underline decoration-dotted decoration-foreground/30 underline-offset-2" />}>
                          {reasonLabel(r.code)}
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <div className="font-mono text-[10px] opacity-70">{r.code}</div>
                          {explain || r.message}
                        </TooltipContent>
                      </Tooltip>
                      <span className={cn("ml-1.5 text-[11px] font-semibold uppercase", s.className)}>{SEVERITY_LABELS[r.severity]}</span>
                      <div className="text-[13px] text-foreground/75">{explain ? `${explain} ` : ""}<span className="text-muted-foreground">({r.message})</span></div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:inline" title="Gate rule version">
          {decision.rule_version}
        </span>
      </div>
    </section>
  );
}
