"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MOCK_MODE } from "@/lib/config";
import { ConnectionIndicator } from "./connection-indicator";
import { NAV, isActive } from "./nav";
import { OperatorInput } from "./operator-input";
import { ThemeToggle } from "./theme-toggle";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const item = NAV.find((n) => isActive(pathname, n.href));
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur supports-backdrop-filter:bg-background/65 md:px-6">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu />
      </Button>
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="hidden font-semibold tracking-tight sm:inline">SentinelDesk</span>
        <span className="hidden text-muted-foreground/50 sm:inline">/</span>
        <span className="truncate font-medium text-foreground/90">{item?.label ?? "Console"}</span>
        {item && <span className="hidden truncate text-muted-foreground lg:inline">— {item.description}</span>}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {MOCK_MODE && (
          <span className="hidden rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-600 sm:inline dark:text-amber-400">
            MOCK DATA
          </span>
        )}
        <ConnectionIndicator />
        <div className="hidden sm:block">
          <OperatorInput />
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
