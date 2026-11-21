import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "danger" | "warning" | "success";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-card p-3.5",
        tone === "danger" && "border-red-500/35 bg-red-500/[0.05]",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {Icon && (
          <Icon
            className={cn(
              "size-3.5",
              tone === "danger" && "text-red-500",
              tone === "warning" && "text-amber-500",
              tone === "success" && "text-emerald-500",
            )}
          />
        )}
        {label}
      </div>
      <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
