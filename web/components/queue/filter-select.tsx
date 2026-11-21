"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const items = [{ value: "all", label: `${label}: All` }, ...options.map((o) => ({ value: o.value, label: `${label}: ${o.label}` }))];
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(String(v ?? "all"))}>
      <SelectTrigger size="sm" className={cn("min-w-28 text-xs", value !== "all" && "border-primary/50 bg-primary/[0.06] text-foreground")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start">
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
