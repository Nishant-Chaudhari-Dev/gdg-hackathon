"use client";

import { Ban, Pencil, Save, ShieldAlert, ShieldCheck, TriangleAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CitationText } from "@/components/ticket/citation-text";
import { Meter } from "@/components/ticket/section";
import { fmtPct } from "@/lib/format";
import type { TicketRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ReplyEditor {
  text: string;
  setText: (s: string) => void;
  mode: "preview" | "edit";
  setMode: (m: "preview" | "edit") => void;
  dirty: boolean;
  reset: () => void;
  note: string;
  setNote: (s: string) => void;
}

export function DraftTab({
  ticket,
  editor,
  onCite,
  onSaveEdit,
  saving,
  locked,
}: {
  ticket: TicketRecord;
  editor: ReplyEditor;
  onCite: (id: string) => void;
  onSaveEdit: () => void;
  saving: boolean;
  locked: boolean;
}) {
  const draft = ticket.draft;
  const hitIds = ticket.retrieval?.hits.map((h) => h.ticket_id) ?? [];
  const g = draft?.groundedness_score ?? null;

  return (
    <div className="space-y-3">
      {draft && !draft.refused && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-muted/60 px-3 py-2 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-1 font-semibold",
              draft.grounded ? "text-[#216e4e] dark:text-[#7ee2b8]" : "text-[#a54800] dark:text-[#fec195]",
            )}
            title={draft.grounded ? "Every claim is backed by a cited past ticket" : "Parts of this reply are not backed by past tickets — check carefully"}
          >
            {draft.grounded ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
            {draft.grounded ? "Grounded in past tickets" : "Not fully grounded — check carefully"}
          </span>
          <span className="flex min-w-40 flex-1 items-center gap-2" title="How much of the reply is supported by the cited tickets">
            <span className="text-muted-foreground">Groundedness</span>
            <Meter
              value={g ?? 0}
              className="max-w-32"
              barClassName={(g ?? 0) >= 0.7 ? "bg-[#22a06b]" : (g ?? 0) >= 0.4 ? "bg-[#e2a03f]" : "bg-[#e2483d]"}
            />
            <span className="tabular font-medium">{g != null ? fmtPct(g) : "—"}</span>
          </span>
          <span className="text-muted-foreground">
            <span className="tabular font-medium text-foreground">{draft.cited_ticket_ids.length}</span> citation{draft.cited_ticket_ids.length === 1 ? "" : "s"}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {draft.model} · {draft.language.toUpperCase()}
          </span>
        </div>
      )}

      {draft?.refused && (
        <div className="flex gap-2.5 rounded-md border-l-4 border-l-[#c9372c] bg-[#ffeceb] p-3 text-sm dark:bg-[#42221f]">
          <Ban className="mt-0.5 size-4 shrink-0 text-[#c9372c]" />
          <div>
            <div className="font-semibold">The AI declined to draft a reply</div>
            <div className="text-[13px] text-foreground/80">{draft.refusal_reason ?? "The drafter declined to answer this ticket."}</div>
          </div>
        </div>
      )}

      {draft && draft.unsupported_requests.length > 0 && (
        <div className="rounded-md border-l-4 border-l-[#e2a03f] bg-[#fff7d6] p-3 dark:bg-[#3d3104]">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <TriangleAlert className="size-3.5 text-[#b38600]" /> The customer asked for things the past tickets can&apos;t answer
          </div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-foreground/80">
            {draft.unsupported_requests.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {!draft && <p className="text-sm text-muted-foreground">No AI draft for this ticket — write a reply manually below.</p>}

      <div className={cn("overflow-hidden rounded-md border", editor.mode === "edit" && "border-ring ring-2 ring-ring/25")}>
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs">
          <span className="font-medium">{editor.mode === "edit" ? "Editing reply" : "Reply to customer"}</span>
          {editor.dirty && <span className="rounded-[3px] bg-[#cce0ff] px-1 text-[10px] font-bold text-[#0055cc] uppercase dark:bg-[#09326c] dark:text-[#85b8ff]">Edited by you</span>}
          <span className="ml-auto flex gap-1">
            {editor.mode === "preview" ? (
              <Button size="xs" variant="ghost" onClick={() => editor.setMode("edit")} disabled={locked}>
                <Pencil /> Edit
              </Button>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => editor.setMode("preview")}>
                Preview citations
              </Button>
            )}
          </span>
        </div>
        {editor.mode === "preview" ? (
          <div className="min-h-28 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
            {editor.text ? (
              <CitationText text={editor.text} knownIds={hitIds} citedIds={draft?.cited_ticket_ids ?? []} onCite={onCite} />
            ) : (
              <span className="text-muted-foreground">Empty reply.</span>
            )}
          </div>
        ) : (
          <Textarea
            autoFocus
            value={editor.text}
            onChange={(e) => editor.setText(e.target.value)}
            className="min-h-48 rounded-none border-0 bg-transparent text-sm leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
            placeholder="Write or edit the customer reply…"
          />
        )}
      </div>
      {editor.mode === "preview" && hitIds.length > 0 && (
        <p className="text-xs text-muted-foreground">Tip: click a blue ticket chip like [TKT-…] to jump to the past ticket the AI used.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={editor.note}
          onChange={(e) => editor.setNote(e.target.value)}
          placeholder="Optional note for the audit log (sent with your next action)"
          className="h-8 min-w-56 flex-1 text-xs"
        />
        {editor.dirty && (
          <>
            <Button size="sm" variant="ghost" onClick={editor.reset} disabled={saving}>
              <Undo2 /> Discard
            </Button>
            <Button size="sm" variant="secondary" onClick={onSaveEdit} disabled={saving || locked}>
              <Save /> {saving ? "Saving…" : "Save edit"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
