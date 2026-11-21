"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TicketDetailById } from "@/components/ticket/ticket-detail";

export function TicketSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-[min(1100px,92vw)]">
        <SheetHeader className="sticky top-0 z-10 border-b bg-popover/95 px-5 py-3 backdrop-blur">
          <SheetTitle className="text-sm">Ticket detail</SheetTitle>
          <SheetDescription className="font-mono text-[11px]">{id}</SheetDescription>
        </SheetHeader>
        <div className="p-5">{id && <TicketDetailById id={id} />}</div>
      </SheetContent>
    </Sheet>
  );
}
