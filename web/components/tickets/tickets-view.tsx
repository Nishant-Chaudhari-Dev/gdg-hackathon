"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, BellRing, List, Plus, Search, ShieldAlert, Siren, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/layout/empty-state";
import { GatewayOffline, useGatewayDown } from "@/components/layout/gateway-offline";
import { IssueKey, IssueTypeIcon, Lozenge, PriorityIcon, priorityMeta } from "@/components/jira/primitives";
import { FilterSelect } from "@/components/queue/filter-select";
import { SimulateMenu } from "@/components/queue/simulate-menu";
import { useNow } from "@/hooks/use-now";
import { fmtAgo, fmtDateTime } from "@/lib/format";
import { BOARD_COLUMNS, PRIORITY_RANK, columnOf, priorityOf, searchHaystack, statusLozenge, summaryOf } from "@/lib/issue";
import { useLive, useTicketList } from "@/lib/store";
import type { TicketRecord } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { useIssueNav } from "@/lib/use-issue-nav";
import { cn } from "@/lib/utils";

type SortKey = "key" | "summary" | "type" | "priority" | "queue" | "status" | "decision" | "language" | "paged" | "created";
type Filters = Record<"stage" | "decision" | "priority" | "queue" | "language", string>;
const EMPTY: Filters = { stage: "all", decision: "all", priority: "all", queue: "all", language: "all" };

const STAGE_ORDER = { triage: 0, escalated: 1, review: 2, done: 3 } as const;

function sortValue(t: TicketRecord, k: SortKey): string | number {
  switch (k) {
    case "key":
      return t.id;
    case "summary":
      return summaryOf(t).toLowerCase();
    case "type":
      return t.classification?.type.label ?? "~";
    case "priority":
      return PRIORITY_RANK[priorityOf(t) ?? ""] ?? 3;
    case "queue":
      return t.classification?.queue.label ?? "~";
    case "status":
      return STAGE_ORDER[columnOf(t)];
    case "decision":
      return t.decision?.action ?? "~";
    case "language":
      return t.language;
    case "paged":
      return t.paging?.state === "sent" ? 0 : t.paging ? 1 : 2;
    case "created":
      return t.created_at;
  }
}

function matches(t: TicketRecord, f: Filters, q: string) {
  if (f.stage !== "all" && columnOf(t) !== f.stage) return false;
  if (f.decision !== "all" && t.decision?.action !== f.decision) return false;
  if (f.priority !== "all" && priorityOf(t) !== f.priority) return false;
  if (f.queue !== "all" && t.classification?.queue.label !== f.queue) return false;
  if (f.language !== "all" && t.language !== f.language) return false;
  if (q && !searchHaystack(t).includes(q.toLowerCase())) return false;
  return true;
}

function SortHead({
  k,
  label,
  sort,
  onSort,
  className,
}: {
  k: SortKey;
  label: string;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const on = sort.key === k;
  const Icon = on ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={cn("h-9 px-2 text-xs font-semibold text-muted-foreground", className)} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", on && "text-foreground")}>
        {label}
        <Icon className={cn("size-3", !on && "opacity-40")} />
      </button>
    </TableHead>
  );
}

export function TicketsView() {
  const tickets = useTicketList();
  const arrivals = useLive((s) => s.arrivals);
  const gw = useGatewayDown();
  const now = useNow(5_000);
  const nav = useIssueNav();
  const setCreateOpen = useUi((s) => s.setCreateOpen);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "created", dir: "desc" });

  const queues = useMemo(() => Array.from(new Set(tickets.map((t) => t.classification?.queue.label).filter(Boolean) as string[])).sort(), [tickets]);
  const languages = useMemo(() => Array.from(new Set(tickets.map((t) => t.language))).sort(), [tickets]);

  const rows = useMemo(() => {
    const r = tickets.filter((t) => matches(t, filters, q.trim()));
    const dir = sort.dir === "asc" ? 1 : -1;
    return r.sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return cmp * dir || b.created_at.localeCompare(a.created_at);
    });
  }, [tickets, filters, q, sort]);

  const onSort = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "created" ? "desc" : "asc" }));
  const set = (k: keyof Filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const active = Object.values(filters).some((v) => v !== "all") || q.trim();

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm text-muted-foreground">Projects / SentinelDesk</div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">All tickets</h1>
          <div className="ml-auto">
            <SimulateMenu />
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Every ticket the desk has seen, newest first. Click a column header to sort, or a row to open it.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search key, summary, queue…"
            aria-label="Search tickets"
            className="h-8 w-full rounded-[4px] border border-input bg-background pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground/80 focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </div>
        <FilterSelect label="Status" value={filters.stage} onChange={set("stage")} options={BOARD_COLUMNS.map((c) => ({ value: c.key, label: c.title }))} />
        <FilterSelect label="Decision" value={filters.decision} onChange={set("decision")} options={[{ value: "escalate", label: "Escalate" }, { value: "auto_draft", label: "Auto-draft" }]} />
        <FilterSelect label="Priority" value={filters.priority} onChange={set("priority")} options={["high", "medium", "low"].map((p) => ({ value: p, label: priorityMeta(p)?.label ?? p }))} />
        <FilterSelect label="Queue" value={filters.queue} onChange={set("queue")} options={queues.map((x) => ({ value: x, label: x }))} />
        <FilterSelect label="Language" value={filters.language} onChange={set("language")} options={languages.map((x) => ({ value: x, label: x.toUpperCase() }))} />
        {active && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFilters(EMPTY);
              setQ("");
            }}
          >
            <X /> Clear
          </Button>
        )}
        <span className="tabular ml-auto text-xs text-muted-foreground">
          {rows.length} of {tickets.length} tickets
        </span>
      </div>

      {gw.down && tickets.length === 0 ? (
        <GatewayOffline message={gw.error} />
      ) : gw.loading && tickets.length === 0 ? (
        <div className="space-y-2 rounded-md border p-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={List}
          title={tickets.length ? "No tickets match these filters" : "No tickets yet"}
          description={tickets.length ? "Try clearing a filter or the search." : "Click Create to submit one, or Simulate traffic to stream in demo tickets."}
          action={
            tickets.length ? undefined : (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> Create ticket
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[960px] table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHead k="type" label="Type" sort={sort} onSort={onSort} className="w-16" />
                <SortHead k="key" label="Key" sort={sort} onSort={onSort} className="w-32" />
                <SortHead k="summary" label="Summary" sort={sort} onSort={onSort} />
                <SortHead k="priority" label="Priority" sort={sort} onSort={onSort} className="w-20" />
                <SortHead k="queue" label="Queue" sort={sort} onSort={onSort} className="w-36" />
                <SortHead k="status" label="Status" sort={sort} onSort={onSort} className="w-32" />
                <SortHead k="decision" label="Decision" sort={sort} onSort={onSort} className="w-28" />
                <SortHead k="language" label="Lang" sort={sort} onSort={onSort} className="w-16" />
                <SortHead k="paged" label="Paged" sort={sort} onSort={onSort} className="w-18" />
                <SortHead k="created" label="Created" sort={sort} onSort={onSort} className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => {
                const lz = statusLozenge(t);
                const fresh = arrivals[t.id] != null && now != null && now - arrivals[t.id] < 4_000;
                const esc = t.decision?.action === "escalate";
                return (
                  <TableRow
                    key={t.id}
                    onClick={() => nav.open(t.id)}
                    onKeyDown={(e) => e.key === "Enter" && nav.open(t.id)}
                    tabIndex={0}
                    className={cn("cursor-pointer text-sm", fresh && "animate-flash", nav.openId === t.id && "bg-selected hover:bg-selected")}
                  >
                    <TableCell className="px-2 py-2">
                      <IssueTypeIcon type={t.classification?.type.label} />
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      <IssueKey id={t.id} className="text-xs text-primary" strike={t.human.state === "rejected"} />
                    </TableCell>
                    <TableCell className="max-w-0 px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{summaryOf(t)}</span>
                        {t.outage_id && <Siren className="size-3.5 shrink-0 text-[#c9372c]" aria-label="In outage" />}
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      <PriorityIcon priority={t.classification?.priority.label} />
                    </TableCell>
                    <TableCell className="max-w-0 truncate px-2 py-2 text-muted-foreground">{t.classification?.queue.label ?? "—"}</TableCell>
                    <TableCell className="px-2 py-2">
                      <Lozenge tone={lz.tone} title={lz.help}>
                        {lz.label}
                      </Lozenge>
                    </TableCell>
                    <TableCell className="px-2 py-2">
                      {t.decision ? (
                        <span className={cn("inline-flex items-center gap-1 text-xs font-medium", esc ? "text-[#c9372c] dark:text-[#fd9891]" : "text-[#216e4e] dark:text-[#7ee2b8]")}>
                          {esc ? <ShieldAlert className="size-3.5" /> : <Sparkles className="size-3.5" />}
                          {esc ? "Escalate" : "Auto-draft"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-2 font-mono text-xs">{t.language.toUpperCase()}</TableCell>
                    <TableCell className="px-2 py-2">
                      {t.paging ? (
                        <BellRing
                          className={cn("size-4", t.paging.state === "sent" ? "text-[#c9372c]" : "text-muted-foreground")}
                          aria-label={t.paging.state === "sent" ? "On-call paged" : `Page ${t.paging.state}`}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-2 text-xs text-muted-foreground" title={fmtDateTime(t.created_at)}>
                      {fmtAgo(t.created_at, now)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
