"use client";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIssueNav } from "@/lib/use-issue-nav";
import { IssueById } from "./issue-view";

/**
 * Global right-side issue panel. Any page can open a ticket with `?ticket=<id>`
 * (on-call phone alerts deep-link to `/queue?ticket=<id>`, which redirects to `/tickets?ticket=<id>`).
 */
export function IssuePanelHost() {
  const { openId, close } = useIssueNav();
  return (
    <Sheet open={!!openId} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 overflow-y-auto bg-background p-0 data-[side=right]:sm:max-w-[min(1120px,94vw)]"
      >
        <SheetTitle className="sr-only">Ticket {openId}</SheetTitle>
        <SheetDescription className="sr-only">Ticket details, AI decision, draft reply and activity</SheetDescription>
        <div className="p-5 md:p-6">{openId && <IssueById key={openId} id={openId} variant="panel" onClose={close} />}</div>
      </SheetContent>
    </Sheet>
  );
}
