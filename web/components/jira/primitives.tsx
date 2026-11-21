import { Bot, ChevronsDown, ChevronsUp, Equal, Flame, GitPullRequestArrow, Hand, TriangleAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { LozengeTone } from "@/lib/issue";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ Lozenge */

const LOZENGE_TONES: Record<LozengeTone, string> = {
  default: "bg-[#dcdfe4] text-[#44546f] dark:bg-[#454f59] dark:text-[#dee4ea]",
  inprogress: "bg-[#cce0ff] text-[#0055cc] dark:bg-[#09326c] dark:text-[#85b8ff]",
  success: "bg-[#baf3db] text-[#216e4e] dark:bg-[#164b35] dark:text-[#7ee2b8]",
  removed: "bg-[#ffd5d2] text-[#ae2e24] dark:bg-[#5d1f1a] dark:text-[#fd9891]",
  moved: "bg-[#f8e6a0] text-[#7f5f01] dark:bg-[#533f04] dark:text-[#f5cd47]",
  new: "bg-[#dfd8fd] text-[#5e4db2] dark:bg-[#352c63] dark:text-[#b8acf6]",
};

/** Jira-style status lozenge: small, bold, uppercase. */
export function Lozenge({
  tone = "default",
  children,
  className,
  title,
}: {
  tone?: LozengeTone;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[18px] max-w-full shrink-0 items-center truncate rounded-[3px] px-1 text-[11px] leading-none font-bold tracking-[0.02em] uppercase",
        LOZENGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ Priority icon */

const PRIORITY_META: Record<string, { label: string; icon: typeof ChevronsUp; className: string }> = {
  high: { label: "High", icon: ChevronsUp, className: "text-[#e2483d]" },
  medium: { label: "Medium", icon: Equal, className: "text-[#e2a03f]" },
  low: { label: "Low", icon: ChevronsDown, className: "text-[#1d7afc]" },
};

export function priorityMeta(p?: string | null) {
  return PRIORITY_META[(p ?? "").toLowerCase()] ?? null;
}

/** Jira priority glyph: high = red up-chevrons, medium = amber, low = blue down-chevrons. */
export function PriorityIcon({ priority, withLabel, className }: { priority?: string | null; withLabel?: boolean; className?: string }) {
  const m = priorityMeta(priority);
  if (!m) return withLabel ? <span className="text-muted-foreground">—</span> : null;
  const Icon = m.icon;
  const icon = <Icon className={cn("size-4 shrink-0", m.className, className)} strokeWidth={2.5} aria-label={`${m.label} priority`} />;
  if (withLabel)
    return (
      <span className="inline-flex items-center gap-1.5">
        {icon}
        <span>{m.label}</span>
      </span>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{icon}</TooltipTrigger>
      <TooltipContent>{m.label} priority</TooltipContent>
    </Tooltip>
  );
}

/* ---------------------------------------------------------- Issue type icon */

const TYPE_META: Record<string, { icon: typeof Flame; bg: string; help: string }> = {
  incident: { icon: Flame, bg: "bg-[#e2483d]", help: "Incident — something is broken right now" },
  problem: { icon: TriangleAlert, bg: "bg-[#e56910]", help: "Problem — the root cause behind recurring incidents" },
  request: { icon: Hand, bg: "bg-[#22a06b]", help: "Request — the customer is asking for something" },
  change: { icon: GitPullRequestArrow, bg: "bg-[#8270db]", help: "Change — a planned change to a system" },
};

export function IssueTypeIcon({ type, withLabel, className }: { type?: string | null; withLabel?: boolean; className?: string }) {
  const m = TYPE_META[(type ?? "").toLowerCase()];
  const box = (
    <span
      className={cn("grid size-4 shrink-0 place-items-center rounded-[3px] text-white", m ? m.bg : "bg-muted-foreground/60", className)}
      aria-label={type ?? "Unclassified"}
    >
      {m ? <m.icon className="size-2.5" strokeWidth={3} /> : <Bot className="size-2.5" strokeWidth={3} />}
    </span>
  );
  if (withLabel)
    return (
      <span className="inline-flex items-center gap-1.5">
        {box}
        <span>{type ?? "Unclassified"}</span>
      </span>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{box}</TooltipTrigger>
      <TooltipContent>{m?.help ?? "Not classified yet"}</TooltipContent>
    </Tooltip>
  );
}

/* --------------------------------------------------------------- Misc chips */

/** Jira "component"/label chip (used for queue). */
export function ComponentTag({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 max-w-full items-center truncate rounded-[3px] border border-border bg-background px-1.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function IssueKey({ id, className, strike }: { id: string; className?: string; strike?: boolean }) {
  return (
    <span className={cn("font-mono text-[11px] font-medium tracking-tight text-muted-foreground", strike && "line-through", className)}>
      {id.toUpperCase()}
    </span>
  );
}

const SYSTEM_ACTORS = new Set(["pipeline", "detector", "system", "orchestrator", "gateway", "simulator", "notifier", "gate", "pii-guardrail", "guardrail"]);

export function isSystemActor(name: string) {
  return SYSTEM_ACTORS.has(name.toLowerCase());
}

const AVATAR_COLORS = ["bg-[#1d7afc]", "bg-[#22a06b]", "bg-[#8270db]", "bg-[#e56910]", "bg-[#c9372c]", "bg-[#2898bd]"];

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md"; className?: string }) {
  const sys = isSystemActor(name);
  const color = AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span
      title={name}
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold uppercase",
        size === "sm" ? "size-5 text-[9px]" : "size-7 text-[11px]",
        sys ? "bg-muted text-muted-foreground" : cn(color, "text-white"),
        className,
      )}
    >
      {sys ? <Bot className={size === "sm" ? "size-3" : "size-4"} /> : name.slice(0, 2)}
    </span>
  );
}
