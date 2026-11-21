"use client";

import { EyeOff, FileText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { cleanText } from "@/lib/format";
import type { TicketRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Section } from "./section";

// split() with one capture group puts matched tokens at odd indices
const TOKEN = /(<[A-Z_]{2,}(?:_\d+)?>|\[[A-Z_]{2,}(?:_\d+)?\]|\{\{[A-Z_]+\}\})/;

function Highlighted({ text }: { text: string }) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-violet-500/15 px-1 font-mono text-[11px] text-violet-700 dark:text-violet-300">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function PiiPanel({ ticket }: { ticket: TicketRecord }) {
  const [masked, setMasked] = useState(false);
  const total = ticket.pii_entities.reduce((a, b) => a + b.count, 0);
  const subject = cleanText(masked ? ticket.subject_masked : ticket.subject);
  const body = cleanText(masked ? ticket.body_masked : ticket.body);
  return (
    <Section
      title="Ticket & PII guardrail"
      icon={FileText}
      right={
        <div className="flex rounded-md border p-0.5 text-[11px]">
          {[
            { v: false, l: "Raw" },
            { v: true, l: "What the LLM saw" },
          ].map((o) => (
            <button
              key={o.l}
              type="button"
              onClick={() => setMasked(o.v)}
              className={cn(
                "rounded px-1.5 py-0.5 font-medium transition-colors",
                masked === o.v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.l}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {total > 0 ? (
          <>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-300">
              <EyeOff className="size-3.5" /> {total} entit{total === 1 ? "y" : "ies"} masked
            </span>
            {ticket.pii_entities.map((e) => (
              <span key={e.type} className="inline-flex h-5 items-center gap-1 rounded-md border border-violet-500/25 bg-violet-500/10 px-1.5 font-mono text-[10px] text-violet-700 dark:text-violet-300">
                {e.type}
                <span className="opacity-70">×{e.count}</span>
              </span>
            ))}
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" /> No PII detected
          </span>
        )}
      </div>
      <div className={cn("max-h-72 overflow-auto rounded-lg border p-3 text-[13px] leading-relaxed", masked ? "border-violet-500/25 bg-violet-500/[0.04]" : "bg-muted/30")}>
        <div className="mb-1.5 font-medium">{subject ? (masked ? <Highlighted text={subject} /> : subject) : <span className="text-muted-foreground">(no subject)</span>}</div>
        <div className="whitespace-pre-wrap break-words text-foreground/85">{masked ? <Highlighted text={body} /> : body}</div>
      </div>
    </Section>
  );
}
