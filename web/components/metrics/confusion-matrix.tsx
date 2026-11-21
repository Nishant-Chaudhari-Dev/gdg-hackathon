import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function abbrev(s: string) {
  if (s.length <= 10) return s;
  const words = s.split(/\s+/).filter((w) => !/^(and|of|the)$/i.test(w));
  return words.length > 1 ? words.map((w) => w[0].toUpperCase()).join("") : s.slice(0, 9) + "…";
}

/** Row-normalized confusion matrix heatmap (sequential: one hue, light → dark). */
export function ConfusionMatrix({ labels, matrix }: { labels: string[]; matrix: number[][] }) {
  const rowSums = matrix.map((r) => r.reduce((a, b) => a + b, 0) || 1);
  const n = labels.length;
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid min-w-full gap-[2px]" style={{ gridTemplateColumns: `minmax(90px,auto) repeat(${n}, minmax(44px, 1fr))` }}>
        <div className="flex items-end pb-1 text-[10px] text-muted-foreground">true ↓ / pred →</div>
        {labels.map((l) => (
          <div key={`h-${l}`} className="truncate px-1 pb-1 text-center text-[10px] font-medium text-muted-foreground" title={l}>
            {abbrev(l)}
          </div>
        ))}
        {matrix.map((row, i) => (
          <div key={`r-${labels[i]}`} className="contents">
            <div className="flex items-center truncate pr-2 text-[11px] font-medium" title={labels[i]}>
              {labels[i]}
            </div>
            {row.map((v, j) => {
              const p = v / rowSums[i];
              const diag = i === j;
              return (
                <Tooltip key={`c-${i}-${j}`}>
                  <TooltipTrigger
                    render={
                      <div
                        className={cn(
                          "tabular grid h-9 cursor-default place-items-center rounded-[4px] text-[11px] font-medium",
                          diag && "ring-1 ring-foreground/20 ring-inset",
                          p > 0.5 ? "text-white" : "text-foreground/80",
                        )}
                      />
                    }
                    style={{ background: `color-mix(in oklch, var(--chart-1) ${Math.round(6 + p * 94)}%, var(--card))` }}
                  >
                    {v}
                  </TooltipTrigger>
                  <TooltipContent>
                    true <b>{labels[i]}</b> → predicted <b>{labels[j]}</b>: {v} ({(p * 100).toFixed(1)}% of row)
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
