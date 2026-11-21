import type { Metadata } from "next";
import { OutagesView } from "@/components/outages/outages-view";

export const metadata: Metadata = { title: "Outages" };

export default function OutagesPage() {
  return <OutagesView />;
}
