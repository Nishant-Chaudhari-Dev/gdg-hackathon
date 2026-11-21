import type { Metadata } from "next";
import { Suspense } from "react";
import { OutagesView } from "@/components/outages/outages-view";

export const metadata: Metadata = { title: "Incidents" };

export default function IncidentsPage() {
  return (
    <Suspense>
      <OutagesView />
    </Suspense>
  );
}
