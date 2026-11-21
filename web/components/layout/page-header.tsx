import { cn } from "@/lib/utils";

/** Jira-style page header: optional breadcrumb, big title, one-line plain-English description, actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  crumb,
  level = 1,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  crumb?: React.ReactNode;
  level?: 1 | 2;
  className?: string;
}) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        {crumb && <div className="mb-1 text-sm text-muted-foreground">{crumb}</div>}
        <H className={cn("font-semibold tracking-tight", level === 1 ? "text-2xl" : "text-lg")}>{title}</H>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
