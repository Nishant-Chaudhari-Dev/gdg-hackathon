import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EvalSection } from "@/components/metrics/eval-section";
import { OpsSection } from "@/components/metrics/ops-section";

export const metadata: Metadata = { title: "Metrics" };

export default function MetricsPage() {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <PageHeader
          title="Live operations"
          description={
            <span className="inline-flex items-center gap-1.5">
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500 text-emerald-500 pulse-dot" /> Refreshing every 5s from the gateway
            </span>
          }
        />
        <OpsSection />
      </section>
      <section className="space-y-4">
        <PageHeader title="Offline evaluation" description="Held-out test-set performance of the classifier and escalation gate." />
        <EvalSection />
      </section>
    </div>
  );
}
