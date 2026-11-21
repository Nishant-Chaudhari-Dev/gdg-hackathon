"use client";

import { Suspense, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CreateIssueDialog } from "@/components/create/create-issue-dialog";
import { IssuePanelHost } from "@/components/issue/issue-panel";
import { useLiveSync } from "@/lib/use-events";
import { OutageBanner } from "./outage-banner";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  useLiveSync();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-dvh w-full">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-sidebar-border md:block">
        <Sidebar />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <OutageBanner />
        <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-6">{children}</main>
      </div>
      {/* URL-driven overlays (need useSearchParams → Suspense) */}
      <Suspense>
        <IssuePanelHost />
        <CreateIssueDialog />
      </Suspense>
    </div>
  );
}
