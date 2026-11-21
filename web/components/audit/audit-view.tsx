"use client";

import Link from "next/link";
import { Bot, ChevronRight, RefreshCw, ScrollText, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/layout/empty-state";
import { GatewayOffline, useGatewayDown } from "@/components/layout/gateway-offline";
import { PageHeader } from "@/components/layout/page-header";
import { FilterSelect } from "@/components/queue/filter-select";
import { useNow } from "@/hooks/use-now";
import { api, errorMessage } from "@/lib/api";
import { fmtAgo, fmtDateTime } from "@/lib/format";
import { useLive } from "@/lib/store";
import type { AuditEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const SYSTEM_ACTORS = new Set(["pipeline", "detector", "system", "orchestrator", "gateway", "simulator"]);

function actionTone(action: string) {
  if (/approve|resolved|auto_draft/.test(action)) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (/reject|fail|error|outage\.opened|escalat/.test(action)) return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  if (/override|acknowledge/.test(action)) return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (/edit/.test(action)) return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return "border-border bg-muted/60 text-muted-foreground";
}

function Actor({ name }: { name: string }) {
  const sys = SYSTEM_ACTORS.has(name.toLowerCase());
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "grid size-5 place-items-center rounded-full text-[9px] font-bold uppercase",
          sys ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary",
        )}
      >
        {sys ? <Bot className="size-3" /> : name.slice(0, 2)}
      </span>
      <span className={cn("text-xs", sys ? "text-muted-foreground" : "font-medium")}>{name}</span>
    </span>
  );
}

function Details({ details }: { details: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(details ?? {});
  if (!entries.length) return <span className="text-xs text-muted-foreground">—</span>;
  const inline = entries
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("  ");
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full min-w-0 items-center gap-1 text-left">
        <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        {!open && <span className="truncate font-mono text-[11px] text-muted-foreground">{inline}</span>}
        {open && <span className="text-[11px] text-muted-foreground">details</span>}
      </button>
      {open && (
        <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">{JSON.stringify(details, null, 2)}</pre>
      )}
    </div>
  );
}

export function AuditView() {
  const audit = useLive((s) => s.audit);
  const gw = useGatewayDown();
  const now = useNow(15_000);
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("all");
  const [refreshing, setRefreshing] = useState(false);

  const actors = useMemo(() => Array.from(new Set(audit.map((a) => a.actor))).sort(), [audit]);
  const rows = useMemo(
    () =>
      audit.filter(
        (a: AuditEvent) =>
          (actor === "all" || a.actor === actor) &&
          (!q || `${a.action} ${a.actor} ${a.ticket_id ?? ""} ${JSON.stringify(a.details)}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [audit, actor, q],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      useLive.getState().setSnapshot({ audit: await api.listAudit(200) });
    } catch (e) {
      toast.error("Could not refresh audit log", { description: errorMessage(e) });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log"
        description="Every pipeline decision and human action, append-only. New events stream in live."
        actions={
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && "animate-spin")} /> Refresh
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search action, ticket, details…" className="h-7 pl-8 text-xs" />
        </div>
        <FilterSelect label="Actor" value={actor} onChange={setActor} options={actors.map((a) => ({ value: a, label: a }))} />
        <span className="tabular ml-auto text-xs text-muted-foreground">{rows.length} events</span>
      </div>
      {gw.down && audit.length === 0 ? (
        <GatewayOffline message={gw.error} />
      ) : gw.loading && audit.length === 0 ? (
        <div className="space-y-2 rounded-xl border p-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit events" description="Actions taken in the console will appear here." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table className="table-fixed">
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 w-40 text-[11px] uppercase tracking-wider">Time</TableHead>
                <TableHead className="h-8 w-36 text-[11px] uppercase tracking-wider">Actor</TableHead>
                <TableHead className="h-8 w-44 text-[11px] uppercase tracking-wider">Action</TableHead>
                <TableHead className="h-8 w-40 text-[11px] uppercase tracking-wider">Ticket</TableHead>
                <TableHead className="h-8 text-[11px] uppercase tracking-wider">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id} className="align-top">
                  <TableCell className="py-2">
                    <div className="tabular text-xs">{fmtDateTime(a.ts)}</div>
                    <div className="text-[10px] text-muted-foreground">{fmtAgo(a.ts, now)}</div>
                  </TableCell>
                  <TableCell className="py-2">
                    <Actor name={a.actor} />
                  </TableCell>
                  <TableCell className="py-2">
                    <span className={cn("inline-flex h-5 items-center rounded-md border px-1.5 font-mono text-[10.5px]", actionTone(a.action))}>{a.action}</span>
                  </TableCell>
                  <TableCell className="py-2">
                    {a.ticket_id ? (
                      <Link href={`/queue?ticket=${encodeURIComponent(a.ticket_id)}`} className="truncate font-mono text-[11px] text-primary hover:underline">
                        {a.ticket_id}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2 whitespace-normal">
                    <Details details={a.details} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
