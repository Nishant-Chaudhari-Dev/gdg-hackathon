import type { Metadata } from "next";
import { Suspense } from "react";
import { IssueSkeleton } from "@/components/issue/issue-view";
import { IssuePage } from "@/components/issue/issue-page";

export const metadata: Metadata = { title: "Ticket" };

export default function TicketPage() {
  return (
    <Suspense fallback={<IssueSkeleton />}>
      <IssuePage />
    </Suspense>
  );
}
