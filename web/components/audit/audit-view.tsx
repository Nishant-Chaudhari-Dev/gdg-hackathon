"use client";

import Link from "next/link";
import { ChevronRight, RefreshCw, ScrollText, Search } from "lucide-react";
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
import { Avatar, isSystemActor } from "@/components/jira/primitives";
import { describeAction } from "@/components/issue/activity-feed";
import { useNow } from "@/hooks/use-now";
import { api, errorMessage } from "@/lib/api";
import { fmtAgo, fmtDateTime } from "@/lib/format";
import { useLive } from "@/lib/store";
import type { AuditEvent } from "@/lib/types";
import { useIssueNav } from "@/lib/use-issue-nav";
import { cn } from "@/lib/utils";

function actionTone(action: string) {
  if (/approve|resolved|auto_draft/.test(action)) return "bg-[#baf3db] text-[#216e4e] dark:bg-[#164b35] dark:text-[#7ee2b8]";
  if (/reject|fail|error|outage[.:]opened|escalat/.test(action)) return "bg-[#ffd5d2] text-[#ae2e24] dark:bg-[#5d1f1a] dark:text-[#fd9891]";
  if (/override|acknowledge/.test(action)) return "bg-[#f8e6a0] text-[#7f5f01] dark:bg-[#533f04] dark:text-[#f5cd47]";
  if (/edit/.test(action)) return "bg-[#cce0ff] text-[#0055cc] dark:bg-[#09326c] dark:text-[#85b8ff]";
  return "bg-muted text-muted-foreground";
}

function Actor({ name }: { name: string }) {
  const sys = isSystemActor(name);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar name={name} size="sm" />
      <span className={cn("truncate text-xs", sys ? "text-muted-foreground" : "font-medium")}>{name}</span>
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
  const { hrefFor } = useIssueNav();
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
        crumb="Projects / SentinelDesk"
        description="Every AI decision and every human action, in order. Nothing is ever deleted; new events stream in live."
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
        <EmptyState icon={ScrollText} title="No audit events yet" description="Create a ticket or simulate traffic — every AI decision and operator action will be recorded here." />
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <Table className="min-w-[860px] table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 w-40 text-[11px] uppercase tracking-wider">Time</TableHead>
                <TableHead className="h-8 w-36 text-[11px] uppercase tracking-wider">Actor</TableHead>
                <TableHead className="h-8 w-56 text-[11px] uppercase tracking-wider">What happened</TableHead>
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
                    <div className="text-xs leading-snug">{describeAction(a.action)}</div>
                    <span className={cn("mt-0.5 inline-flex h-[18px] items-center rounded-[3px] px-1 font-mono text-[10px]", actionTone(a.action))}>{a.action}</span>
                  </TableCell>
                  <TableCell className="py-2">
                    {a.ticket_id ? (
                      <Link href={hrefFor(a.ticket_id)} scroll={false} className="truncate font-mono text-[11px] text-primary hover:underline">
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
