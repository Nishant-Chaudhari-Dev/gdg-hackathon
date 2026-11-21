"use client";

import { ArrowDown, ArrowRight, Brain, Cloud, Database, Globe, Laptop, Library, RefreshCw, Server, Waypoints, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GatewayOffline } from "@/components/layout/gateway-offline";
import { PageHeader } from "@/components/layout/page-header";
import { useResource } from "@/hooks/use-resource";
import { api, errorMessage } from "@/lib/api";
import { API_URL, MOCK_MODE } from "@/lib/config";
import { fmtMs } from "@/lib/format";
import { useLive } from "@/lib/store";
import type { ServiceHealth, SystemStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Health = "ok" | "down" | "unknown" | "managed";

interface NodeSpec {
  title: string;
  role: string;
  icon: LucideIcon;
  health: Health;
  latency?: number | null;
  version?: string | null;
  detail?: string | null;
  error?: string | null;
}

function findService(sys: SystemStatus | null, ...keys: string[]): ServiceHealth | undefined {
  return sys?.services.find((s) => keys.some((k) => s.name.toLowerCase().includes(k)));
}

function fromService(s: ServiceHealth | undefined, fallback: Health): Pick<NodeSpec, "health" | "latency" | "version" | "detail" | "error"> {
  if (!s) return { health: fallback };
  const info = s.info ?? {};
  const version = (info.version ?? info.model_version ?? info.retriever_version) as string | undefined;
  return { health: s.ok ? "ok" : "down", latency: s.latency_ms, version: version ?? null, detail: s.url, error: s.error ?? null };
}

const HEALTH_STYLE: Record<Health, { dot: string; label: string; ring: string }> = {
  ok: { dot: "bg-emerald-500", label: "Healthy", ring: "border-emerald-500/30" },
  down: { dot: "bg-red-500", label: "Down", ring: "border-red-500/50 bg-red-500/[0.05]" },
  unknown: { dot: "bg-muted-foreground/50", label: "Unknown", ring: "border-dashed" },
  managed: { dot: "bg-sky-500", label: "Managed", ring: "border-sky-500/25" },
};

function Node({ n, className }: { n: NodeSpec; className?: string }) {
  const h = HEALTH_STYLE[n.health];
  return (
    <div className={cn("relative w-full rounded-xl border bg-card p-3 shadow-sm", h.ring, className)}>
      <div className="flex items-center gap-2.5">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
          <n.icon className="size-4 text-foreground/80" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{n.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">{n.role}</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2 text-[11px]">
        <span className={cn("relative inline-flex size-2 rounded-full", h.dot, n.health === "ok" && "pulse-dot text-emerald-500")} />
        <span className="font-medium">{h.label}</span>
        {n.latency != null && <span className="tabular ml-auto text-muted-foreground">{fmtMs(n.latency)}</span>}
      </div>
      {n.version && <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={n.version}>{n.version}</div>}
      {n.detail && <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80" title={n.detail}>{n.detail}</div>}
      {n.error && <div className="mt-1 line-clamp-2 text-[10px] text-red-600 dark:text-red-400">{n.error}</div>}
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 text-muted-foreground xl:w-12">
      <ArrowRight className="hidden size-4 xl:block" />
      <ArrowDown className="size-4 xl:hidden" />
      {label && <span className="text-center text-[9px] uppercase tracking-wider">{label}</span>}
    </div>
  );
}

function Diagram({ sys, reachable }: { sys: SystemStatus | null; reachable: boolean }) {
  const sse = useLive((s) => s.sse);
  const unknown: Health = reachable ? "unknown" : "unknown";
  const gw = findService(sys, "gateway");
  const nodes = {
    browser: { title: "Browser", role: "Operator console (Next.js)", icon: Laptop, health: "ok" as Health, detail: `SSE ${sse}` },
    gateway: {
      title: "Gateway",
      role: "FastAPI · REST + SSE",
      icon: Globe,
      ...(gw ? fromService(gw, "ok") : { health: (reachable ? "ok" : "down") as Health, detail: API_URL }),
    },
    bus: { title: "Pub/Sub", role: sys?.bus ?? "message bus", icon: Waypoints, health: (sys ? "managed" : unknown) as Health },
    orch: { title: "Orchestrator", role: "Pipeline worker", icon: Server, ...fromService(findService(sys, "orch", "worker"), sys ? "managed" : unknown) },
    ml: { title: "ML service", role: "Multilingual classifier", icon: Brain, ...fromService(findService(sys, "ml", "classif"), unknown) },
    rag: { title: "RAG service", role: "Retrieval + grounded drafting", icon: Library, ...fromService(findService(sys, "rag", "retriev"), unknown) },
    store: { title: "Firestore", role: sys?.store ?? "ticket + audit store", icon: Database, health: (sys ? "managed" : unknown) as Health },
  } satisfies Record<string, NodeSpec>;

  return (
    <div className="rounded-xl border bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] bg-[size:18px_18px] p-5">
      <div className="flex flex-col items-stretch gap-2 xl:flex-row xl:items-center">
        <div className="xl:min-w-0 xl:flex-1"><Node n={nodes.browser} /></div>
        <Arrow label="HTTPS · SSE" />
        <div className="xl:min-w-0 xl:flex-1"><Node n={nodes.gateway} /></div>
        <Arrow label="publish" />
        <div className="xl:min-w-0 xl:flex-1"><Node n={nodes.bus} /></div>
        <Arrow label="push" />
        <div className="xl:min-w-0 xl:flex-1"><Node n={nodes.orch} /></div>
        <Arrow label="HTTP" />
        <div className="flex flex-col gap-2 xl:min-w-0 xl:flex-1">
          <Node n={nodes.ml} />
          <Node n={nodes.rag} />
        </div>
      </div>
      <div className="mt-4 flex flex-col items-center gap-2 xl:flex-row xl:items-stretch">
        <div className="hidden flex-1 xl:block" />
        <div className="flex w-full flex-col items-center xl:w-auto">
          <div className="mb-1 flex items-center gap-2 text-[9px] uppercase tracking-wider text-muted-foreground">
            <span className="h-px w-10 border-t border-dashed border-muted-foreground/50" />
            gateway + orchestrator read / write
            <span className="h-px w-10 border-t border-dashed border-muted-foreground/50" />
          </div>
          <div className="w-full xl:w-72"><Node n={nodes.store} /></div>
        </div>
        <div className="hidden flex-1 xl:block" />
      </div>
    </div>
  );
}

export function SystemView() {
  const res = useResource(() => api.system(), { pollMs: 10_000 });
  const sys = res.data;
  const reachable = !!sys && !res.error;

  return (
    <div className="space-y-5">
      <PageHeader
        title="System"
        description="Architecture and live health of every SentinelDesk service."
        actions={
          <>
            {sys && (
              <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium", sys.mode === "gcp" ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "border-border bg-muted")}>
                <Cloud className="size-3.5" /> {sys.mode === "gcp" ? "Google Cloud" : "Local"} mode
              </span>
            )}
            {MOCK_MODE && <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600 dark:text-amber-400">MOCK</span>}
            <Button size="sm" variant="outline" onClick={res.reload}>
              <RefreshCw className={cn(res.loading && "animate-spin")} /> Refresh
            </Button>
          </>
        }
      />
      {res.error ? <GatewayOffline compact message={errorMessage(res.error)} onRetry={res.reload} /> : null}
      {res.loading && !sys ? <Skeleton className="h-72 w-full" /> : <Diagram sys={sys} reachable={reachable} />}
      {sys && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 text-[11px] uppercase tracking-wider">Service</TableHead>
                  <TableHead className="h-8 text-[11px] uppercase tracking-wider">Status</TableHead>
                  <TableHead className="h-8 text-right text-[11px] uppercase tracking-wider">Latency</TableHead>
                  <TableHead className="h-8 text-[11px] uppercase tracking-wider">URL</TableHead>
                  <TableHead className="h-8 text-[11px] uppercase tracking-wider">Info</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sys.services.map((s) => (
                  <TableRow key={s.name} className="align-top text-xs">
                    <TableCell className="py-2 font-medium">{s.name}</TableCell>
                    <TableCell className="py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("size-2 rounded-full", s.ok ? "bg-emerald-500" : "bg-red-500")} />
                        {s.ok ? "ok" : "down"}
                      </span>
                      {s.error && <div className="mt-0.5 max-w-56 text-[10px] whitespace-normal text-red-600 dark:text-red-400">{s.error}</div>}
                    </TableCell>
                    <TableCell className="tabular py-2 text-right">{fmtMs(s.latency_ms)}</TableCell>
                    <TableCell className="max-w-56 truncate py-2 font-mono text-[11px] text-muted-foreground">{s.url}</TableCell>
                    <TableCell className="py-2 font-mono text-[10.5px] whitespace-normal text-muted-foreground">
                      {s.info ? Object.entries(s.info).map(([k, v]) => (
                        <div key={k}>
                          {k}: <span className="text-foreground/80">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                        </div>
                      )) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-2 rounded-xl border bg-card p-4 text-xs">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Runtime</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted-foreground">Mode</dt>
              <dd className="font-medium">{sys.mode}</dd>
              <dt className="text-muted-foreground">Store</dt>
              <dd className="font-mono break-all">{sys.store}</dd>
              <dt className="text-muted-foreground">Bus</dt>
              <dd className="font-mono break-all">{sys.bus}</dd>
              <dt className="text-muted-foreground">Gateway</dt>
              <dd className="font-mono break-all">{MOCK_MODE ? "mock (in-browser)" : API_URL}</dd>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
