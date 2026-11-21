"use client";

import { Activity, AlertTriangle, EyeOff, Gauge, Inbox, ShieldAlert, Timer, UserCheck } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { GatewayOffline } from "@/components/layout/gateway-offline";
import { useResource } from "@/hooks/use-resource";
import { api, errorMessage } from "@/lib/api";
import { fmtMs, fmtPct, fmtTime, titleCase } from "@/lib/format";
import { LANGUAGE_LABELS, STAGES, priorityStyle, reasonLabel } from "@/lib/semantics";
import type { OpsMetrics } from "@/lib/types";
import { BarList } from "./bar-list";
import { ChartCard, ChartTooltip } from "./chart-card";
import { KpiTile } from "./kpi-tile";

const AXIS = { fontSize: 11, fill: "var(--chart-axis)" };

function sortedEntries(r: Record<string, number>) {
  return Object.entries(r).sort((a, b) => b[1] - a[1]);
}

function OpsCharts({ m }: { m: OpsMetrics }) {
  const reasons = sortedEntries(m.by_reason).map(([code, count]) => ({ code, label: reasonLabel(code), count }));
  const stageKeys = [...STAGES.map((s) => s.key as string).filter((k) => k in m.stage_latency_ms), ...Object.keys(m.stage_latency_ms).filter((k) => k !== "total" && !STAGES.some((s) => s.key === k))];
  const stages = stageKeys.map((k) => ({
    stage: STAGES.find((s) => s.key === k)?.label ?? titleCase(k),
    p50: m.stage_latency_ms[k].p50,
    p95: m.stage_latency_ms[k].p95,
  }));
  const throughput = m.throughput.map((t) => ({ t: fmtTime(t.minute).slice(0, 5), count: t.count }));
  const prioOrder = ["high", "medium", "low"];
  const pending = m.by_human_state.pending ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Tickets" icon={Inbox} value={m.window_tickets} sub={`${m.by_status.done ?? 0} done · ${m.by_status.failed ?? 0} failed`} />
        <KpiTile
          label="Escalation rate"
          icon={ShieldAlert}
          tone={m.escalation_rate > 0.5 ? "warning" : "default"}
          value={fmtPct(m.escalation_rate)}
          sub={`${m.by_decision.escalate ?? 0} escalated · ${m.by_decision.auto_draft ?? 0} auto-draft`}
        />
        <KpiTile label="Latency p50" icon={Timer} value={fmtMs(m.latency_ms.p50)} sub={`mean ${fmtMs(m.latency_ms.mean)} · n=${m.latency_ms.n}`} />
        <KpiTile label="Latency p95" icon={Gauge} value={fmtMs(m.latency_ms.p95)} sub="end-to-end pipeline" />
        <KpiTile
          label="Active outages"
          icon={AlertTriangle}
          tone={m.active_outages > 0 ? "danger" : "success"}
          value={<span className={m.active_outages > 0 ? "text-red-600 dark:text-red-400" : ""}>{m.active_outages}</span>}
          sub={m.active_outages > 0 ? "major incident open" : "all clear"}
        />
        <KpiTile label="PII masked" icon={EyeOff} value={m.pii_masked_tickets} sub={`${fmtPct(m.window_tickets ? m.pii_masked_tickets / m.window_tickets : 0)} of tickets`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <ChartCard title="Throughput" description="Tickets per minute" className="lg:col-span-3" right={<Activity className="size-4 text-muted-foreground" />}>
          <div className="h-52">
            {throughput.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={throughput} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <defs>
                    <linearGradient id="tp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="t" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                  <RTooltip content={<ChartTooltip />} cursor={{ stroke: "var(--chart-axis)", strokeDasharray: 3 }} />
                  <Area type="monotone" dataKey="count" name="Tickets" stroke="var(--chart-1)" strokeWidth={2} fill="url(#tp)" activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-16 text-center text-xs text-muted-foreground">No throughput yet</p>
            )}
          </div>
        </ChartCard>
        <ChartCard title="Escalation reasons" description="Gate rule hits across tickets" className="lg:col-span-2">
          <div className="h-52">
            {reasons.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reasons} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={4}>
                  <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
                  <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={{ ...AXIS, fontSize: 10.5 }} tickLine={false} axisLine={false} width={140} />
                  <RTooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
                  <Bar dataKey="count" name="Tickets" fill="var(--chart-8)" radius={[0, 4, 4, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-16 text-center text-xs text-muted-foreground">No escalations yet</p>
            )}
          </div>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ChartCard title="Priority">
          <BarList
            items={prioOrder.filter((p) => m.by_priority[p] != null).map((p) => ({ key: p, label: priorityStyle(p).label, value: m.by_priority[p], className: priorityStyle(p).bar }))}
          />
        </ChartCard>
        <ChartCard title="Queue">
          <BarList items={sortedEntries(m.by_queue).map(([k, v]) => ({ key: k, label: k, value: v, color: "var(--chart-1)" }))} />
        </ChartCard>
        <ChartCard title="Language">
          <BarList items={sortedEntries(m.by_language).map(([k, v]) => ({ key: k, label: `${k.toUpperCase()} · ${LANGUAGE_LABELS[k] ?? k}`, value: v, color: "var(--chart-7)" }))} />
        </ChartCard>
        <ChartCard title="Human review" right={<UserCheck className="size-4 text-muted-foreground" />} description={pending ? `${pending} awaiting an operator` : undefined}>
          <BarList items={sortedEntries(m.by_human_state).map(([k, v]) => ({ key: k, label: titleCase(k), value: v, color: "var(--chart-3)" }))} />
        </ChartCard>
      </div>

      <ChartCard title="Per-stage latency" description="p50 vs p95 per pipeline stage (ms)">
        <div className="h-56">
          {stages.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stages} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="stage" tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} />
                <RTooltip content={<ChartTooltip formatter={(v) => fmtMs(v)} />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
                <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} />
                <Bar dataKey="p50" name="p50" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="p95" name="p95" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-16 text-center text-xs text-muted-foreground">No stage timings yet</p>
          )}
        </div>
      </ChartCard>
    </div>
  );
}

export function OpsSection() {
  const res = useResource(() => api.metrics(), { pollMs: 5_000 });
  if (!res.data) {
    if (res.error) return <GatewayOffline message={errorMessage(res.error)} onRetry={res.reload} />;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {res.error ? <GatewayOffline compact message={`Live metrics stale — ${errorMessage(res.error)}`} onRetry={res.reload} /> : null}
      <OpsCharts m={res.data} />
    </div>
  );
}
