"use client";

import Link from "next/link";
import { BellOff, BellRing, ShieldAlert, Siren, Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ComponentTag, IssueTypeIcon, Lozenge, PriorityIcon } from "@/components/jira/primitives";
import { LangBadge } from "@/components/ticket/badges";
import { Meter } from "@/components/ticket/section";
import { useNow } from "@/hooks/use-now";
import { fmtAgo, fmtDateTime, fmtMs, fmtPct } from "@/lib/format";
import { statusLozenge } from "@/lib/issue";
import { LANGUAGE_LABELS, STAGES, stageColor } from "@/lib/semantics";
import { useLive } from "@/lib/store";
import type { TicketRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

function Row({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-3 py-1.5 text-sm">
      <dt className="pt-0.5 text-xs font-semibold text-muted-foreground" title={help}>
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border">
      <div className="border-b px-3 py-2 text-sm font-semibold">{title}</div>
      <dl className="px-3 py-1.5">{children}</dl>
    </div>
  );
}

function confTone(c: number) {
  if (c < 0.4) return "bg-[#e2a03f]";
  if (c < 0.6) return "bg-[#1d7afc]";
  return "bg-[#22a06b]";
}

function LatencyBreakdown({ timings, latency }: { timings: Record<string, number>; latency?: number | null }) {
  const known: string[] = STAGES.map((s) => s.key);
  const keys = [...known.filter((k) => k in timings), ...Object.keys(timings).filter((k) => k !== "total" && !known.includes(k))];
  const parts = keys.map((k) => ({ key: k, ms: timings[k] ?? 0 }));
  const sum = parts.reduce((a, b) => a + b.ms, 0);
  const total = latency ?? timings.total ?? sum;
  const label = (k: string) => STAGES.find((s) => s.key === k)?.label ?? k;
  if (!parts.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div>
      <div className="tabular font-medium">{fmtMs(total)} total</div>
      <div className="mt-1 flex h-2 w-full gap-px overflow-hidden rounded-[2px]">
        {parts.map((p) => (
          <Tooltip key={p.key}>
            <TooltipTrigger render={<div className="h-full min-w-[3px] cursor-default" />} style={{ width: `${(p.ms / (sum || 1)) * 100}%`, background: stageColor(p.key) }} />
            <TooltipContent>
              {label(p.key)}: {fmtMs(p.ms)}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        {parts.map((p) => (
          <div key={p.key} className="flex items-center gap-1">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: stageColor(p.key) }} />
            <span className="text-muted-foreground">{label(p.key)}</span>
            <span className="tabular ml-auto">{fmtMs(p.ms)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DetailsSidebar({ ticket }: { ticket: TicketRecord }) {
  const now = useNow(15_000);
  const outage = useLive((s) => (ticket.outage_id ? s.outages[ticket.outage_id] : undefined));
  const c = ticket.classification;
  const lz = statusLozenge(ticket);
  const override = ticket.human.state === "overridden" ? ticket.human.override : null;
  const esc = ticket.decision?.action === "escalate";

  return (
    <div className="space-y-3">
      <Group title="Details">
        <Row label="Status">
          <Lozenge tone={lz.tone} title={lz.help}>
            {lz.label}
          </Lozenge>
          <div className="mt-0.5 text-xs text-muted-foreground">{lz.help}</div>
        </Row>
        <Row label="Decision" help="What the escalation gate decided">
          {ticket.decision ? (
            <span className={cn("inline-flex items-center gap-1.5 font-medium", esc ? "text-[#c9372c] dark:text-[#fd9891]" : "text-[#216e4e] dark:text-[#7ee2b8]")}>
              {esc ? <ShieldAlert className="size-4" /> : <Sparkles className="size-4" />}
              {esc ? "Escalate to on-call" : "Auto-draft"}
            </span>
          ) : (
            <span className="text-muted-foreground">Not decided yet</span>
          )}
        </Row>
        <Row label="Priority">
          <PriorityIcon priority={c?.priority.label} withLabel />
          {override?.priority && <div className="text-xs text-[#a54800] dark:text-[#fec195]">overridden by {ticket.human.by}</div>}
        </Row>
        <Row label="Type">{c ? <IssueTypeIcon type={c.type.label} withLabel /> : <span className="text-muted-foreground">—</span>}</Row>
        <Row label="Component" help="The support queue (team) the model routed this ticket to">
          {c ? <ComponentTag className="text-foreground">{c.queue.label}</ComponentTag> : <span className="text-muted-foreground">—</span>}
        </Row>
        <Row label="Language">
          <span className="inline-flex items-center gap-1.5">
            <LangBadge lang={ticket.language} /> {LANGUAGE_LABELS[ticket.language] ?? ticket.language}
          </span>
        </Row>
        <Row label="Confidence" help="How sure the classifier is about each field (calibrated; below ~55% the gate escalates)">
          {c ? (
            <div className="space-y-1">
              {(["type", "queue", "priority"] as const).map((h) => (
                <div key={h} className="grid grid-cols-[56px_minmax(0,1fr)_36px] items-center gap-2 text-xs">
                  <span className="text-muted-foreground capitalize">{h}</span>
                  <Meter value={c[h].confidence} barClassName={confTone(c[h].confidence)} />
                  <span className="tabular text-right">{fmtPct(c[h].confidence)}</span>
                </div>
              ))}
              <div className="text-xs text-muted-foreground">
                Overall <span className={cn("tabular font-semibold", c.confidence < 0.4 ? "text-[#a54800] dark:text-[#fec195]" : "text-foreground")}>{fmtPct(c.confidence)}</span>
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Row>
        <Row label="On-call paging" help="Critical escalations push an alert to the on-call engineer's phone">
          {ticket.paging ? (
            <div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 font-medium",
                  ticket.paging.state === "sent" ? "text-[#c9372c] dark:text-[#fd9891]" : "text-[#a54800] dark:text-[#fec195]",
                )}
              >
                <BellRing className="size-4" />
                {ticket.paging.state === "sent" ? "Phone paged" : ticket.paging.state === "rate_limited" ? "Page held (rate limit)" : "Page failed"}
              </span>
              <div className="text-xs text-muted-foreground">
                {fmtAgo(ticket.paging.at, now)} via {ticket.paging.channel}
              </div>
              {ticket.paging.keywords.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {ticket.paging.keywords.map((k) => (
                    <span key={k} className="rounded-[3px] bg-muted px-1 font-mono text-[10px]">
                      {k}
                    </span>
                  ))}
                </div>
              )}
              {ticket.paging.detail && (
                <div className="mt-1 line-clamp-2 text-xs break-all text-muted-foreground" title={ticket.paging.detail}>
                  {ticket.paging.detail}
                </div>
              )}
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <BellOff className="size-4" /> Not paged
            </span>
          )}
        </Row>
        <Row label="Linked incident">
          {ticket.outage_id ? (
            <Link href={`/incidents#${ticket.outage_id}`} className="inline-flex items-start gap-1.5 text-primary hover:underline">
              <Siren className="mt-0.5 size-4 shrink-0 text-[#c9372c]" />
              <span>{outage?.title ?? ticket.outage_id}</span>
            </Link>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Row>
      </Group>

      <Group title="More fields">
        <Row label="Created">
          <span title={fmtDateTime(ticket.created_at)}>{fmtAgo(ticket.created_at, now)}</span>
          <div className="text-xs text-muted-foreground">
            {fmtDateTime(ticket.created_at)} · via {ticket.source}
            {ticket.operator ? ` by ${ticket.operator}` : ""}
          </div>
        </Row>
        <Row label="Updated">
          <span title={fmtDateTime(ticket.updated_at)}>{fmtAgo(ticket.updated_at, now)}</span>
        </Row>
        {ticket.human.by && (
          <Row label="Handled by">
            {ticket.human.by} <span className="text-xs text-muted-foreground">· {fmtAgo(ticket.human.at, now)}</span>
          </Row>
        )}
        <Row label="Pipeline time" help="How long each AI stage took">
          <LatencyBreakdown timings={ticket.timings_ms} latency={ticket.latency_ms} />
        </Row>
        <Row label="Models">
          <div className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
            {c && <div title="Classifier">clf · {c.model_version}</div>}
            {ticket.retrieval && <div title="Retriever">ret · {ticket.retrieval.retriever_version}</div>}
            {ticket.draft && <div title="Drafter (LLM)">llm · {ticket.draft.model}</div>}
            {ticket.decision && <div title="Gate rules">gate · {ticket.decision.rule_version}</div>}
            {!c && !ticket.retrieval && !ticket.draft && <div>—</div>}
          </div>
        </Row>
        {ticket.signature.length > 0 && (
          <Row label="Signature" help="Keywords used to group similar tickets into a major incident">
            <div className="flex flex-wrap gap-1">
              {ticket.signature.slice(0, 8).map((s) => (
                <span key={s} className="rounded-[3px] bg-muted px-1 font-mono text-[10px]">
                  {s}
                </span>
              ))}
            </div>
          </Row>
        )}
      </Group>
    </div>
  );
}
