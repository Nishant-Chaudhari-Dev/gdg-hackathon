import { cleanText } from "./format";
import type { HumanState, TicketRecord } from "./types";

/** Board column a ticket belongs to (derived purely from existing ticket fields — no backend state). */
export type BoardColumn = "triage" | "escalated" | "review" | "done";

export const BOARD_COLUMNS: { key: BoardColumn; title: string; hint: string; empty: string }[] = [
  {
    key: "triage",
    title: "Triage",
    hint: "The AI pipeline is classifying, searching past tickets and drafting a reply.",
    empty: "Nothing in flight. New tickets land here first.",
  },
  {
    key: "escalated",
    title: "Escalated · On-call",
    hint: "The escalation gate sent these to a human engineer. Open one and acknowledge it.",
    empty: "No escalations waiting — all clear.",
  },
  {
    key: "review",
    title: "AI draft · Needs review",
    hint: "The AI wrote a cited reply. Check it, then approve & send, edit or reject.",
    empty: "No drafts waiting for review.",
  },
  {
    key: "done",
    title: "Done",
    hint: "A human acted on these: reply sent, edited, rejected, acknowledged or overridden.",
    empty: "Nothing handled yet.",
  },
];

export function columnOf(t: TicketRecord): BoardColumn {
  if (t.human.state !== "pending") return "done";
  if (t.status === "queued" || t.status === "processing" || t.status === "failed") return "triage";
  if (t.decision?.action === "auto_draft") return "review";
  return "escalated";
}

/** Jira-style issue key. Gateway ids already look like LIVE-5F593FA8; anything else is shown upper-cased. */
export function issueKey(id: string): string {
  return id.toUpperCase();
}

/** Summary line: subject, else the first non-empty line of the body. */
export function summaryOf(t: Pick<TicketRecord, "subject" | "body">, max = 140): string {
  const subj = cleanText(t.subject);
  if (subj) return subj;
  const first = cleanText(t.body).split("\n").find((l) => l.trim()) ?? "";
  if (!first) return "(empty ticket)";
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

export type LozengeTone = "default" | "inprogress" | "success" | "removed" | "moved" | "new";

/** Status lozenge (Jira status-category style) + a one-line explanation. */
export function statusLozenge(t: TicketRecord): { label: string; tone: LozengeTone; help: string } {
  const done: Record<Exclude<HumanState, "pending">, { label: string; tone: LozengeTone; help: string }> = {
    approved: { label: "Done · Sent", tone: "success", help: "An operator approved the reply and it was sent." },
    edited: { label: "Done · Edited", tone: "success", help: "An operator edited and saved the reply." },
    rejected: { label: "Rejected", tone: "default", help: "An operator rejected the AI draft." },
    acknowledged: { label: "Acknowledged", tone: "success", help: "An engineer acknowledged the escalation." },
    overridden: { label: "Overridden", tone: "moved", help: "An operator corrected the AI's classification." },
  };
  if (t.human.state !== "pending") return done[t.human.state];
  if (t.status === "queued") return { label: "Queued", tone: "default", help: "Waiting for the triage pipeline." };
  if (t.status === "processing") return { label: "Triaging", tone: "inprogress", help: "The AI pipeline is running on this ticket." };
  if (t.status === "failed") return { label: "Failed", tone: "removed", help: "The pipeline failed — route this ticket manually." };
  if (t.decision?.action === "auto_draft") return { label: "Needs review", tone: "new", help: "AI draft ready — approve, edit or reject it." };
  return { label: "Escalated", tone: "removed", help: "Escalated to the on-call engineer — acknowledge it." };
}

export function priorityOf(t: TicketRecord): string | null {
  return t.classification?.priority.label?.toLowerCase() ?? null;
}

export const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function piiCount(t: TicketRecord): number {
  return t.pii_entities.reduce((a, b) => a + b.count, 0);
}

/** Text the global search / board search matches against. */
export function searchHaystack(t: TicketRecord): string {
  return `${t.id} ${t.subject} ${t.body} ${t.classification?.queue.label ?? ""} ${t.classification?.type.label ?? ""}`.toLowerCase();
}
