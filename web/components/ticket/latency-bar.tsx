import { Timer } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtMs } from "@/lib/format";
import { STAGES, stageColor } from "@/lib/semantics";
import { Section } from "./section";

export function LatencyPanel({ timings, latency }: { timings: Record<string, number>; latency?: number | null }) {
  const known: string[] = STAGES.map((s) => s.key);
  const keys = [...known.filter((k) => k in timings), ...Object.keys(timings).filter((k) => k !== "total" && !known.includes(k))];
  const parts = keys.map((k) => ({ key: k, ms: timings[k] ?? 0 }));
  const sum = parts.reduce((a, b) => a + b.ms, 0);
  const total = latency ?? timings.total ?? sum;
  const label = (k: string) => STAGES.find((s) => s.key === k)?.label ?? k;

  return (
    <Section title="Latency" icon={Timer} right={<span className="tabular text-sm font-semibold">{fmtMs(total)}</span>}>
      {parts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No stage timings recorded.</p>
      ) : (
        <>
          <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px]">
            {parts.map((p) => (
              <Tooltip key={p.key}>
                <TooltipTrigger
                  render={<div className="h-full min-w-[3px] cursor-default transition-opacity hover:opacity-80" />}
                  style={{ width: `${(p.ms / (sum || 1)) * 100}%`, background: stageColor(p.key) }}
                />
                <TooltipContent>
                  {label(p.key)}: {fmtMs(p.ms)} ({((p.ms / (sum || 1)) * 100).toFixed(0)}%)
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            {parts.map((p) => (
              <div key={p.key} className="flex items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: stageColor(p.key) }} />
                <span className="text-muted-foreground">{label(p.key)}</span>
                <span className="tabular ml-auto font-medium">{fmtMs(p.ms)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}
