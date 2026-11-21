"use client";

import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { cleanText } from "@/lib/format";
import { piiCount } from "@/lib/issue";
import type { TicketRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

// split() with one capture group puts matched tokens at odd indices
const TOKEN = /(<[A-Z_]{2,}(?:_\d+)?>|\[[A-Z_]{2,}(?:_\d+)?\]|\{\{[A-Z_]+\}\})/;

function Highlighted({ text }: { text: string }) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            title="Personal data replaced before any AI model saw the text"
            className="rounded-[3px] bg-[#dfd8fd] px-1 font-mono text-[11px] text-[#5e4db2] dark:bg-[#352c63] dark:text-[#b8acf6]"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** Ticket body with a "Show what the AI saw" toggle (PII-masked text with highlighted placeholders). */
export function Description({ ticket }: { ticket: TicketRecord }) {
  const [masked, setMasked] = useState(false);
  const total = piiCount(ticket);
  const subject = cleanText(masked ? ticket.subject_masked : ticket.subject);
  const body = cleanText(masked ? ticket.body_masked : ticket.body);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold">Description</h2>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
          {masked ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          Show what the AI saw
          <Switch checked={masked} onCheckedChange={(v) => setMasked(!!v)} aria-label="Show PII-masked text" />
        </label>
      </div>
      <div
        className={cn(
          "rounded-md border p-3 text-sm leading-relaxed",
          masked ? "border-[#b8acf6]/60 bg-[#f3f0ff] dark:border-[#5e4db2]/50 dark:bg-[#2b2549]/40" : "border-transparent bg-transparent px-0 pt-0",
        )}
      >
        {masked && subject && (
          <div className="mb-1.5 font-medium">
            <Highlighted text={subject} />
          </div>
        )}
        <div className="break-words whitespace-pre-wrap text-foreground/90">{masked ? <Highlighted text={body} /> : body || <span className="text-muted-foreground">(empty)</span>}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {total > 0 ? (
          <>
            <span className="inline-flex items-center gap-1 font-medium text-[#5e4db2] dark:text-[#b8acf6]">
              <EyeOff className="size-3.5" /> {total} piece{total === 1 ? "" : "s"} of personal data masked before the AI saw it:
            </span>
            {ticket.pii_entities.map((e) => (
              <span
                key={e.type}
                className="inline-flex h-5 items-center gap-1 rounded-[3px] bg-[#dfd8fd] px-1.5 font-mono text-[10px] text-[#5e4db2] dark:bg-[#352c63] dark:text-[#b8acf6]"
              >
                {e.type}
                <span className="opacity-70">×{e.count}</span>
              </span>
            ))}
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <ShieldCheck className="size-3.5" /> No personal data detected — the AI saw the text as written.
          </span>
        )}
      </div>
    </section>
  );
}
