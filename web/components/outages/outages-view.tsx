"use client";

import Link from "next/link";
import { CheckCircle2, Clock, Siren } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/layout/empty-state";
import { GatewayOffline, useGatewayDown } from "@/components/layout/gateway-offline";
import { currentOperator } from "@/components/layout/operator-input";
import { PageHeader } from "@/components/layout/page-header";
import { DecisionBadge, LangBadge } from "@/components/ticket/badges";
import { useNow } from "@/hooks/use-now";
import { api, errorMessage } from "@/lib/api";
import { cleanText, fmtAgo, fmtDateTime, fmtTime } from "@/lib/format";
import { priorityStyle } from "@/lib/semantics";
import { useLive, useOutageList } from "@/lib/store";
import type { Outage } from "@/lib/types";
import { cn } from "@/lib/utils";

function duration(a: string, b: string) {
  const ms = Math.max(0, new Date(b).getTime() - new Date(a).getTime());
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function OutageCard({ outage }: { outage: Outage }) {
  const tickets = useLive((s) => s.tickets);
  const now = useNow(15_000);
  const [busy, setBusy] = useState(false);
  const active = outage.status === "active";
  const linked = outage.ticket_ids
    .map((id) => ({ id, t: tickets[id] }))
    .sort((a, b) => (a.t?.created_at ?? "").localeCompare(b.t?.created_at ?? ""));

  const resolve = async () => {
    setBusy(true);
    try {
      const next = await api.resolveOutage(outage.id, currentOperator());
      useLive.getState().upsertOutage(next);
      toast.success("Outage resolved", { description: outage.title });
    } catch (e) {
      toast.error("Could not resolve", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      id={outage.id}
      className={cn(
        "scroll-mt-24 overflow-hidden rounded-xl border bg-card",
        active ? "border-red-500/40 shadow-[0_0_0_1px_rgba(239,68,68,0.08),0_8px_30px_-12px_rgba(239,68,68,0.35)]" : "",
      )}
    >
      <div className={cn("flex flex-wrap items-start gap-3 border-b p-4", active && "bg-gradient-to-r from-red-500/[0.09] to-transparent")}>
        <div className={cn("grid size-9 shrink-0 place-items-center rounded-lg", active ? "bg-red-600 text-white" : "bg-muted text-muted-foreground")}>
          {active ? <Siren className="size-4 animate-pulse" /> : <CheckCircle2 className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex h-5 items-center rounded-md px-1.5 text-[10px] font-bold uppercase tracking-wider",
                active ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground",
              )}
            >
              {active ? "Active" : "Resolved"}
            </span>
            <h2 className="text-[15px] font-semibold tracking-tight">{outage.title}</h2>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {outage.queue && <span>{outage.queue}</span>}
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" /> first seen {fmtAgo(outage.first_seen, now)}
            </span>
            <span>last ticket {fmtAgo(outage.last_seen, now)}</span>
            <span>
              {active ? "ongoing" : "lasted"} {duration(outage.first_seen, active ? (now ? new Date(now).toISOString() : outage.last_seen) : outage.updated_at)}
            </span>
            <span className="font-mono text-[10px]">{outage.id}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {outage.signature.map((s) => (
              <span key={s} className="rounded border bg-muted/50 px-1.5 py-px font-mono text-[10px]">
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="tabular text-2xl font-semibold leading-none">{outage.count}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">tickets</div>
          </div>
          {active && (
            <Button size="sm" onClick={resolve} disabled={busy}>
              <CheckCircle2 /> {busy ? "Resolving…" : "Resolve"}
            </Button>
          )}
        </div>
      </div>
      <div className="p-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Timeline of linked tickets</div>
        {linked.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tickets linked yet.</p>
        ) : (
          <ol className="relative ml-1.5 space-y-0 border-l pl-4">
            {linked.map(({ id, t }) => (
              <li key={id} className="relative py-1.5">
                <span
                  className={cn(
                    "absolute top-3 -left-[21px] size-2.5 rounded-full ring-4 ring-card",
                    t ? priorityStyle(t.classification?.priority.label).dot : "bg-muted-foreground",
                  )}
                />
                <Link href={`/queue?ticket=${encodeURIComponent(id)}`} className="group flex flex-wrap items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50">
                  <span className="tabular w-16 text-xs text-muted-foreground">{t ? fmtTime(t.created_at) : "—"}</span>
                  {t && <LangBadge lang={t.language} />}
                  <span className="min-w-0 flex-1 truncate text-[13px] group-hover:underline">{(t && (cleanText(t.subject) || cleanText(t.body).slice(0, 80))) || <span className="font-mono text-xs">{id}</span>}</span>
                  {t && <DecisionBadge action={t.decision?.action} />}
                </Link>
              </li>
            ))}
          </ol>
        )}
        {!active && <div className="mt-3 text-xs text-muted-foreground">Resolved {fmtDateTime(outage.updated_at)}</div>}
      </div>
    </article>
  );
}

export function OutagesView() {
  const outages = useOutageList();
  const gw = useGatewayDown();
  const active = outages.filter((o) => o.status === "active");
  const resolved = outages.filter((o) => o.status === "resolved");

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [outages.length]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Outages"
        description="Clusters of tickets sharing a failure signature are promoted to a major incident automatically."
      />
      {gw.down && outages.length === 0 ? (
        <GatewayOffline message={gw.error} />
      ) : gw.loading && outages.length === 0 ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : outages.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No outages detected" description="All systems nominal. Try “Simulate traffic → Outage storm” on the Queue page." />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Active ({active.length})</h2>
            {active.length ? active.map((o) => <OutageCard key={o.id} outage={o} />) : <p className="text-sm text-muted-foreground">No active outages.</p>}
          </section>
          {resolved.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Resolved ({resolved.length})</h2>
              {resolved.map((o) => (
                <OutageCard key={o.id} outage={o} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
