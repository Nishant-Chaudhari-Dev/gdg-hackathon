"use client";

import { Brain, ChevronDown } from "lucide-react";
import { useState } from "react";
import { fmtPct } from "@/lib/format";
import { priorityStyle } from "@/lib/semantics";
import type { Classification, HeadPrediction, HumanReview } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LangBadge, PriorityBadge } from "./badges";
import { Meter, Section } from "./section";

const HEADS = [
  { key: "type", label: "Type" },
  { key: "queue", label: "Queue" },
  { key: "priority", label: "Priority" },
] as const;

function confTone(c: number) {
  if (c < 0.4) return "bg-amber-500";
  if (c < 0.6) return "bg-sky-500";
  return "bg-primary";
}

function Distribution({ head, headKey }: { head: HeadPrediction; headKey: string }) {
  const rows = Object.entries(head.probs).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-1">
      {rows.map(([label, p]) => (
        <div key={label} className="grid grid-cols-[minmax(0,1fr)_90px_42px] items-center gap-2 text-xs">
          <span className={cn("truncate", label === head.label ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
          <Meter
            value={p}
            className="h-1"
            barClassName={headKey === "priority" ? priorityStyle(label).bar : label === head.label ? "bg-primary" : "bg-muted-foreground/40"}
          />
          <span className="tabular text-right text-muted-foreground">{fmtPct(p, 1)}</span>
        </div>
      ))}
    </div>
  );
}

export function ClassificationPanel({
  classification: c,
  language,
  human,
}: {
  classification: Classification;
  language: string;
  human?: HumanReview;
}) {
  const [open, setOpen] = useState(false);
  const override = human?.state === "overridden" ? human.override : null;
  return (
    <Section
      title="Classification"
      icon={Brain}
      right={
        <>
          <LangBadge lang={language} />
          <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline" title="model_version">
            {c.model_version}
          </span>
        </>
      }
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Overall confidence</div>
          <div className={cn("tabular text-2xl font-semibold tracking-tight", c.confidence < 0.4 && "text-amber-600 dark:text-amber-400")}>
            {fmtPct(c.confidence, 0)}
          </div>
        </div>
        <div className="pb-1 text-right text-[11px] text-muted-foreground">calibrated · gates at 0.55</div>
      </div>
      <div className="mt-3 space-y-2.5">
        {HEADS.map(({ key, label }) => {
          const h = c[key];
          const overridden = override?.[key];
          return (
            <div key={key}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {key === "priority" ? <PriorityBadge priority={h.label} /> : h.label}
                  {overridden && overridden !== h.label && (
                    <span className="ml-1.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">→ {overridden} (override)</span>
                  )}
                </span>
                <span className="tabular text-muted-foreground">{fmtPct(h.confidence, 0)}</span>
              </div>
              <Meter value={h.confidence} className="mt-1" barClassName={confTone(h.confidence)} />
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        {open ? "Hide" : "Show"} full probability distribution
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-lg bg-muted/40 p-2.5">
          {HEADS.map(({ key, label }) => (
            <div key={key}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
              <Distribution head={c[key]} headKey={key} />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
