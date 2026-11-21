"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IssueKey, IssueTypeIcon, Lozenge, PriorityIcon } from "@/components/jira/primitives";
import { searchHaystack, statusLozenge, summaryOf } from "@/lib/issue";
import { useTicketList } from "@/lib/store";
import { useIssueNav } from "@/lib/use-issue-nav";
import { cn } from "@/lib/utils";

/** Top-bar search by ticket id or subject. Enter opens the first match; "/" focuses it. */
export function GlobalSearch({ className }: { className?: string }) {
  const tickets = useTicketList();
  const { open } = useIssueNav();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "/" && !(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return tickets.filter((t) => searchHaystack(t).includes(s)).slice(0, 8);
  }, [tickets, q]);

  const choose = (id: string) => {
    open(id);
    setQ("");
    inputRef.current?.blur();
  };

  const show = focused && q.trim().length > 0;

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setCursor(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, Math.max(0, results.length - 1)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (e.key === "Enter" && results[cursor]) {
            e.preventDefault();
            choose(results[cursor].id);
          } else if (e.key === "Escape") {
            setQ("");
            inputRef.current?.blur();
          }
        }}
        placeholder="Search tickets by key or subject"
        aria-label="Search tickets"
        className="h-8 w-full rounded-[4px] border border-input bg-background pr-8 pl-8 text-sm outline-none placeholder:text-muted-foreground/80 hover:bg-muted/40 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/30"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border px-1 font-mono text-[10px] text-muted-foreground sm:block">/</kbd>
      {show && (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border bg-popover shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">No tickets match “{q.trim()}”.</div>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-1">
              <li className="px-3 pt-1 pb-1.5 text-[11px] font-semibold text-muted-foreground">Tickets</li>
              {results.map((t, i) => {
                const lz = statusLozenge(t);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => choose(t.id)}
                      className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm", i === cursor && "bg-selected")}
                    >
                      <IssueTypeIcon type={t.classification?.type.label} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{summaryOf(t)}</span>
                        <IssueKey id={t.id} />
                      </span>
                      <PriorityIcon priority={t.classification?.priority.label} />
                      <Lozenge tone={lz.tone}>{lz.label}</Lozenge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
