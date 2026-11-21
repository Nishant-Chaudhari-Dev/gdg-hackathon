import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EvalSection } from "@/components/metrics/eval-section";
import { OpsSection } from "@/components/metrics/ops-section";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <PageHeader
          title="Reports"
          crumb="Projects / SentinelDesk"
          description={
            <span className="inline-flex items-center gap-1.5">
              <span className="pulse-dot relative inline-flex size-1.5 rounded-full bg-emerald-500 text-emerald-500" /> Live operations — how the AI desk is doing
              right now (refreshes every 5s).
            </span>
          }
        />
        <OpsSection />
      </section>
      <section className="space-y-4">
        <PageHeader
          title="Model evaluation"
          level={2}
          description="How accurate the classifier and escalation gate are on held-out test tickets they never saw during training."
        />
        <EvalSection />
      </section>
    </div>
  );
}
