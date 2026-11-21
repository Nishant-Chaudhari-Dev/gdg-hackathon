"use client";

import { BookOpen, ChevronDown, Languages, Quote } from "lucide-react";
import { useState } from "react";
import { cleanText, fmtPct } from "@/lib/format";
import type { RetrievedTicket, RetrieveResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LangBadge, PriorityBadge } from "./badges";
import { Section } from "./section";
import { EmptyState } from "@/components/layout/empty-state";

export function precedentAnchor(ticketId: string) {
  return `precedent-${ticketId.replace(/[^\w-]/g, "_")}`;
}

function scoreTone(s: number) {
  if (s >= 0.75) return "bg-emerald-500";
  if (s >= 0.5) return "bg-sky-500";
  return "bg-amber-500";
}

function HitCard({
  hit,
  rank,
  cited,
  highlighted,
  queryLang,
}: {
  hit: RetrievedTicket;
  rank: number;
  cited: boolean;
  highlighted: boolean;
  queryLang?: string;
}) {
  const [open, setOpen] = useState(false);
  const crossLang = !!hit.language && !!queryLang && hit.language !== queryLang;
  return (
    <div
      id={precedentAnchor(hit.ticket_id)}
      className={cn(
        "scroll-mt-24 rounded-lg border bg-background/40 p-3 transition-colors",
        cited && "border-primary/40 bg-primary/[0.04]",
        highlighted && "animate-ring border-primary",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular grid size-5 place-items-center rounded bg-muted text-[10px] font-semibold text-muted-foreground">{rank}</span>
        <span className="font-mono text-xs font-semibold">{hit.ticket_id}</span>
        {cited && (
          <span className="inline-flex h-5 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
            <Quote className="size-3" /> Cited
          </span>
        )}
        <LangBadge lang={hit.language} />
        {crossLang && (
          <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400">
            {queryLang?.toUpperCase()}→{hit.language?.toUpperCase()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", scoreTone(hit.score))} style={{ width: `${Math.max(0, Math.min(1, hit.score)) * 100}%` }} />
          </div>
          <span className="tabular w-10 text-right text-xs font-medium">{hit.score.toFixed(2)}</span>
        </div>
      </div>
      <div className="mt-1.5 text-[13px] font-medium leading-snug">{cleanText(hit.subject) || "(no subject)"}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {hit.type && <span className="rounded border px-1.5 py-px">{hit.type}</span>}
        {hit.queue && <span className="rounded border px-1.5 py-px">{hit.queue}</span>}
        {hit.priority && <PriorityBadge priority={hit.priority} />}
        {hit.tags.map((t) => (
          <span key={t} className="rounded bg-muted px-1.5 py-px">
            #{t}
          </span>
        ))}
      </div>
      <div className={cn("mt-2 text-xs leading-relaxed whitespace-pre-line text-foreground/80", !open && "line-clamp-2")}>
        <span className="font-medium text-muted-foreground">Resolution: </span>
        {cleanText(hit.answer)}
      </div>
      {open && hit.body && (
        <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
          <span className="font-medium">Original ticket: </span>
          {cleanText(hit.body)}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        {open ? "Less" : "More"}
      </button>
    </div>
  );
}

export function PrecedentsPanel({
  retrieval,
  citedIds,
  highlighted,
  queryLang,
}: {
  retrieval: RetrieveResponse;
  citedIds: string[];
  highlighted: string | null;
  queryLang?: string;
}) {
  return (
    <Section
      title="Retrieved precedents"
      icon={BookOpen}
      right={
        <>
          {retrieval.cross_lingual && (
            <span className="inline-flex h-5 items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
              <Languages className="size-3" /> Cross-lingual
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">
            max sim <span className="tabular font-medium text-foreground">{fmtPct(retrieval.max_score, 0)}</span>
          </span>
        </>
      }
    >
      {retrieval.hits.length === 0 ? (
        <EmptyState icon={BookOpen} title="No precedent found" description="Nothing similar in the resolved-ticket knowledge base — the gate escalates these." className="py-8" />
      ) : (
        <div className="space-y-2">
          {retrieval.hits.map((h, i) => (
            <HitCard
              key={h.ticket_id}
              hit={h}
              rank={i + 1}
              cited={citedIds.includes(h.ticket_id)}
              highlighted={highlighted === h.ticket_id}
              queryLang={queryLang}
            />
          ))}
          <div className="pt-1 text-right font-mono text-[10px] text-muted-foreground">{retrieval.retriever_version}</div>
        </div>
      )}
    </Section>
  );
}
