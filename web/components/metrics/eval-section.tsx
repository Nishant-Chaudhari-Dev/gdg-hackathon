"use client";

import { FlaskConical, Target, Timer } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/layout/empty-state";
import { GatewayOffline } from "@/components/layout/gateway-offline";
import { useResource } from "@/hooks/use-resource";
import { api, errorMessage, isNotFound } from "@/lib/api";
import { fmtDateTime, fmtMs, fmtNum, fmtPct } from "@/lib/format";
import type { EvalReport, HeadEval } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChartCard } from "./chart-card";
import { ConfusionMatrix } from "./confusion-matrix";
import { KpiTile } from "./kpi-tile";

const HEADS = [
  { key: "type", label: "Type" },
  { key: "queue", label: "Queue" },
  { key: "priority", label: "Priority" },
] as const;

function f1Tone(v: number) {
  return v >= 0.8 ? "text-emerald-600 dark:text-emerald-400" : v >= 0.6 ? "text-foreground" : "text-amber-600 dark:text-amber-400";
}

const MAX_CLASSES = 12;

/** For heads with many classes, keep the top-N by support so the heatmap stays legible. */
function topClasses(head: HeadEval) {
  const support = head.labels.map((l, i) => head.per_class[l]?.support ?? head.confusion[i]?.reduce((a, b) => a + b, 0) ?? 0);
  const idx = head.labels.map((_, i) => i);
  if (idx.length <= MAX_CLASSES) return { labels: head.labels, matrix: head.confusion, truncated: false };
  const keep = [...idx].sort((a, b) => support[b] - support[a]).slice(0, MAX_CLASSES);
  return {
    labels: keep.map((i) => head.labels[i]),
    matrix: keep.map((i) => keep.map((j) => head.confusion[i]?.[j] ?? 0)),
    truncated: true,
  };
}

function PerClassTable({ head }: { head: HeadEval }) {
  const [all, setAll] = useState(false);
  const sorted = head.labels
    .map((l) => ({ label: l, ...(head.per_class[l] ?? { precision: 0, recall: 0, f1: 0, support: 0 }) }))
    .sort((a, b) => (head.labels.length > MAX_CLASSES ? b.support - a.support : 0));
  const rows = all ? sorted : sorted.slice(0, MAX_CLASSES);
  return (
    <div>
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-8 text-[11px]">Class</TableHead>
          <TableHead className="h-8 text-right text-[11px]">Precision</TableHead>
          <TableHead className="h-8 text-right text-[11px]">Recall</TableHead>
          <TableHead className="h-8 text-right text-[11px]">F1</TableHead>
          <TableHead className="h-8 text-right text-[11px]">Support</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.label} className="text-xs">
            <TableCell className="py-1.5 font-medium">{r.label}</TableCell>
            <TableCell className="tabular py-1.5 text-right">{r.precision.toFixed(3)}</TableCell>
            <TableCell className="tabular py-1.5 text-right">{r.recall.toFixed(3)}</TableCell>
            <TableCell className={cn("tabular py-1.5 text-right font-semibold", f1Tone(r.f1))}>{r.f1.toFixed(3)}</TableCell>
            <TableCell className="tabular py-1.5 text-right text-muted-foreground">{fmtNum(r.support)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    {sorted.length > MAX_CLASSES && (
      <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        {all ? "Show top classes only" : `Show all ${sorted.length} classes`}
      </button>
    )}
    </div>
  );
}

function EvalBody({ r }: { r: EvalReport }) {
  const [tab, setTab] = useState<(typeof HEADS)[number]["key"]>("type");
  const head = r.heads[tab];
  const cm = topClasses(head);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.12] via-primary/[0.04] to-transparent p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <Target className="size-3.5" /> High-priority incident recall
          </div>
          <div className="tabular mt-1 text-5xl font-semibold tracking-tight">{fmtPct(r.high_priority_incident_recall, 1)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Share of true high-priority incidents the system flags — the metric that matters for on-call.
            {r.escalation && (
              <>
                {" "}Gate escalates <b className="text-foreground">{fmtPct(r.escalation.hp_incident_escalated_recall, 1)}</b> of them (overall escalation rate {fmtPct(r.escalation.rate)}).
              </>
            )}
          </div>
        </div>
        {HEADS.map((h) => (
          <KpiTile
            key={h.key}
            label={`${h.label} macro-F1`}
            value={<span className={f1Tone(r.heads[h.key].macro_f1)}>{r.heads[h.key].macro_f1.toFixed(3)}</span>}
            sub={`accuracy ${fmtPct(r.heads[h.key].accuracy, 1)} · ${r.heads[h.key].labels.length} classes`}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ChartCard
          title="Per-head breakdown"
          description="Confusion matrix (row-normalized shading) and per-class precision / recall / F1"
          right={
            <div className="flex rounded-md border p-0.5 text-[11px]">
              {HEADS.map((h) => (
                <button
                  key={h.key}
                  type="button"
                  onClick={() => setTab(h.key)}
                  className={cn("rounded px-2 py-0.5 font-medium", tab === h.key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {h.label}
                </button>
              ))}
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
            <div className="min-w-0">
              <ConfusionMatrix labels={cm.labels} matrix={cm.matrix} />
              {cm.truncated && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Showing the {cm.labels.length} most frequent of {head.labels.length} classes; shading is normalized within the shown columns.
                </p>
              )}
            </div>
            <PerClassTable key={tab} head={head} />
          </div>
        </ChartCard>
        <div className="space-y-3">
          <ChartCard title="Offline latency" right={<Timer className="size-4 text-muted-foreground" />}>
            <div className="grid grid-cols-3 gap-2 text-center">
              {(["p50", "p95", "mean"] as const).map((k) => (
                <div key={k} className="rounded-lg bg-muted/50 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
                  <div className="tabular text-base font-semibold">{fmtMs(r.latency_ms[k])}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">n = {fmtNum(r.latency_ms.n)}</div>
          </ChartCard>
          <ChartCard title="Run" right={<FlaskConical className="size-4 text-muted-foreground" />}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Model</dt>
              <dd className="truncate font-mono">{r.model_version}</dd>
              <dt className="text-muted-foreground">Test size</dt>
              <dd className="tabular">{fmtNum(r.n_test)}</dd>
              <dt className="text-muted-foreground">Generated</dt>
              <dd>{fmtDateTime(r.generated_at)}</dd>
            </dl>
            {r.notes && <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">{r.notes}</p>}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

export function EvalSection() {
  const res = useResource(() => api.evalReport());
  if (res.data) return <EvalBody r={res.data} />;
  if (res.loading) return <Skeleton className="h-72 w-full" />;
  if (isNotFound(res.error))
    return (
      <EmptyState
        icon={FlaskConical}
        title="No offline evaluation yet"
        description={
          <>
            Run <code className="rounded bg-muted px-1 font-mono text-xs">python eval/evaluate.py</code> to generate the report, then refresh.
          </>
        }
      />
    );
  return <GatewayOffline message={errorMessage(res.error)} onRetry={res.reload} />;
}
