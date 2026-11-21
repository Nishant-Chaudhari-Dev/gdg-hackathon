"use client";

import { useNow } from "@/hooks/use-now";
import { cleanText, fmtAgo, fmtMs } from "@/lib/format";
import { priorityStyle } from "@/lib/semantics";
import type { TicketRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DecisionBadge, LangBadge, StatusBadge } from "./badges";

/** Compact list of tickets (Console "recent" rail). */
export function TicketList({
  tickets,
  selectedId,
  onSelect,
}: {
  tickets: TicketRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const now = useNow(15_000);
  return (
    <ul className="divide-y">
      {tickets.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onSelect(t.id)}
            className={cn(
              "flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/50",
              selectedId === t.id && "bg-primary/[0.07] hover:bg-primary/[0.09]",
            )}
          >
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", priorityStyle(t.classification?.priority.label).dot)} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{cleanText(t.subject) || cleanText(t.body).slice(0, 80)}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {t.status === "done" ? <DecisionBadge action={t.decision?.action} /> : <StatusBadge status={t.status} />}
                <LangBadge lang={t.language} />
                <span className="text-[11px] text-muted-foreground">{fmtAgo(t.created_at, now)}</span>
                {t.latency_ms != null && <span className="tabular ml-auto text-[11px] text-muted-foreground">{fmtMs(t.latency_ms)}</span>}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
