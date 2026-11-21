"use client";

import { Ban, Check, CheckCheck, MessageSquareText, Save, ShieldAlert, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useNow } from "@/hooks/use-now";
import { cleanText, fmtAgo, fmtPct } from "@/lib/format";
import type { TicketRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { HumanBadge } from "./badges";
import { CitationText } from "./citation-text";
import { OverrideDialog } from "./override-dialog";
import { Meter, Section } from "./section";
import { useTicketActions } from "./use-ticket-actions";

export function DraftPanel({ ticket, onCite }: { ticket: TicketRecord; onCite: (id: string) => void }) {
  const draft = ticket.draft;
  const draftReply = cleanText(draft?.reply);
  const original = ticket.human.final_reply ?? draftReply;
  const [text, setText] = useState(original);
  const [mode, setMode] = useState<"preview" | "edit">(draft?.reply ? "preview" : "edit");
  const [note, setNote] = useState("");
  const { run, busy } = useTicketActions(ticket.id);
  const now = useNow(15_000);
  const escalated = ticket.decision?.action === "escalate";
  const dirty = text !== draftReply;
  const hitIds = ticket.retrieval?.hits.map((h) => h.ticket_id) ?? [];
  const h = ticket.human;
  const finalized = h.state === "approved" || h.state === "rejected";

  return (
    <Section
      title="Draft reply"
      icon={MessageSquareText}
      right={
        draft && !draft.refused ? (
          <span
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[10px] font-semibold",
              draft.grounded
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
          >
            {draft.grounded ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
            {draft.grounded ? "Grounded" : "Ungrounded"}
          </span>
        ) : null
      }
    >
      {draft && (
        <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Groundedness</span>
              <span className="tabular font-medium">{draft.groundedness_score != null ? fmtPct(draft.groundedness_score) : "—"}</span>
            </div>
            <Meter
              value={draft.groundedness_score ?? 0}
              className="mt-1"
              barClassName={(draft.groundedness_score ?? 0) >= 0.7 ? "bg-emerald-500" : (draft.groundedness_score ?? 0) >= 0.4 ? "bg-amber-500" : "bg-red-500"}
            />
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground sm:justify-end">
            <span>
              <span className="tabular font-medium text-foreground">{draft.cited_ticket_ids.length}</span> citations
            </span>
            <span className="font-mono">{draft.model}</span>
            <span className="font-mono uppercase">{draft.language}</span>
          </div>
        </div>
      )}

      {draft?.refused && (
        <div className="mb-3 flex gap-2.5 rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3 text-sm">
          <Ban className="mt-0.5 size-4 shrink-0 text-red-500" />
          <div>
            <div className="font-medium text-red-700 dark:text-red-300">Draft refused</div>
            <div className="text-[13px] text-foreground/80">{draft.refusal_reason ?? "The drafter declined to answer this ticket."}</div>
          </div>
        </div>
      )}

      {draft && draft.unsupported_requests.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <TriangleAlert className="size-3.5" /> Requests the draft cannot support
          </div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-foreground/80">
            {draft.unsupported_requests.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {!draft && (
        <p className="mb-3 text-xs text-muted-foreground">No AI draft for this ticket — write a reply manually below.</p>
      )}

      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-2 py-1">
          <div className="flex gap-0.5 text-[11px]">
            {(["preview", "edit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded px-2 py-0.5 font-medium capitalize transition-colors",
                  mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          {dirty && <span className="text-[10px] font-medium text-sky-600 dark:text-sky-400">edited by human</span>}
        </div>
        {mode === "preview" ? (
          <div className="min-h-28 whitespace-pre-wrap break-words p-3 text-[13px] leading-relaxed">
            {text ? (
              <CitationText text={text} knownIds={hitIds} citedIds={draft?.cited_ticket_ids ?? []} onCite={onCite} />
            ) : (
              <span className="text-muted-foreground">Empty reply.</span>
            )}
          </div>
        ) : (
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-44 rounded-none border-0 bg-transparent font-[inherit] text-[13px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
            placeholder="Write or edit the customer reply…"
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-2 text-xs">
        <span className="text-muted-foreground">Human review</span>
        <HumanBadge state={h.state} />
        {h.by && (
          <span className="text-muted-foreground">
            by <span className="font-medium text-foreground">{h.by}</span> · {fmtAgo(h.at, now)}
          </span>
        )}
        {h.note && <span className="italic text-muted-foreground">“{h.note}”</span>}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the audit log (optional)" className="h-8 text-xs" />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="bg-emerald-600 text-white hover:bg-emerald-600/90"
            disabled={!!busy || !text.trim() || finalized}
            onClick={() => void run("approve", { reply: text, note: note || undefined })}
          >
            <Check /> {busy === "approve" ? "Sending…" : "Approve & Send"}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy || !dirty} onClick={() => void run("edit", { reply: text, note: note || undefined })}>
            <Save /> {busy === "edit" ? "Saving…" : "Save edit"}
          </Button>
          {escalated && (
            <Button
              size="sm"
              variant="outline"
              className="border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-300"
              disabled={!!busy || h.state === "acknowledged"}
              onClick={() => void run("acknowledge", { note: note || undefined })}
            >
              <CheckCheck /> {busy === "acknowledge" ? "Acknowledging…" : h.state === "acknowledged" ? "Acknowledged" : "Acknowledge escalation"}
            </Button>
          )}
          <OverrideDialog
            classification={ticket.classification}
            busy={busy === "override"}
            onSubmit={(override, n) => run("override", { override, note: n || undefined })}
          />
          <Button size="sm" variant="destructive" className="ml-auto" disabled={!!busy || h.state === "rejected"} onClick={() => void run("reject", { note: note || undefined })}>
            <X /> {busy === "reject" ? "Rejecting…" : "Reject"}
          </Button>
        </div>
      </div>
    </Section>
  );
}
