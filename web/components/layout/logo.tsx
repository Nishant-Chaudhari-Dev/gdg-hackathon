import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative grid size-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm shadow-indigo-500/30">
        <svg viewBox="0 0 24 24" className="size-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z" />
          <path d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
      </div>
      <div className="leading-none">
        <div className="text-[13px] font-semibold tracking-tight">SentinelDesk</div>
        <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Triage Copilot</div>
      </div>
    </div>
  );
}
