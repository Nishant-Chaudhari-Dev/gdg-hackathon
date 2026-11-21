"use client";

import { Menu, Plus } from "lucide-react";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { MOCK_MODE } from "@/lib/config";
import { useUi } from "@/lib/ui-store";
import { ConnectionIndicator } from "./connection-indicator";
import { GlobalSearch } from "./global-search";
import { OperatorInput } from "./operator-input";
import { ThemeToggle } from "./theme-toggle";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const setCreateOpen = useUi((s) => s.setCreateOpen);
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 md:gap-3 md:px-5">
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu />
      </Button>
      <Suspense fallback={<div className="hidden h-8 max-w-md flex-1 sm:block" />}>
        <GlobalSearch className="hidden max-w-md min-w-0 flex-1 sm:block" />
      </Suspense>
      <Button
        onClick={() => setCreateOpen(true)}
        className="h-8 shrink-0 rounded-[4px] bg-primary px-3 font-semibold text-primary-foreground hover:bg-primary/90"
      >
        <Plus /> <span>Create</span>
      </Button>
      <div className="ml-auto flex items-center gap-1.5 md:gap-2">
        {MOCK_MODE && (
          <span
            title="Running against the in-browser mock backend (NEXT_PUBLIC_MOCK=1)"
            className="hidden rounded-[3px] bg-[#f8e6a0] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#7f5f01] lg:inline dark:bg-[#533f04] dark:text-[#f5cd47]"
          >
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
