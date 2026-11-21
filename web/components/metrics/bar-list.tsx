import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface BarListItem {
  key: string;
  label: React.ReactNode;
  value: number;
  color?: string;
  className?: string;
}

/** Horizontal magnitude bars with direct labels — used for distributions. */
export function BarList({ items, total, empty = "No data yet" }: { items: BarListItem[]; total?: number; empty?: string }) {
  const sum = total ?? items.reduce((a, b) => a + b.value, 0);
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length || sum === 0) return <p className="py-6 text-center text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <Tooltip key={i.key}>
          <TooltipTrigger render={<div className="group cursor-default" />}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{i.label}</span>
              <span className="tabular shrink-0 text-muted-foreground">
                <span className="font-medium text-foreground">{i.value}</span> · {((i.value / sum) * 100).toFixed(0)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted/70">
              <div
                className={cn("h-full rounded-full transition-[width] duration-500 group-hover:opacity-85", i.className)}
                style={{ width: `${(i.value / max) * 100}%`, background: i.className ? undefined : (i.color ?? "var(--chart-1)") }}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {i.label}: {i.value} of {sum}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
