import { cn } from "@/lib/utils";

export function ChartCard({
  title,
  description,
  right,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col rounded-md border bg-card", className)}>
      <div className="flex items-start gap-2 px-4 pt-3.5">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {right}
      </div>
      <div className="flex-1 px-4 pt-3 pb-4">{children}</div>
    </div>
  );
}

/** Shared tooltip body for recharts (text in ink tokens, swatch carries identity). */
export function ChartTooltip({
  active,
  label,
  payload,
  formatter,
}: {
  active?: boolean;
  label?: string | number;
  payload?: { name?: string | number; value?: number | string; color?: string; payload?: Record<string, unknown> }[];
  formatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-2 text-xs shadow-md">
      {label != null && label !== "" && <div className="mb-1 font-medium">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="size-2 rounded-[2px]" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="tabular ml-auto pl-3 font-medium">{typeof p.value === "number" && formatter ? formatter(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}
