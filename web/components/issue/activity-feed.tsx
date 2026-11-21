"use client";

import { History, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/jira/primitives";
import { useNow } from "@/hooks/use-now";
import { api, errorMessage } from "@/lib/api";
import { fmtAgo, fmtDateTime, fmtMs } from "@/lib/format";
import { reasonLabel } from "@/lib/semantics";
import { useLive } from "@/lib/store";
import type { AuditEvent, TicketRecord } from "@/lib/types";

/** Turn an audit action code into a plain-English verb phrase. */
export function describeAction(action: string): string {
  const a = action.toLowerCase();
  if (a.includes("triaged")) {
    if (a.includes("escalat")) return "triaged the ticket and escalated it to on-call";
    if (a.includes("auto_draft") || a.includes("auto-draft")) return "triaged the ticket and drafted an AI reply";
    return "triaged the ticket";
  }
  if (a.includes("oncall") || a.includes("on_call") || a.includes("page")) {
    if (a.includes("fail")) return "tried to page the on-call engineer, but the push failed";
    if (a.includes("rate")) return "held the on-call page (rate limit — already paged recently)";
    return "paged the on-call engineer's phone";
  }
  if (a.includes("pii")) return "masked personal data before any AI model saw it";
  if (a.includes("approve")) return "approved and sent the reply";
  if (a.includes("edit")) return "edited the reply";
  if (a.includes("reject")) return "rejected the AI draft";
  if (a.includes("acknowledge")) return "acknowledged the escalation";
  if (a.includes("override")) return "overrode the AI classification";
  if (a.includes("pag") || a.includes("notif")) return "paged the on-call engineer";
  if (a.includes("outage") && a.includes("resolv")) return "resolved the major incident";
  if (a.includes("outage")) return "linked the ticket to a major incident";
  if (a.includes("creat") || a.includes("submit")) return "created the ticket";
  if (a.includes("fail") || a.includes("error")) return "reported a pipeline failure";
  return action.replace(/[_:.]/g, " ");
}

function DetailChips({ details }: { details: Record<string, unknown> }) {
  const chips: string[] = [];
  for (const [k, v] of Object.entries(details ?? {})) {
    if (v == null || v === "") continue;
    if (k === "reasons" && Array.isArray(v)) {
      const uniq = Array.from(new Set(v.map(String)));
      if (uniq.length) chips.push(`Reasons: ${uniq.map(reasonLabel).join(", ")}`);
    } else if (k === "latency_ms" && typeof v === "number") chips.push(`took ${fmtMs(v)}`);
    else if (k === "note") chips.push(`Note: “${String(v)}”`);
    else if (typeof v === "object") chips.push(`${k}: ${JSON.stringify(v)}`);
    else chips.push(`${k.replace(/_/g, " ")}: ${String(v)}`);
  }
  if (!chips.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c} className="max-w-full truncate rounded-[3px] bg-muted px-1.5 py-px text-[11px] text-muted-foreground" title={c}>
          {c}
        </span>
      ))}
    </div>
  );
}

interface Item {
  id: string;
  ts: string;
  actor: string;
  text: string;
  details?: Record<string, unknown>;
  raw?: string;
}

/** Jira-style activity feed for one ticket: audit events (GET /api/audit filtered by ticket_id) + ticket milestones. */
export function ActivityFeed({ ticket }: { ticket: TicketRecord }) {
  const audit = useLive((s) => s.audit);
  const now = useNow(15_000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listAudit(500)
      .then((items) => !cancelled && useLive.getState().setSnapshot({ audit: items }))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ticket.id]);

  const items = useMemo<Item[]>(() => {
    const evs: Item[] = audit
      .filter((a: AuditEvent) => a.ticket_id === ticket.id)
      .map((a) => ({ id: a.id, ts: a.ts, actor: a.actor, text: describeAction(a.action), details: a.details, raw: a.action }));
    if (!evs.some((e) => /created the ticket/.test(e.text)))
      evs.push({ id: "synthetic-created", ts: ticket.created_at, actor: ticket.operator || "customer", text: `created the ticket via ${ticket.source}` });
    if (ticket.paging && !evs.some((e) => /oncall|on_call|pag|notif/i.test(e.raw ?? ""))) {
      const p = ticket.paging;
      evs.push({
        id: "synthetic-paging",
        ts: p.at,
        actor: "notifier",
        text: p.state === "sent" ? `paged the on-call engineer (${p.channel})` : p.state === "rate_limited" ? "held the on-call page (rate limit)" : "failed to page on-call",
        details: p.keywords.length ? { keywords: p.keywords.join(", ") } : undefined,
      });
    }
    return evs.sort((a, b) => b.ts.localeCompare(a.ts));
  }, [audit, ticket]);

  return (
    <div>
      {loading && items.length <= 1 && (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading activity…
        </div>
      )}
      {error && <p className="mb-2 text-xs text-muted-foreground">Couldn&apos;t refresh the audit log ({error}); showing what&apos;s cached.</p>}
      {items.length === 0 ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <History className="size-4" /> No activity recorded for this ticket yet.
        </div>
      ) : (
        <ol className="space-y-4">
          {items.map((e) => (
            <li key={e.id} className="flex gap-3">
              <Avatar name={e.actor} />
              <div className="min-w-0 flex-1 text-sm">
                <div>
                  <span className="font-semibold">{e.actor}</span> <span className="text-foreground/80">{e.text}</span>
                </div>
                <div className="text-xs text-muted-foreground" title={fmtDateTime(e.ts)}>
                  {fmtAgo(e.ts, now)} · {fmtDateTime(e.ts)}
                </div>
                {e.details && <DetailChips details={e.details} />}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
