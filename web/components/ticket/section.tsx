import { cn } from "@/lib/utils";

/** Compact titled panel used throughout the ticket detail. */
export function Section({
  title,
  icon: Icon,
  right,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-xl border bg-card text-card-foreground", className)}>
      <header className="flex min-h-10 items-center gap-2 border-b px-3.5 py-2">
        {Icon && <Icon className="size-4 text-muted-foreground" />}
        <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
        {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
      </header>
      <div className={cn("p-3.5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Meter({ value, className, barClassName }: { value: number; className?: string; barClassName?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full bg-primary transition-[width] duration-500", barClassName)} style={{ width: `${pct}%` }} />
    </div>
  );
}
