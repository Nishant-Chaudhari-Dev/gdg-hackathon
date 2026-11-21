"use client";

import Link from "next/link";
import { AlertOctagon, Check, CheckCheck, ExternalLink, Link2, Loader2, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/layout/empty-state";
import { IssueKey, IssueTypeIcon, Lozenge } from "@/components/jira/primitives";
import { OverrideDialog } from "@/components/ticket/override-dialog";
import { PrecedentsList, precedentAnchor } from "@/components/ticket/precedents-panel";
import { useTicketActions } from "@/components/ticket/use-ticket-actions";
import { api, errorMessage, isNotFound } from "@/lib/api";
import { cleanText } from "@/lib/format";
import { statusLozenge, summaryOf } from "@/lib/issue";
import { useLive } from "@/lib/store";
import type { TicketRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ActivityFeed } from "./activity-feed";
import { Description } from "./description";
import { DetailsSidebar } from "./details-sidebar";
import { DraftTab, type ReplyEditor } from "./draft-tab";
import { EscalationCallout } from "./escalation-callout";

/** Loads a ticket from the live store, falling back to GET /api/tickets/:id. */
export function useTicket(id: string | null) {
  const ticket = useLive((s) => (id ? s.tickets[id] : undefined));
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  useEffect(() => {
    if (!id || ticket) return;
    let cancelled = false;
    api
      .getTicket(id)
      .then((t) => !cancelled && useLive.getState().upsertTicket(t))
      .catch((e) => !cancelled && setError({ id, message: isNotFound(e) ? "Ticket not found" : errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [id, ticket]);
  return { ticket, error: ticket || error?.id !== id ? null : (error?.message ?? null) };
}

export function IssueSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-8 w-2/3" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  );
}

function useReplyEditor(ticket: TicketRecord): ReplyEditor {
  const original = ticket.human.final_reply ?? cleanText(ticket.draft?.reply);
  const [edited, setEdited] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [note, setNote] = useState("");
  const text = edited ?? original;
  return {
    text,
    setText: setEdited,
    mode: !original && edited == null ? "edit" : mode,
    setMode,
    dirty: edited != null && edited !== original,
    reset: () => {
      setEdited(null);
      setMode("preview");
    },
    note,
    setNote,
  };
}

function ActionBar({ ticket, editor, onEdit }: { ticket: TicketRecord; editor: ReplyEditor; onEdit: () => void }) {
  const { run, busy } = useTicketActions(ticket.id);
  const h = ticket.human.state;
  const ready = ticket.status === "done";
  const esc = ticket.decision?.action === "escalate";
  const sent = h === "approved";
  const rejected = h === "rejected";
  const note = editor.note.trim() || undefined;
  const after = (ok: unknown) => {
    if (ok) {
      editor.setNote("");
      editor.reset();
    }
  };

  const approveBtn = (
    <Button
      key="approve"
      variant={esc && h !== "acknowledged" ? "secondary" : "default"}
      disabled={!!busy || !ready || !editor.text.trim() || sent || rejected}
      onClick={async () => after(await run("approve", { reply: editor.text, note }))}
      title="Send this reply to the customer"
    >
      <Check /> {busy === "approve" ? "Sending…" : sent ? "Sent" : "Approve & send"}
    </Button>
  );
  const ackBtn = esc ? (
    <Button
      key="ack"
      variant={h === "pending" ? "default" : "secondary"}
      disabled={!!busy || !ready || h === "acknowledged"}
      onClick={async () => after(await run("acknowledge", { note }))}
      title="Confirm an engineer has picked up this escalation"
    >
      <CheckCheck /> {busy === "acknowledge" ? "Acknowledging…" : h === "acknowledged" ? "Acknowledged" : "Acknowledge escalation"}
    </Button>
  ) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {esc ? [ackBtn, approveBtn] : [approveBtn]}
      <Button variant="secondary" disabled={!ready || sent || rejected} onClick={onEdit} title="Change the reply before sending">
        <Pencil /> Edit reply
      </Button>
      <OverrideDialog
        classification={ticket.classification}
        busy={busy === "override"}
        onSubmit={(override, n) => run("override", { override, note: n || undefined })}
      />
      <Button
        variant="destructive"
        disabled={!!busy || !ready || rejected || sent}
        onClick={async () => after(await run("reject", { note }))}
        title="Discard the AI draft — nothing is sent"
      >
        <X /> {busy === "reject" ? "Rejecting…" : rejected ? "Rejected" : "Reject"}
      </Button>
    </div>
  );
}

export function IssueView({
  ticket,
  variant = "page",
  onClose,
}: {
  ticket: TicketRecord;
  variant?: "page" | "panel";
  onClose?: () => void;
}) {
  const editor = useReplyEditor(ticket);
  const [tab, setTab] = useState<string>("draft");
  const [highlight, setHighlight] = useState<{ id: string; n: number } | null>(null);
  const lz = statusLozenge(ticket);
  const inFlight = ticket.status === "queued" || ticket.status === "processing";

  const onCite = useCallback((id: string) => {
    setTab("similar");
    setHighlight((h) => ({ id, n: (h?.n ?? 0) + 1 }));
    setTimeout(() => document.getElementById(precedentAnchor(id))?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/tickets/${encodeURIComponent(ticket.id)}`);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  const ticketActions = useTicketActions(ticket.id);

  return (
    <div className="@container">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground hover:underline">
          Service Desk
        </Link>
        <span>/</span>
        <span className="inline-flex items-center gap-1.5">
          <IssueTypeIcon type={ticket.classification?.type.label} />
          <IssueKey id={ticket.id} className="text-sm text-muted-foreground" />
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={copyLink} aria-label="Copy link to ticket" title="Copy link">
            <Link2 />
          </Button>
          {variant === "panel" && (
            <Button
              variant="ghost"
              size="icon-sm"
              render={<Link href={`/tickets/${encodeURIComponent(ticket.id)}`} />}
              nativeButton={false}
              aria-label="Open full page"
              title="Open full page"
            >
              <ExternalLink />
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" title="Close (Esc)">
              <X />
            </Button>
          )}
        </div>
      </div>

      <h1 className="mt-2 text-xl leading-snug font-semibold tracking-tight text-foreground md:text-2xl">{summaryOf(ticket, 300)}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Lozenge tone={lz.tone} title={lz.help}>
          {lz.label}
        </Lozenge>
        <span className="text-xs text-muted-foreground">{lz.help}</span>
      </div>

      <div className="mt-4">
        <ActionBar
          ticket={ticket}
          editor={editor}
          onEdit={() => {
            setTab("draft");
            editor.setMode("edit");
            setTimeout(() => document.getElementById(`issue-tabs-${ticket.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
          }}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {inFlight && (
            <div className="flex items-center gap-3 rounded-md border-l-4 border-l-[#1d7afc] bg-[#e9f2ff] p-3 text-sm dark:bg-[#1c2b41]">
              <Loader2 className="size-4 animate-spin text-[#1d7afc]" />
              <div>
                <div className="font-semibold">{ticket.status === "queued" ? "Waiting for the AI pipeline" : "AI pipeline running"}</div>
                <div className="text-xs text-muted-foreground">Classification, similar tickets and the draft appear here live as soon as they&apos;re ready.</div>
              </div>
            </div>
          )}
          {ticket.status === "failed" && (
            <div className="flex gap-3 rounded-md border-l-4 border-l-[#c9372c] bg-[#ffeceb] p-3 text-sm dark:bg-[#42221f]">
              <AlertOctagon className="mt-0.5 size-4 shrink-0 text-[#c9372c]" />
              <div>
                <div className="font-semibold">The AI pipeline failed on this ticket</div>
                <div className="mt-0.5 font-mono text-xs text-foreground/80">{ticket.error ?? "Unknown error"}</div>
                <div className="mt-1 text-xs text-muted-foreground">Handle it manually; the failure is recorded in the audit log.</div>
              </div>
            </div>
          )}

          <Description ticket={ticket} />

          {ticket.decision && <EscalationCallout decision={ticket.decision} />}

          <Tabs id={`issue-tabs-${ticket.id}`} value={tab} onValueChange={(v) => setTab(String(v))} className="scroll-mt-4 gap-3">
            <TabsList variant="line" className="w-full justify-start border-b pb-[5px]">
              <TabsTrigger value="draft" className="flex-none px-2">
                AI draft
                {editor.dirty && <span className="size-1.5 rounded-full bg-primary" />}
              </TabsTrigger>
              <TabsTrigger value="similar" className="flex-none px-2">
                Similar past tickets
                {ticket.retrieval && (
                  <span className="tabular rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{ticket.retrieval.hits.length}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="activity" className="flex-none px-2">
                Activity
              </TabsTrigger>
            </TabsList>
            <TabsContent value="draft">
              {inFlight && !ticket.draft ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <DraftTab
                  ticket={ticket}
                  editor={editor}
                  onCite={onCite}
                  saving={ticketActions.busy === "edit"}
                  locked={ticket.human.state === "approved" || ticket.human.state === "rejected"}
                  onSaveEdit={async () => {
                    const ok = await ticketActions.run("edit", { reply: editor.text, note: editor.note.trim() || undefined });
                    if (ok) {
                      editor.setNote("");
                      editor.reset();
                    }
                  }}
                />
              )}
            </TabsContent>
            <TabsContent value="similar">
              {ticket.retrieval ? (
                <PrecedentsList
                  key={highlight ? `${highlight.id}-${highlight.n}` : "none"}
                  retrieval={ticket.retrieval}
                  citedIds={ticket.draft?.cited_ticket_ids ?? []}
                  highlighted={highlight?.id ?? null}
                  queryLang={ticket.language}
                />
              ) : inFlight ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <p className="text-sm text-muted-foreground">No search results recorded for this ticket.</p>
              )}
            </TabsContent>
            <TabsContent value="activity">
              <ActivityFeed ticket={ticket} />
            </TabsContent>
          </Tabs>
        </div>
        <aside className={cn("min-w-0", variant === "page" && "@4xl:sticky @4xl:top-20")}>
          <DetailsSidebar ticket={ticket} />
        </aside>
      </div>
    </div>
  );
}

export function IssueById({ id, variant, onClose }: { id: string; variant?: "page" | "panel"; onClose?: () => void }) {
  const { ticket, error } = useTicket(id);
  if (ticket) return <IssueView key={ticket.id} ticket={ticket} variant={variant} onClose={onClose} />;
  const close = onClose ? (
    <div className="mb-3 flex justify-end">
      <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" title="Close (Esc)">
        <X />
      </Button>
    </div>
  ) : null;
  if (error)
    return (
      <>
        {close}
        <EmptyState
          icon={AlertOctagon}
          title={error}
          description={
            <>
              <span className="font-mono">{id}</span> — it may have been created on another gateway, or the gateway is offline.
            </>
          }
          action={
            <Button variant="secondary" render={<Link href="/tickets" />} nativeButton={false}>
              Browse all tickets
            </Button>
          }
        />
      </>
    );
  return (
    <>
      {close}
      <IssueSkeleton />
    </>
  );
}
