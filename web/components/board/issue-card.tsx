"use client";

import { BellRing, EyeOff, Loader2, Siren } from "lucide-react";
import { ComponentTag, IssueKey, IssueTypeIcon, Lozenge, PriorityIcon } from "@/components/jira/primitives";
import { fmtAgo, fmtPct } from "@/lib/format";
import { type BoardColumn, piiCount, statusLozenge, summaryOf } from "@/lib/issue";
import type { TicketRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

function Indicator({ icon: Icon, label, className }: { icon: typeof BellRing; label: string; className?: string }) {
  return (
    <span title={label} aria-label={label} className={cn("inline-flex items-center", className)}>
      <Icon className="size-3.5" />
    </span>
  );
}

/** A Jira-style issue card. The whole card is one button that opens the detail panel. */
export function IssueCard({
  ticket: t,
  column,
  now,
  fresh,
  selected,
  onOpen,
}: {
  ticket: TicketRecord;
  column: BoardColumn;
  now: number | null;
  fresh: boolean;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  const c = t.classification;
  const pii = piiCount(t);
  const lz = statusLozenge(t);
  const conf = c?.confidence;
  return (
    <button
      type="button"
      onClick={() => onOpen(t.id)}
      className={cn(
        "group block w-full rounded-md border border-transparent bg-card p-3 text-left shadow-[0_1px_1px_rgba(9,30,66,0.25),0_0_1px_rgba(9,30,66,0.31)] transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring dark:shadow-[0_0_0_1px_rgba(166,197,226,0.12)]",
        selected && "border-primary bg-selected hover:bg-selected",
        fresh && "animate-card-in",
      )}
    >
      <div className="line-clamp-3 text-sm leading-snug text-foreground group-hover:underline-offset-2">{summaryOf(t)}</div>

      {(column === "triage" || column === "done") && (
        <div className="mt-2">
          {t.status === "processing" || t.status === "queued" ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-primary" /> {t.status === "queued" ? "Waiting for AI…" : "AI is triaging…"}
            </span>
          ) : (
            <Lozenge tone={lz.tone} title={lz.help}>
              {lz.label}
            </Lozenge>
          )}
          {column === "done" && t.human.by && <span className="ml-1.5 text-[11px] text-muted-foreground">by {t.human.by}</span>}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {c && <ComponentTag title="Queue (component)">{c.queue.label}</ComponentTag>}
        <ComponentTag className="font-mono" title={t.language === "de" ? "German" : t.language === "en" ? "English" : t.language}>
          {t.language.toUpperCase()}
        </ComponentTag>
        {conf != null && (
          <span
            title="How confident the AI classifier is"
            className={cn("tabular ml-auto text-[11px]", conf < 0.4 ? "font-semibold text-[#a54800] dark:text-[#fec195]" : "text-muted-foreground")}
          >
            {fmtPct(conf)} sure
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <IssueTypeIcon type={c?.type.label} />
        <IssueKey id={t.id} strike={t.human.state === "rejected"} className="shrink-0 whitespace-nowrap" />
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">
          {t.paging?.state === "sent" && <Indicator icon={BellRing} label="On-call engineer's phone was paged" className="text-[#c9372c] dark:text-[#fd9891]" />}
          {t.outage_id && <Indicator icon={Siren} label="Part of a major incident (outage)" className="text-[#c9372c] dark:text-[#fd9891]" />}
          {pii > 0 && <Indicator icon={EyeOff} label={`${pii} piece(s) of personal data masked`} className="text-[#6e5dc6] dark:text-[#b8acf6]" />}
          <span className="tabular text-[11px] whitespace-nowrap" title={`Created ${t.created_at}`}>
            {fmtAgo(t.created_at, now).replace(" ago", "")}
          </span>
          <PriorityIcon priority={c?.priority.label} />
        </span>
      </div>
    </button>
  );
}
