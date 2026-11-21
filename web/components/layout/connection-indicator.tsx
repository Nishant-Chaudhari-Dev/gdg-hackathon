"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { MOCK_MODE } from "@/lib/config";
import { fmtAgo } from "@/lib/format";
import { useLive } from "@/lib/store";
import { cn } from "@/lib/utils";

export function ConnectionIndicator() {
  const sse = useLive((s) => s.sse);
  const lastEventAt = useLive((s) => s.lastEventAt);
  const now = useNow(5_000);
  const label = sse === "open" ? (MOCK_MODE ? "Live · mock" : "Live") : sse === "connecting" ? "Connecting" : "Disconnected";
  const color = sse === "open" ? "text-emerald-500" : sse === "connecting" ? "text-amber-500" : "text-red-500";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className={cn(
              "flex h-7 cursor-default items-center gap-2 rounded-md border px-2 text-xs font-medium",
              sse === "closed" ? "border-red-500/30 bg-red-500/10" : "border-border bg-background/50",
            )}
          />
        }
      >
        <span className={cn("relative inline-flex size-2 rounded-full bg-current", color, sse === "open" && "pulse-dot")} />
        <span className={sse === "closed" ? "text-red-600 dark:text-red-400" : "text-foreground/80"}>{label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="space-y-0.5">
          <div>Event stream (SSE): {sse}</div>
          <div className="opacity-70">
            Last event: {lastEventAt ? fmtAgo(new Date(lastEventAt).toISOString(), now) : "none yet"}
          </div>
          {sse === "closed" && <div className="opacity-70">Reconnecting with backoff…</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
