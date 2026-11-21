"use client";

import { CornerDownLeft, Loader2, RotateCcw, WifiOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { currentOperator } from "@/components/layout/operator-input";
import { TriageProgress } from "@/components/ticket/triage-progress";
import { useResource } from "@/hooks/use-resource";
import { api, errorMessage, isOffline } from "@/lib/api";
import { DECISION_STYLES } from "@/lib/semantics";
import { useLive } from "@/lib/store";
import type { SampleTicket } from "@/lib/types";
import { useUi } from "@/lib/ui-store";
import { useIssueNav } from "@/lib/use-issue-nav";
import { cn } from "@/lib/utils";

function Samples({ activeId, disabled, onPick }: { activeId: string | null; disabled: boolean; onPick: (s: SampleTicket) => void }) {
  const samples = useResource(() => api.samples());
  if (samples.loading && !samples.data)
    return (
      <div className="flex flex-wrap gap-1.5">
        {[96, 120, 104, 88].map((w) => (
          <Skeleton key={w} className="h-6" style={{ width: w }} />
        ))}
      </div>
    );
  if (!samples.data?.length)
    return (
      <p className="text-xs text-muted-foreground">
        {samples.error ? "Samples unavailable — the gateway is offline. " : "No samples configured. "}
        {!!samples.error && (
          <button type="button" className="font-medium text-primary hover:underline" onClick={samples.reload}>
            Retry
          </button>
        )}
      </p>
    );
  return (
    <div className="flex flex-wrap gap-1.5">
      {samples.data.map((s) => {
        const esc = /escalat/i.test(s.expect);
        return (
          <button
            key={s.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            title={`${s.subject}\nExpected outcome: ${s.expect}`}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[4px] border px-2 text-xs font-medium transition-colors disabled:opacity-50",
              activeId === s.id ? "border-primary bg-selected text-selected-foreground" : "hover:bg-muted",
            )}
          >
            <span className="font-mono text-[10px] text-muted-foreground uppercase">{s.language}</span>
            {s.label}
            <span
              className={cn("rounded-[3px] px-1 text-[9px] font-bold uppercase", esc ? "bg-[#ffd5d2] text-[#ae2e24] dark:bg-[#5d1f1a] dark:text-[#fd9891]" : "bg-[#baf3db] text-[#216e4e] dark:bg-[#164b35] dark:text-[#7ee2b8]")}
            >
              {esc ? "escalates" : "auto-draft"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Jira-style "Create issue" modal: submit → POST /api/tickets?wait=true with staged progress, then open the new ticket. */
export function CreateIssueDialog() {
  const open = useUi((s) => s.createOpen);
  const setOpen = useUi((s) => s.setCreateOpen);
  const nav = useIssueNav();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sample, setSample] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null);
  const busy = startedAt != null;
  const canSubmit = body.trim().length > 0 && !busy;

  const reset = () => {
    setSubject("");
    setBody("");
    setSample(null);
    setError(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    setStartedAt(Date.now());
    try {
      const t = await api.createTicket({ subject: subject.trim(), body: body.trim(), operator: currentOperator() });
      useLive.getState().upsertTicket(t);
      setOpen(false);
      reset();
      nav.open(t.id);
      if (t.decision) {
        const d = DECISION_STYLES[t.decision.action];
        (t.decision.action === "escalate" ? toast.warning : toast.success)(`${t.id}: ${d.long}`, {
          description: `${t.classification?.queue.label ?? ""} · ${t.classification?.priority.label ?? "?"} priority`,
        });
      } else toast.success(`Created ${t.id}`);
    } catch (e) {
      setError({ message: errorMessage(e), offline: isOffline(e) });
    } finally {
      setStartedAt(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl" showCloseButton={!busy}>
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="text-lg">Create ticket</DialogTitle>
          <DialogDescription>
            Paste a customer message. The AI masks personal data, classifies it, finds similar past tickets, decides whether to escalate, and drafts a cited reply.
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <div className="px-6 py-5">
            <TriageProgress startedAt={startedAt} />
          </div>
        ) : (
          <form
            className="space-y-4 px-6 py-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          >
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground">Start from a sample (optional)</div>
              <Samples
                activeId={sample}
                disabled={busy}
                onPick={(s) => {
                  setSubject(s.subject);
                  setBody(s.body);
                  setSample(s.id);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-subject" className="text-xs font-semibold text-muted-foreground">
                Summary <span className="font-normal">(optional)</span>
              </Label>
              <Input
                id="create-subject"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setSample(null);
                }}
                placeholder="e.g. VPN keeps disconnecting"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-body" className="text-xs font-semibold text-muted-foreground">
                Description <span className="text-[#c9372c]">*</span>
              </Label>
              <Textarea
                id="create-body"
                autoFocus
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setSample(null);
                }}
                placeholder="The customer's message… e.g. “VPN drops every few minutes since this morning, whole team affected.” English and German are supported."
                className="min-h-40 resize-y text-sm leading-relaxed"
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-md border-l-4 border-l-[#c9372c] bg-[#ffeceb] p-3 text-sm dark:bg-[#42221f]">
                <WifiOff className="mt-0.5 size-4 shrink-0 text-[#c9372c]" />
                <div>
                  <div className="font-semibold">{error.offline ? "Couldn't reach the gateway" : "Triage failed"}</div>
                  <div className="text-xs text-foreground/80">{error.message}. Your text is still here — try again.</div>
                </div>
              </div>
            )}
          </form>
        )}

        <div className="flex items-center gap-2 rounded-b-xl border-t bg-muted/40 px-6 py-3">
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
            {busy ? "Usually takes 1–10 seconds." : (
              <>
                <kbd className="rounded border bg-background px-1 font-mono text-[10px]">⌘/Ctrl</kbd>
                <CornerDownLeft className="size-3" /> to create
              </>
            )}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {error ? (
              <Button onClick={() => void submit()} disabled={!canSubmit}>
                <RotateCcw /> Retry
              </Button>
            ) : (
              <Button onClick={() => void submit()} disabled={!canSubmit}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {busy ? "Triaging…" : "Create"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
