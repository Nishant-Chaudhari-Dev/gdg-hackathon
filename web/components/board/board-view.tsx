"use client";

import { Info, KanbanSquare, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/layout/empty-state";
import { GatewayOffline, useGatewayDown } from "@/components/layout/gateway-offline";
import { SimulateMenu } from "@/components/queue/simulate-menu";
import { useNow } from "@/hooks/use-now";
import { BOARD_COLUMNS, type BoardColumn, PRIORITY_RANK, columnOf, priorityOf, searchHaystack } from "@/lib/issue";
import { useLive, useTicketList } from "@/lib/store";
import type { TicketRecord } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { useIssueNav } from "@/lib/use-issue-nav";
import { cn } from "@/lib/utils";
import { IssueCard } from "./issue-card";

type QuickFilter = "escalated" | "high" | "paged" | "outage" | "en" | "de";
const QUICK_FILTERS: { key: QuickFilter; label: string; help: string }[] = [
  { key: "escalated", label: "Escalated", help: "Tickets the gate sent to a human engineer" },
  { key: "high", label: "High priority", help: "Classified as high priority" },
  { key: "paged", label: "Paged", help: "The on-call engineer's phone was paged" },
  { key: "outage", label: "In outage", help: "Linked to a major incident" },
  { key: "en", label: "EN", help: "English tickets" },
  { key: "de", label: "DE", help: "German tickets" },
];

function matches(t: TicketRecord, f: Set<QuickFilter>, q: string) {
  if (f.has("escalated") && t.decision?.action !== "escalate") return false;
  if (f.has("high") && priorityOf(t) !== "high") return false;
  if (f.has("paged") && !t.paging) return false;
  if (f.has("outage") && !t.outage_id) return false;
  const langs = (["en", "de"] as const).filter((l) => f.has(l));
  if (langs.length && !langs.includes(t.language as "en" | "de")) return false;
  if (q && !searchHaystack(t).includes(q.toLowerCase())) return false;
  return true;
}

const COLUMN_LIMIT = 20;

export function BoardView() {
  const tickets = useTicketList();
  const arrivals = useLive((s) => s.arrivals);
  const gw = useGatewayDown();
  const now = useNow(2_000);
  const nav = useIssueNav();
  const setCreateOpen = useUi((s) => s.setCreateOpen);
  const [filters, setFilters] = useState<Set<QuickFilter>>(new Set());
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<BoardColumn>>(new Set());

  const toggle = (k: QuickFilter) =>
    setFilters((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const columns = useMemo(() => {
    const out: Record<BoardColumn, TicketRecord[]> = { triage: [], escalated: [], review: [], done: [] };
    for (const t of tickets) if (matches(t, filters, q.trim())) out[columnOf(t)].push(t);
    out.escalated.sort(
      (a, b) => (PRIORITY_RANK[priorityOf(a) ?? ""] ?? 3) - (PRIORITY_RANK[priorityOf(b) ?? ""] ?? 3) || b.created_at.localeCompare(a.created_at),
    );
    out.done.sort((a, b) => (b.human.at ?? b.updated_at).localeCompare(a.human.at ?? a.updated_at));
    return out;
  }, [tickets, filters, q]);

  const filtered = filters.size > 0 || q.trim().length > 0;
  const total = tickets.length;
  const needYou = columns.escalated.length + columns.review.length;

  return (
    <div className="flex min-h-full flex-col">
      <div className="text-sm text-muted-foreground">Projects / SentinelDesk</div>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Service Desk board</h1>
        <div className="ml-auto flex items-center gap-2">
          <SimulateMenu />
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {total === 0
          ? "Tickets flow left to right: the AI triages them, then a human reviews the draft or handles the escalation."
          : needYou > 0
            ? `${needYou} ticket${needYou === 1 ? "" : "s"} need${needYou === 1 ? "s" : ""} a human: ${columns.escalated.length} escalated, ${columns.review.length} AI draft${columns.review.length === 1 ? "" : "s"} to review. Click a card to act on it.`
            : "Nothing waiting for a human right now. New tickets stream in live."}
      </p>

      {/* Toolbar: search + quick filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this board"
            aria-label="Search this board"
            className="h-8 w-full rounded-[4px] border border-input bg-background pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground/80 focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </div>
        <span className="ml-1 hidden text-xs font-semibold text-muted-foreground sm:inline">Quick filters</span>
        <button
          type="button"
          onClick={() => setFilters(new Set())}
          className={cn(
            "h-8 rounded-[4px] px-2.5 text-sm font-medium transition-colors",
            filters.size === 0 ? "bg-selected text-selected-foreground" : "text-foreground/80 hover:bg-muted",
          )}
        >
          All
        </button>
        {QUICK_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            title={f.help}
            aria-pressed={filters.has(f.key)}
            onClick={() => toggle(f.key)}
            className={cn(
              "h-8 rounded-[4px] px-2.5 text-sm font-medium transition-colors",
              filters.has(f.key) ? "bg-selected text-selected-foreground ring-1 ring-primary/40" : "text-foreground/80 hover:bg-muted",
            )}
          >
            {f.label}
          </button>
        ))}
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters(new Set());
              setQ("");
            }}
          >
            <X /> Clear filters
          </Button>
        )}
      </div>

      <div className="mt-4 flex-1">
        {gw.down && total === 0 ? (
          <GatewayOffline message={gw.error} />
        ) : gw.loading && total === 0 ? (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {BOARD_COLUMNS.map((c) => (
              <div key={c.key} className="w-[272px] shrink-0 space-y-2 rounded-md bg-column p-2 xl:w-auto xl:min-w-0 xl:flex-1">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            icon={KanbanSquare}
            title="No tickets yet"
            description="Click Create to submit a ticket yourself, or Simulate traffic to stream in a realistic burst (including an outage storm)."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus /> Create ticket
                </Button>
                <SimulateMenu />
              </div>
            }
            className="min-h-[360px]"
          />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-3">
            {BOARD_COLUMNS.map((col) => {
              const items = columns[col.key];
              const open = expanded.has(col.key);
              const shown = open ? items : items.slice(0, COLUMN_LIMIT);
              const attention = (col.key === "escalated" || col.key === "review") && items.length > 0;
              return (
                <section
                  key={col.key}
                  aria-label={col.title}
                  className="flex w-[272px] shrink-0 flex-col rounded-md bg-column xl:w-auto xl:min-w-0 xl:flex-1"
                >
                  <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                    <h2 className="truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase">{col.title}</h2>
                    <span
                      className={cn(
                        "tabular rounded-full px-1.5 text-xs font-semibold",
                        attention && col.key === "escalated" ? "bg-[#c9372c] text-white" : "bg-foreground/10 text-foreground/70",
                      )}
                    >
                      {items.length}
                    </span>
                    <Tooltip>
                      <TooltipTrigger render={<span className="ml-auto inline-flex cursor-help text-muted-foreground/70 hover:text-foreground" />}>
                        <Info className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64">{col.hint}</TooltipContent>
                    </Tooltip>
                  </header>
                  <div className="flex flex-col gap-2 px-2 pb-2">
                    {shown.length === 0 ? (
                      <div className="rounded-md border border-dashed border-foreground/15 px-3 py-6 text-center text-xs text-muted-foreground">
                        {filtered ? "No matching tickets." : col.empty}
                      </div>
                    ) : (
                      shown.map((t) => (
                        <IssueCard
                          key={t.id}
                          ticket={t}
                          column={col.key}
                          now={now}
                          fresh={arrivals[t.id] != null && now != null && now - arrivals[t.id] < 6_000}
                          selected={nav.openId === t.id}
                          onOpen={nav.open}
                        />
                      ))
                    )}
                    {items.length > COLUMN_LIMIT && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() =>
                          setExpanded((s) => {
                            const n = new Set(s);
                            if (n.has(col.key)) n.delete(col.key);
                            else n.add(col.key);
                            return n;
                          })
                        }
                      >
                        {open ? "Show fewer" : `Show ${items.length - COLUMN_LIMIT} more`}
                      </Button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
