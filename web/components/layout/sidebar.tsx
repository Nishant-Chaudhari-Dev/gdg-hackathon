"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { MOCK_MODE, API_URL } from "@/lib/config";
import { useActiveOutages, useTicketList } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { NAV, isActive } from "./nav";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const tickets = useTicketList();
  const active = useActiveOutages();
  const pending = useMemo(
    () => tickets.filter((t) => t.status === "done" && t.human.state === "pending").length,
    [tickets],
  );

  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {NAV.map((item) => {
        const on = isActive(pathname, item.href);
        const count = item.href === "/queue" ? pending : item.href === "/outages" ? active.length : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
              on
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <item.icon className={cn("size-4", on ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
            <span className="flex-1">{item.label}</span>
            {count > 0 && (
              <span
                className={cn(
                  "tabular rounded px-1.5 py-px text-[10px] font-semibold",
                  item.href === "/outages" ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center px-4">
        <Logo />
      </div>
      <div className="px-4 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">Operate</div>
      <SidebarNav onNavigate={onNavigate} />
      <div className="mt-auto space-y-1 border-t border-sidebar-border p-4 text-[11px] text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>Gateway</span>
          {MOCK_MODE ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-px font-mono text-[10px] text-amber-600 dark:text-amber-400">MOCK</span>
          ) : null}
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground/80" title={API_URL}>
          {MOCK_MODE ? "in-browser mock backend" : API_URL}
        </div>
      </div>
    </div>
  );
}
