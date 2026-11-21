"use client";

import { Inbox, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/layout/empty-state";
import { GatewayOffline, useGatewayDown } from "@/components/layout/gateway-offline";
import { PageHeader } from "@/components/layout/page-header";
import { DecisionBadge, HumanBadge, LangBadge, PriorityBadge, StatusBadge } from "@/components/ticket/badges";
import { useNow } from "@/hooks/use-now";
import { cleanText, fmtAgo, fmtMs, fmtPct, fmtTime } from "@/lib/format";
import { HUMAN_STYLES } from "@/lib/semantics";
import { useLive, useTicketList } from "@/lib/store";
import type { TicketRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FilterSelect } from "./filter-select";
import { SimulateMenu } from "./simulate-menu";
import { TicketSheet } from "./ticket-sheet";

type Filters = Record<"decision" | "priority" | "queue" | "language" | "status" | "human", string>;
const EMPTY: Filters = { decision: "all", priority: "all", queue: "all", language: "all", status: "all", human: "all" };

function matches(t: TicketRecord, f: Filters, q: string) {
  if (f.decision !== "all" && t.decision?.action !== f.decision) return false;
  if (f.priority !== "all" && t.classification?.priority.label !== f.priority) return false;
  if (f.queue !== "all" && t.classification?.queue.label !== f.queue) return false;
  if (f.language !== "all" && t.language !== f.language) return false;
  if (f.status !== "all" && t.status !== f.status) return false;
  if (f.human !== "all" && t.human.state !== f.human) return false;
  if (q) {
    const hay = `${t.id} ${t.subject} ${t.body} ${t.classification?.queue.label ?? ""} ${t.signature.join(" ")}`.toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  return true;
}

export function QueueView() {
  const tickets = useTicketList();
  const arrivals = useLive((s) => s.arrivals);
  const gw = useGatewayDown();
  const now = useNow(2_000);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get("ticket");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [q, setQ] = useState("");

  const setOpen = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("ticket", id);
    else sp.delete("ticket");
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };

  const queues = useMemo(
    () => Array.from(new Set(tickets.map((t) => t.classification?.queue.label).filter(Boolean) as string[])).sort(),
    [tickets],
  );
  const languages = useMemo(() => Array.from(new Set(tickets.map((t) => t.language))).sort(), [tickets]);
  const rows = useMemo(() => tickets.filter((t) => matches(t, filters, q)), [tickets, filters, q]);
  const active = Object.values(filters).some((v) => v !== "all") || q;
  const set = (k: keyof Filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));

  const escalated = tickets.filter((t) => t.decision?.action === "escalate").length;
  const pending = tickets.filter((t) => t.status === "done" && t.human.state === "pending").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ticket queue"
        description={
          <>
            {tickets.length} tickets · <span className="text-red-600 dark:text-red-400">{escalated} escalated</span> · {pending} awaiting review · updates live
          </>
        }
        actions={<SimulateMenu />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject, body, id…" className="h-7 pl-8 text-xs" />
        </div>
        <FilterSelect label="Decision" value={filters.decision} onChange={set("decision")} options={[{ value: "escalate", label: "Escalate" }, { value: "auto_draft", label: "Auto-draft" }]} />
        <FilterSelect label="Priority" value={filters.priority} onChange={set("priority")} options={["high", "medium", "low"].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} />
        <FilterSelect label="Queue" value={filters.queue} onChange={set("queue")} options={queues.map((x) => ({ value: x, label: x }))} />
        <FilterSelect label="Lang" value={filters.language} onChange={set("language")} options={languages.map((x) => ({ value: x, label: x.toUpperCase() }))} />
        <FilterSelect label="Status" value={filters.status} onChange={set("status")} options={["queued", "processing", "done", "failed"].map((x) => ({ value: x, label: x }))} />
        <FilterSelect label="Review" value={filters.human} onChange={set("human")} options={Object.entries(HUMAN_STYLES).map(([k, v]) => ({ value: k, label: v.label }))} />
        {active && (
          <Button size="xs" variant="ghost" onClick={() => { setFilters(EMPTY); setQ(""); }}>
            <X /> Clear
          </Button>
        )}
        <span className="tabular ml-auto text-xs text-muted-foreground">{rows.length} shown</span>
      </div>

      {gw.down && tickets.length === 0 ? (
        <GatewayOffline message={gw.error} />
      ) : gw.loading && tickets.length === 0 ? (
        <div className="space-y-2 rounded-xl border p-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={tickets.length ? "No tickets match these filters" : "Queue is empty"}
          description={tickets.length ? "Try clearing a filter." : "Submit a ticket from the Console or simulate traffic."}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="text-[11px] uppercase tracking-wider hover:bg-transparent">
                <TableHead className="h-8 w-20 text-[11px]">Time</TableHead>
                <TableHead className="h-8 text-[11px]">Ticket</TableHead>
                <TableHead className="h-8 text-[11px]">Lang</TableHead>
                <TableHead className="h-8 text-[11px]">Queue · Type</TableHead>
                <TableHead className="h-8 text-[11px]">Priority</TableHead>
                <TableHead className="h-8 text-[11px]">Decision</TableHead>
                <TableHead className="h-8 text-right text-[11px]">Conf.</TableHead>
                <TableHead className="h-8 text-right text-[11px]">Latency</TableHead>
                <TableHead className="h-8 text-[11px]">Review</TableHead>
                <TableHead className="h-8 text-[11px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => {
                const fresh = arrivals[t.id] != null && now != null && now - arrivals[t.id] < 4_000;
                const esc = t.decision?.action === "escalate";
                return (
                  <TableRow
                    key={t.id}
                    onClick={() => setOpen(t.id)}
                    className={cn(
                      "cursor-pointer text-[13px]",
                      fresh && "animate-flash",
                      openId === t.id && "bg-primary/[0.06]",
                    )}
                  >
                    <TableCell className="relative py-2 align-top">
                      <span className={cn("absolute inset-y-0 left-0 w-0.5", esc ? "bg-red-500" : t.decision ? "bg-emerald-500/70" : "bg-transparent")} />
                      <div className="tabular text-xs">{fmtTime(t.created_at)}</div>
                      <div className="text-[10px] text-muted-foreground">{fmtAgo(t.created_at, now)}</div>
                    </TableCell>
                    <TableCell className="max-w-[340px] py-2 align-top whitespace-normal">
                      <div className="truncate font-medium">{cleanText(t.subject) || cleanText(t.body).slice(0, 100)}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="font-mono">{t.id}</span>
                        <span>· {t.source}</span>
                        {t.outage_id && <span className="font-semibold text-red-600 dark:text-red-400">· OUTAGE</span>}
                      </div>
                    </TableCell>
                    <TableCell className="py-2 align-top"><LangBadge lang={t.language} /></TableCell>
                    <TableCell className="py-2 align-top text-xs">
                      {t.classification ? (
                        <>
                          <div className="truncate">{t.classification.queue.label}</div>
                          <div className="text-[11px] text-muted-foreground">{t.classification.type.label}</div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2 align-top">{t.classification ? <PriorityBadge priority={t.classification.priority.label} /> : "—"}</TableCell>
                    <TableCell className="py-2 align-top"><DecisionBadge action={t.decision?.action} /></TableCell>
                    <TableCell className={cn("tabular py-2 text-right align-top text-xs", (t.classification?.confidence ?? 1) < 0.4 && "text-amber-600 dark:text-amber-400")}>
                      {t.classification ? fmtPct(t.classification.confidence) : "—"}
                    </TableCell>
                    <TableCell className="tabular py-2 text-right align-top text-xs">{fmtMs(t.latency_ms)}</TableCell>
                    <TableCell className="py-2 align-top"><HumanBadge state={t.human.state} /></TableCell>
                    <TableCell className="py-2 align-top"><StatusBadge status={t.status} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <TicketSheet id={openId} onClose={() => setOpen(null)} />
    </div>
  );
}
