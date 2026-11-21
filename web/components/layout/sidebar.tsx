"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useMemo } from "react";
import { API_URL, MOCK_MODE } from "@/lib/config";
import { columnOf } from "@/lib/issue";
import { useActiveOutages, useTicketList } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { NAV, isActive, type NavItem } from "./nav";

function useCounts() {
  const tickets = useTicketList();
  const active = useActiveOutages();
  return useMemo(() => {
    let escalated = 0;
    let review = 0;
    for (const t of tickets) {
      const c = columnOf(t);
      if (c === "escalated") escalated++;
      else if (c === "review") review++;
    }
    return { escalated, review, outages: active.length };
  }, [tickets, active.length]);
}

function PathAwareNav({ onNavigate }: { onNavigate?: () => void }) {
  return <NavList pathname={usePathname()} onNavigate={onNavigate} />;
}

/** usePathname() is runtime data on dynamic routes → stream it in behind Suspense. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavList pathname={null} onNavigate={onNavigate} />}>
      <PathAwareNav onNavigate={onNavigate} />
    </Suspense>
  );
}

function NavList({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  const counts = useCounts();
  const groups = Array.from(new Set(NAV.map((n) => n.group)));

  const badge = (item: NavItem) => {
    if (item.href === "/" && counts.escalated + counts.review > 0)
      return { n: counts.escalated + counts.review, tone: counts.escalated ? "red" : "grey", title: `${counts.escalated} escalated · ${counts.review} drafts to review` };
    if (item.href === "/incidents" && counts.outages > 0) return { n: counts.outages, tone: "red", title: `${counts.outages} active major incident(s)` };
    return null;
  };

  return (
    <nav className="flex flex-col gap-4 px-2">
      {groups.map((g) => (
        <div key={g}>
          <div className="px-2.5 pb-1 text-[11px] font-semibold text-muted-foreground">{g}</div>
          <div className="flex flex-col gap-px">
            {NAV.filter((n) => n.group === g).map((item) => {
              const on = pathname != null && isActive(pathname, item.href);
              const b = badge(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={item.description}
                  className={cn(
                    "group relative flex h-8 items-center gap-2.5 rounded-[4px] px-2.5 text-sm transition-colors",
                    on
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-foreground/[0.06] hover:text-foreground",
                  )}
                >
                  {on && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-sidebar-primary" />}
                  <item.icon className="size-4 shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {b && (
                    <span
                      title={b.title}
                      className={cn(
                        "tabular min-w-5 rounded-full px-1.5 py-px text-center text-[11px] font-semibold",
                        b.tone === "red" ? "bg-[#c9372c] text-white" : "bg-foreground/10 text-foreground/80",
                      )}
                    >
                      {b.n}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center border-b border-sidebar-border px-3">
        <Logo />
      </div>
      <div className="flex-1 overflow-y-auto py-4">
        <SidebarNav onNavigate={onNavigate} />
      </div>
      <div className="space-y-1 border-t border-sidebar-border p-3 text-[11px] text-muted-foreground">
        <div className="flex items-center justify-between">
          <span className="font-medium">Gateway</span>
          {MOCK_MODE ? (
            <span className="rounded-[3px] bg-[#f8e6a0] px-1.5 py-px font-mono text-[10px] font-semibold text-[#7f5f01] dark:bg-[#533f04] dark:text-[#f5cd47]">
              MOCK
            </span>
          ) : null}
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground/80" title={API_URL}>
          {MOCK_MODE ? "in-browser mock backend" : API_URL.replace(/^https?:\/\//, "")}
        </div>
      </div>
    </div>
  );
}
