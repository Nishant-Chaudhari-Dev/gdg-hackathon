import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <div className={cn("grid size-8 shrink-0 place-items-center rounded-md bg-[#0c66e4] shadow-sm", className)}>
      <svg viewBox="0 0 24 24" className="size-[18px] text-white" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </svg>
    </div>
  );
}

/** Jira-style project header: project avatar + name + project type. */
export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <LogoMark />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold text-foreground">SentinelDesk</div>
        <div className="truncate text-xs text-muted-foreground">Service Desk · AI triage</div>
      </div>
    </div>
  );
}
