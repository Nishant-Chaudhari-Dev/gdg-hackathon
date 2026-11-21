"use client";

import { BookOpen, ChevronDown, Languages, Quote } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/layout/empty-state";
import { IssueTypeIcon, PriorityIcon } from "@/components/jira/primitives";
import { cleanText, fmtPct } from "@/lib/format";
import type { RetrievedTicket, RetrieveResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LangBadge } from "./badges";

export function precedentAnchor(ticketId: string) {
  return `precedent-${ticketId.replace(/[^\w-]/g, "_")}`;
}

function scoreTone(s: number) {
  if (s >= 0.75) return "bg-[#22a06b]";
  if (s >= 0.5) return "bg-[#1d7afc]";
  return "bg-[#e2a03f]";
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
        "scroll-mt-24 rounded-md border bg-card p-3 transition-colors",
        cited && "border-primary/40 bg-selected/50",
        highlighted && "animate-ring border-primary",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular grid size-5 place-items-center rounded-[3px] bg-muted text-[10px] font-semibold text-muted-foreground">{rank}</span>
        <IssueTypeIcon type={hit.type} />
        <span className="font-mono text-xs font-semibold">{hit.ticket_id}</span>
        {cited && (
          <span className="inline-flex h-[18px] items-center gap-1 rounded-[3px] bg-[#cce0ff] px-1 text-[10px] font-bold text-[#0055cc] uppercase dark:bg-[#09326c] dark:text-[#85b8ff]">
            <Quote className="size-3" /> Cited in reply
          </span>
        )}
        <LangBadge lang={hit.language} />
        {crossLang && (
          <span
            className="inline-flex h-[18px] items-center gap-1 rounded-[3px] bg-[#dfd8fd] px-1 text-[10px] font-bold text-[#5e4db2] dark:bg-[#352c63] dark:text-[#b8acf6]"
            title="Matched across languages — the new ticket and this past ticket are in different languages"
          >
            <Languages className="size-3" /> {queryLang?.toUpperCase()}→{hit.language?.toUpperCase()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2" title="How similar this past ticket is to the new one">
          <span className="text-[11px] text-muted-foreground">Similarity</span>
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", scoreTone(hit.score))} style={{ width: `${Math.max(0, Math.min(1, hit.score)) * 100}%` }} />
          </div>
          <span className="tabular w-9 text-right text-xs font-semibold">{fmtPct(hit.score)}</span>
        </div>
      </div>
      <div className="mt-1.5 text-sm font-medium leading-snug">{cleanText(hit.subject) || "(no subject)"}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {hit.priority && <PriorityIcon priority={hit.priority} withLabel />}
        {hit.queue && <span className="rounded-[3px] border px-1.5 py-px">{hit.queue}</span>}
        {hit.tags.slice(0, 6).map((t) => (
          <span key={t} className="rounded-[3px] bg-muted px-1.5 py-px">
            #{t}
          </span>
        ))}
      </div>
      <div className={cn("mt-2 text-[13px] leading-relaxed whitespace-pre-line text-foreground/85", !open && "line-clamp-2")}>
        <span className="font-semibold text-muted-foreground">How it was resolved: </span>
        {cleanText(hit.answer)}
      </div>
      {open && hit.body && (
        <div className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          <span className="font-semibold">Original ticket: </span>
          {cleanText(hit.body)}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        {open ? "Show less" : "Show full answer & original ticket"}
      </button>
    </div>
  );
}

/** Retrieved precedents ("Similar past tickets" tab). */
export function PrecedentsList({
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
  if (retrieval.hits.length === 0)
    return (
      <EmptyState
        icon={BookOpen}
        title="No similar past ticket found"
        description="Nothing like this exists in the resolved-ticket knowledge base, so the gate escalates it to a human."
        className="py-8"
      />
    );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          The AI searched resolved tickets and found {retrieval.hits.length}. Best match:{" "}
          <span className="tabular font-semibold text-foreground">{fmtPct(retrieval.max_score)}</span> similar.
        </span>
        {retrieval.cross_lingual && (
          <span className="inline-flex h-[18px] items-center gap-1 rounded-[3px] bg-[#dfd8fd] px-1 text-[10px] font-bold text-[#5e4db2] uppercase dark:bg-[#352c63] dark:text-[#b8acf6]">
            <Languages className="size-3" /> Cross-lingual
          </span>
        )}
      </div>
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
  );
}
