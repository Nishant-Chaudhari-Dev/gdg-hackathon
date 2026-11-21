"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/config";
import { useLive } from "@/lib/store";
import { cn } from "@/lib/utils";

function withPeriod(s: string) {
  return /[.!?]$/.test(s.trim()) ? s : `${s}.`;
}

export function GatewayOffline({
  message,
  onRetry,
  compact,
  className,
}: {
  message?: string | null;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const retry = useLive((s) => s.retry);
  const handle = onRetry ?? retry;
  if (compact) {
    return (
      <div className={cn("flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm", className)}>
        <WifiOff className="size-4 text-red-500" />
        <span className="flex-1 text-red-700 dark:text-red-300">{message ?? "Gateway offline"}</span>
        <Button size="xs" variant="outline" onClick={handle}>
          <RefreshCw /> Retry
        </Button>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-md border border-red-500/25 bg-red-500/[0.04] px-6 py-12 text-center", className)}>
      <div className="grid size-11 place-items-center rounded-full bg-red-500/10">
        <WifiOff className="size-5 text-red-500" />
      </div>
      <div className="mt-3 text-sm font-semibold">Gateway offline</div>
      <div className="mt-1 max-w-md text-sm text-muted-foreground">
        {withPeriod(message ?? "The SentinelDesk gateway could not be reached")} The console will reconnect automatically when it comes back.
      </div>
      <code className="mt-3 rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">{API_URL}</code>
      <Button className="mt-4" size="sm" variant="outline" onClick={handle}>
        <RefreshCw /> Retry now
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">
        Tip: run with <code className="font-mono">NEXT_PUBLIC_MOCK=1</code> to demo without a backend.
      </p>
    </div>
  );
}

/** Shows the offline panel only when the initial snapshot failed. */
export function useGatewayDown(): { down: boolean; error: string | null; loading: boolean } {
  const bootstrap = useLive((s) => s.bootstrap);
  const error = useLive((s) => s.bootstrapError);
  return { down: bootstrap === "error", error, loading: bootstrap === "idle" || bootstrap === "loading" };
}
