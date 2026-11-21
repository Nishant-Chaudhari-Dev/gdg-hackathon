"use client";

import Link from "next/link";
import { ArrowRight, Radar } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/layout/empty-state";
import { GatewayOffline, useGatewayDown } from "@/components/layout/gateway-offline";
import { currentOperator } from "@/components/layout/operator-input";
import { api, errorMessage, isOffline } from "@/lib/api";
import { DECISION_STYLES } from "@/lib/semantics";
import { useLive, useTicketList } from "@/lib/store";
import { Composer } from "./composer";
import { TicketDetail, TicketDetailSkeleton } from "./ticket-detail";
import { TicketList } from "./ticket-list";
import { TriageProgress } from "./triage-progress";

export function ConsoleView() {
  const tickets = useTicketList();
  const selectedId = useLive((s) => s.consoleTicketId);
  const setSelected = useLive((s) => s.setConsoleTicket);
  const gw = useGatewayDown();
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<{ message: string; offline: boolean } | null>(null);

  const selected = (selectedId && tickets.find((t) => t.id === selectedId)) || tickets[0] || null;

  const submit = async (input: { subject: string; body: string }) => {
    setError(null);
    setPending(Date.now());
    try {
      const t = await api.createTicket({ ...input, operator: currentOperator() });
      useLive.getState().upsertTicket(t);
      setSelected(t.id);
      if (t.decision) {
        const d = DECISION_STYLES[t.decision.action];
        (t.decision.action === "escalate" ? toast.warning : toast.success)(d.long, {
          description: `${t.classification?.queue.label ?? ""} · ${t.classification?.priority.label ?? ""} priority · ${t.latency_ms ?? "?"}ms`,
        });
      }
    } catch (e) {
      setError({ message: errorMessage(e), offline: isOffline(e) });
      toast.error("Triage failed", { description: errorMessage(e) });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
      <div className="space-y-4 xl:sticky xl:top-[4.75rem] xl:max-h-[calc(100dvh-6rem)] xl:self-start xl:overflow-y-auto">
        <Composer busy={pending != null} onSubmit={submit} />
        <div className="rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-3.5 py-2.5">
            <h2 className="text-[13px] font-semibold">Recent tickets</h2>
            <Link href="/queue" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Open queue <ArrowRight className="size-3" />
            </Link>
          </div>
          {tickets.length ? (
            <TicketList tickets={tickets.slice(0, 8)} selectedId={selected?.id ?? null} onSelect={setSelected} />
          ) : (
            <p className="px-3.5 py-6 text-center text-xs text-muted-foreground">
              {gw.loading ? "Loading…" : gw.down ? "Gateway offline — no history." : "No tickets yet. Submit one above."}
            </p>
          )}
        </div>
      </div>

      <div className="min-w-0">
        {pending != null ? (
          <TriageProgress startedAt={pending} />
        ) : error ? (
          error.offline ? (
            <GatewayOffline message={error.message} onRetry={() => setError(null)} />
          ) : (
            <EmptyState icon={Radar} title="Triage failed" description={error.message} />
          )
        ) : selected ? (
          <TicketDetail ticket={selected} />
        ) : gw.loading ? (
          <TicketDetailSkeleton />
        ) : gw.down ? (
          <GatewayOffline message={gw.error} />
        ) : (
          <EmptyState
            icon={Radar}
            title="Ready to triage"
            description="Paste a ticket or pick a sample on the left. SentinelDesk masks PII, classifies, retrieves precedents, gates for escalation and drafts a grounded reply."
            className="min-h-[420px]"
          />
        )}
      </div>
    </div>
  );
}
