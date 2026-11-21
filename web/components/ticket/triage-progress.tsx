"use client";

import { Brain, Check, FileSearch, Loader2, PenLine, Scale, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export const PIPELINE_STAGES = [
  { key: "pii", label: "PII masking", detail: "Redacting emails, phones, IBANs before any model sees the text", icon: ShieldCheck, ms: 350 },
  { key: "classify", label: "Classify", detail: "Multilingual type · queue · priority heads", icon: Brain, ms: 700 },
  { key: "retrieve", label: "Retrieve", detail: "Hybrid search over resolved tickets (EN ⇄ DE)", icon: FileSearch, ms: 900 },
  { key: "gate", label: "Escalation gate", detail: "Rules: priority, confidence, similarity, injection, outages", icon: Scale, ms: 400 },
  { key: "draft", label: "Grounded draft", detail: "LLM reply citing precedent ticket IDs", icon: PenLine, ms: Infinity },
] as const;

/** Time-based staged indicator shown while POST /api/tickets?wait=true is in flight. */
export function TriageProgress({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(id);
  }, [startedAt]);

  let acc = 0;
  let current = PIPELINE_STAGES.length - 1;
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    acc += PIPELINE_STAGES[i].ms;
    if (elapsed < acc) {
      current = i;
      break;
    }
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Triaging ticket…</div>
          <div className="text-xs text-muted-foreground">Running the SentinelDesk pipeline</div>
        </div>
        <div className="tabular font-mono text-sm text-muted-foreground">{(elapsed / 1000).toFixed(1)}s</div>
      </div>
      <ol className="mt-4 space-y-1">
        {PIPELINE_STAGES.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={s.key}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors",
                active && "bg-primary/[0.07]",
              )}
            >
              <div
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border transition-colors",
                  done && "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                  active && "border-primary/50 bg-primary/15 text-primary",
                  !done && !active && "text-muted-foreground/60",
                )}
              >
                {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : <s.icon className="size-3.5" />}
              </div>
              <div className="min-w-0">
                <div className={cn("text-[13px] font-medium", !done && !active && "text-muted-foreground")}>{s.label}</div>
                <div className="truncate text-xs text-muted-foreground">{s.detail}</div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.min(95, ((current + 0.5) / PIPELINE_STAGES.length) * 100)}%` }} />
      </div>
    </div>
  );
}
