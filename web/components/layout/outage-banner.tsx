"use client";

import Link from "next/link";
import { Siren } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { api, errorMessage } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { useActiveOutages, useLive } from "@/lib/store";
import { currentOperator } from "./operator-input";

export function OutageBanner() {
  const active = useActiveOutages();
  const now = useNow(15_000);
  const [busy, setBusy] = useState<string | null>(null);
  if (!active.length) return null;
  const o = active[0];

  const resolve = async () => {
    setBusy(o.id);
    try {
      const next = await api.resolveOutage(o.id, currentOperator());
      useLive.getState().upsertOutage(next);
      toast.success("Outage resolved", { description: o.title });
    } catch (e) {
      toast.error("Could not resolve outage", { description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      role="alert"
      className="relative overflow-hidden border-b border-red-500/40 bg-gradient-to-r from-red-600/95 via-red-600/90 to-rose-600/90 text-white"
    >
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent,transparent_12px,rgba(255,255,255,0.05)_12px,rgba(255,255,255,0.05)_24px)]" />
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 md:px-6">
        <div className="flex items-center gap-2">
          <span className="relative grid size-6 place-items-center rounded-md bg-white/15">
            <Siren className="size-3.5 animate-pulse" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-[0.14em]">Major incident</span>
        </div>
        <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="truncate text-sm font-semibold">{o.title}</span>
            <span className="tabular rounded bg-white/15 px-1.5 py-px text-xs font-semibold">
              {o.count} ticket{o.count === 1 ? "" : "s"}
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              {o.signature.slice(0, 5).map((s) => (
                <span key={s} className="rounded border border-white/25 bg-black/10 px-1.5 py-px font-mono text-[10px]">
                  {s}
                </span>
              ))}
            </span>
            <span className="text-xs text-white/75">since {fmtAgo(o.first_seen, now)}</span>
            {active.length > 1 && <span className="text-xs text-white/75">+{active.length - 1} more active</span>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:ml-0">
          <Button
            size="sm"
            variant="outline"
            className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white dark:border-white/30 dark:bg-white/10 dark:hover:bg-white/20"
            render={<Link href={`/outages#${o.id}`} />}
            nativeButton={false}
          >
            View
          </Button>
          <Button
            size="sm"
            className="bg-white text-red-700 hover:bg-white/90"
            disabled={busy === o.id}
            onClick={resolve}
          >
            {busy === o.id ? "Resolving…" : "Resolve"}
          </Button>
        </div>
      </div>
    </div>
  );
}
