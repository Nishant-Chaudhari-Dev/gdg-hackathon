"use client";

import { CornerDownLeft, Eraser, Loader2, Send, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useResource } from "@/hooks/use-resource";
import { api } from "@/lib/api";
import type { SampleTicket } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Composer({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: { subject: string; body: string }) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [activeSample, setActiveSample] = useState<string | null>(null);
  const samples = useResource(() => api.samples());
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIsMac(/Mac|iPhone|iPad/.test(navigator.platform)), 0);
    return () => clearTimeout(t);
  }, []);

  const canSubmit = body.trim().length > 0 && !busy;
  const submit = () => {
    if (canSubmit) onSubmit({ subject: subject.trim(), body: body.trim() });
  };

  const load = (s: SampleTicket) => {
    setSubject(s.subject);
    setBody(s.body);
    setActiveSample(s.id);
    bodyRef.current?.focus();
  };

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <Wand2 className="size-4 text-primary" />
        <h2 className="text-[13px] font-semibold">New ticket</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">EN · DE supported</span>
      </div>
      <form
        className="space-y-2.5 p-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <Input
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setActiveSample(null);
          }}
          placeholder="Subject (optional)"
          aria-label="Subject"
        />
        <Textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setActiveSample(null);
          }}
          placeholder="Paste the customer's message… e.g. “VPN drops every few minutes since this morning, whole team affected.”"
          aria-label="Ticket body"
          className="min-h-36 resize-y text-[13px] leading-relaxed"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={!canSubmit} className="flex-1">
            {busy ? <Loader2 className="animate-spin" /> : <Send />}
            {busy ? "Triaging…" : "Triage"}
            {!busy && (
              <kbd className="ml-1 hidden items-center gap-0.5 rounded border border-primary-foreground/25 px-1 font-mono text-[10px] opacity-80 sm:inline-flex">
                {isMac ? "⌘" : "Ctrl"}
                <CornerDownLeft className="size-2.5" />
              </kbd>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear"
            disabled={busy || (!subject && !body)}
            onClick={() => {
              setSubject("");
              setBody("");
              setActiveSample(null);
            }}
          >
            <Eraser />
          </Button>
        </div>
      </form>
      <div className="border-t px-3.5 py-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Try a sample</div>
        {samples.loading && !samples.data ? (
          <div className="flex flex-wrap gap-1.5">
            {[80, 110, 96, 72].map((w) => (
              <Skeleton key={w} className="h-6" style={{ width: w }} />
            ))}
          </div>
        ) : samples.data && samples.data.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {samples.data.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => load(s)}
                disabled={busy}
                title={`${s.subject}\nExpected: ${s.expect}`}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50",
                  activeSample === s.id ? "border-primary/50 bg-primary/10 text-primary" : "hover:border-foreground/20 hover:bg-muted",
                )}
              >
                <span className="font-mono text-[9px] uppercase text-muted-foreground">{s.language}</span>
                {s.label}
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    /escalat/i.test(s.expect) ? "bg-red-500" : /auto|draft/i.test(s.expect) ? "bg-emerald-500" : "bg-muted-foreground",
                  )}
                />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {samples.error ? "Samples unavailable — gateway offline." : "No samples configured."}{" "}
            {samples.error ? (
              <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={samples.reload}>
                Retry
              </button>
            ) : null}
          </p>
        )}
      </div>
    </div>
  );
}
