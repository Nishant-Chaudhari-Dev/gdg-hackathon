"use client";

import Link from "next/link";
import { BellRing, AlertOctagon, Clock, Hash, Inbox, Loader2, Siren } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/layout/empty-state";
import { useNow } from "@/hooks/use-now";
import { api, errorMessage, isNotFound } from "@/lib/api";
import { cleanText, fmtAgo, fmtDateTime } from "@/lib/format";
import { useLive } from "@/lib/store";
import type { TicketRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DecisionBadge, LangBadge, PriorityBadge, StatusBadge } from "./badges";
import { ClassificationPanel } from "./classification-panel";
import { DecisionBanner } from "./decision-banner";
import { DraftPanel } from "./draft-panel";
import { LatencyPanel } from "./latency-bar";
import { PiiPanel } from "./pii-panel";
import { PrecedentsPanel, precedentAnchor } from "./precedents-panel";

/** Loads a ticket from the live store, falling back to GET /api/tickets/:id. */
export function useTicket(id: string | null) {
  const ticket = useLive((s) => (id ? s.tickets[id] : undefined));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id || ticket) return;
    let cancelled = false;
    api
      .getTicket(id)
      .then((t) => !cancelled && useLive.getState().upsertTicket(t))
      .catch((e) => !cancelled && setError(isNotFound(e) ? "Ticket not found" : errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [id, ticket]);
  return { ticket, error: ticket ? null : error };
}

export function TicketDetailSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function Header({ ticket }: { ticket: TicketRecord }) {
  const now = useNow(15_000);
  const outages = useLive((s) => s.outages);
  const outage = ticket.outage_id ? outages[ticket.outage_id] : undefined;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={ticket.status} />
        {ticket.decision && <DecisionBadge action={ticket.decision.action} />}
        {ticket.classification && <PriorityBadge priority={ticket.classification.priority.label} />}
        <LangBadge lang={ticket.language} />
        {ticket.paging && (
          <span
            title={`${ticket.paging.detail ?? ""}${ticket.paging.keywords.length ? ` · keywords: ${ticket.paging.keywords.join(", ")}` : ""}`}
            className={
              ticket.paging.state === "sent"
                ? "inline-flex h-5 items-center gap-1 rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-1.5 text-[11px] font-medium text-fuchsia-700 dark:text-fuchsia-300"
                : "inline-flex h-5 items-center gap-1 rounded-md border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground"
            }
          >
            <BellRing className="size-3" />
            {ticket.paging.state === "sent" ? "On-call paged" : ticket.paging.state === "rate_limited" ? "Page held (rate limit)" : "Page failed"}
          </span>
        )}
        {ticket.outage_id && (
          <Link
            href={`/outages#${ticket.outage_id}`}
            className="inline-flex h-5 items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 text-[11px] font-medium text-red-700 hover:bg-red-500/20 dark:text-red-300"
          >
            <Siren className="size-3" /> {outage?.title ?? "Linked outage"}
          </Link>
        )}
      </div>
      <h2 className="text-base font-semibold leading-snug tracking-tight md:text-lg">{cleanText(ticket.subject) || <span className="text-muted-foreground">(no subject)</span>}</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-mono">
          <Hash className="size-3" />
          {ticket.id}
        </span>
        <span className="inline-flex items-center gap-1" title={fmtDateTime(ticket.created_at)}>
          <Clock className="size-3" />
          {fmtAgo(ticket.created_at, now)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Inbox className="size-3" />
          {ticket.source}
        </span>
        {ticket.operator && <span>submitted by {ticket.operator}</span>}
        {ticket.signature.length > 0 && (
          <span className="inline-flex items-center gap-1">
            sig:
            {ticket.signature.slice(0, 6).map((s) => (
              <span key={s} className="rounded bg-muted px-1 font-mono text-[10px]">
                {s}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

export function TicketDetail({ ticket, className }: { ticket: TicketRecord; className?: string }) {
  const [highlight, setHighlight] = useState<{ id: string; n: number } | null>(null);

  const onCite = useCallback((id: string) => {
    document.getElementById(precedentAnchor(id))?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight((h) => ({ id, n: (h?.n ?? 0) + 1 }));
  }, []);

  const inFlight = ticket.status === "queued" || ticket.status === "processing";

  return (
    <div className={cn("@container space-y-4", className)}>
      <Header ticket={ticket} />

      {inFlight && (
        <div className="flex items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] p-4 text-sm">
          <Loader2 className="size-4 animate-spin text-sky-500" />
          <div>
            <div className="font-medium">{ticket.status === "queued" ? "Queued for triage" : "Pipeline running"}</div>
            <div className="text-xs text-muted-foreground">Results stream in live as soon as the orchestrator finishes.</div>
          </div>
        </div>
      )}

      {ticket.status === "failed" && (
        <div className="flex gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm">
          <AlertOctagon className="mt-0.5 size-4 shrink-0 text-red-500" />
          <div>
            <div className="font-medium text-red-700 dark:text-red-300">Pipeline failed</div>
            <div className="mt-0.5 font-mono text-xs text-foreground/80">{ticket.error ?? "Unknown error"}</div>
            <div className="mt-1 text-xs text-muted-foreground">Route this ticket manually; the failure is recorded in the audit log.</div>
          </div>
        </div>
      )}

      {ticket.decision && <DecisionBanner decision={ticket.decision} />}

      {/* Narrow: Classification | Latency, then Draft, Precedents, Ticket (via `contents` + order).
          Wide (@5xl): main column (Draft, Precedents) + side column (Classification, Latency, Ticket). */}
      <div className="grid grid-cols-1 items-start gap-4 @xl:grid-cols-2 @5xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <div className="contents @5xl:col-start-1 @5xl:row-start-1 @5xl:block @5xl:min-w-0 @5xl:space-y-4">
          <div className="order-2 min-w-0 @xl:col-span-2">
            {ticket.status === "done" || ticket.draft ? (
              <DraftPanel key={ticket.id} ticket={ticket} onCite={onCite} />
            ) : inFlight ? (
              <Skeleton className="h-56 w-full" />
            ) : null}
          </div>
          <div className="order-3 min-w-0 @xl:col-span-2">
            {ticket.retrieval ? (
              <PrecedentsPanel
                key={highlight ? `${highlight.id}-${highlight.n}` : "none"}
                retrieval={ticket.retrieval}
                citedIds={ticket.draft?.cited_ticket_ids ?? []}
                highlighted={highlight?.id ?? null}
                queryLang={ticket.language}
              />
            ) : inFlight ? (
              <Skeleton className="h-48 w-full" />
            ) : null}
          </div>
        </div>
        <div className="contents @5xl:col-start-2 @5xl:row-start-1 @5xl:block @5xl:min-w-0 @5xl:space-y-4">
          <div className="order-1 min-w-0">
            {ticket.classification ? (
              <ClassificationPanel classification={ticket.classification} language={ticket.language} human={ticket.human} />
            ) : inFlight ? (
              <Skeleton className="h-52 w-full" />
            ) : null}
          </div>
          <div className="order-1 min-w-0">
            {Object.keys(ticket.timings_ms).length > 0 && <LatencyPanel timings={ticket.timings_ms} latency={ticket.latency_ms} />}
          </div>
          <div className="order-4 min-w-0 @xl:col-span-2">
            <PiiPanel ticket={ticket} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function TicketDetailById({ id }: { id: string }) {
  const { ticket, error } = useTicket(id);
  if (ticket) return <TicketDetail ticket={ticket} />;
  if (error) return <EmptyState icon={AlertOctagon} title={error} description={<span className="font-mono">{id}</span>} />;
  return <TicketDetailSkeleton />;
}
