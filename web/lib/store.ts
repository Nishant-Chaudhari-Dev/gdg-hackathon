"use client";

import { useMemo } from "react";
import { create } from "zustand";
import type { AuditEvent, Outage, TicketRecord } from "./types";

export type SseStatus = "connecting" | "open" | "closed";
export type BootstrapStatus = "idle" | "loading" | "ready" | "error";

interface LiveState {
  tickets: Record<string, TicketRecord>;
  outages: Record<string, Outage>;
  audit: AuditEvent[];
  /** ids first seen via the live stream → timestamp (used to flash new rows). */
  arrivals: Record<string, number>;
  bootstrap: BootstrapStatus;
  bootstrapError: string | null;
  sse: SseStatus;
  lastEventAt: number | null;
  reloadToken: number;
  operator: string;
  consoleTicketId: string | null;

  setSnapshot: (s: { tickets?: TicketRecord[]; outages?: Outage[]; audit?: AuditEvent[] }) => void;
  upsertTicket: (t: TicketRecord, opts?: { live?: boolean }) => void;
  upsertOutage: (o: Outage) => void;
  addAudit: (e: AuditEvent) => void;
  setBootstrap: (s: BootstrapStatus, error?: string | null) => void;
  setSse: (s: SseStatus) => void;
  markEvent: () => void;
  retry: () => void;
  setOperator: (name: string) => void;
  setConsoleTicket: (id: string | null) => void;
}

function newer(a: { updated_at: string } | undefined, b: { updated_at: string }) {
  return !a || b.updated_at >= a.updated_at;
}

export const useLive = create<LiveState>((set) => ({
  tickets: {},
  outages: {},
  audit: [],
  arrivals: {},
  bootstrap: "idle",
  bootstrapError: null,
  sse: "connecting",
  lastEventAt: null,
  reloadToken: 0,
  operator: "",
  consoleTicketId: null,

  setSnapshot: ({ tickets, outages, audit }) =>
    set((s) => {
      const next: Partial<LiveState> = {};
      if (tickets) {
        const map = { ...s.tickets };
        for (const t of tickets) if (newer(map[t.id], t)) map[t.id] = t;
        next.tickets = map;
      }
      if (outages) {
        const map = { ...s.outages };
        for (const o of outages) if (newer(map[o.id], o)) map[o.id] = o;
        next.outages = map;
      }
      if (audit) {
        const seen = new Set(audit.map((a) => a.id));
        next.audit = [...audit, ...s.audit.filter((a) => !seen.has(a.id))].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 1000);
      }
      return next;
    }),

  upsertTicket: (t, opts) =>
    set((s) => {
      const prev = s.tickets[t.id];
      if (!newer(prev, t)) return {};
      const arrivals = opts?.live && !prev ? { ...s.arrivals, [t.id]: Date.now() } : s.arrivals;
      return { tickets: { ...s.tickets, [t.id]: t }, arrivals };
    }),

  upsertOutage: (o) =>
    set((s) => (newer(s.outages[o.id], o) ? { outages: { ...s.outages, [o.id]: o } } : {})),

  addAudit: (e) =>
    set((s) => (s.audit.some((a) => a.id === e.id) ? {} : { audit: [e, ...s.audit].slice(0, 1000) })),

  setBootstrap: (bootstrap, error = null) => set({ bootstrap, bootstrapError: error }),
  setSse: (sse) => set({ sse }),
  markEvent: () => set({ lastEventAt: Date.now() }),
  retry: () => set((s) => ({ reloadToken: s.reloadToken + 1 })),
  setOperator: (operator) => set({ operator }),
  setConsoleTicket: (consoleTicketId) => set({ consoleTicketId }),
}));

// ---- Derived hooks (memoized so zustand never sees a fresh array per render) ----
export function useTicketList(): TicketRecord[] {
  const tickets = useLive((s) => s.tickets);
  return useMemo(() => Object.values(tickets).sort((a, b) => b.created_at.localeCompare(a.created_at)), [tickets]);
}

export function useOutageList(): Outage[] {
  const outages = useLive((s) => s.outages);
  return useMemo(() => Object.values(outages).sort((a, b) => b.last_seen.localeCompare(a.last_seen)), [outages]);
}

export function useActiveOutages(): Outage[] {
  const list = useOutageList();
  return useMemo(() => list.filter((o) => o.status === "active"), [list]);
}
