"use client";

import { useEffect, useRef } from "react";
import { api, errorMessage } from "./api";
import { MOCK_MODE } from "./config";
import { useLive, type SseStatus } from "./store";
import type { AuditEvent, Outage, TicketRecord } from "./types";

export interface EventHandlers {
  onTicket?: (t: TicketRecord) => void;
  onOutage?: (o: Outage) => void;
  onAudit?: (e: AuditEvent) => void;
  onStatus?: (s: SseStatus) => void;
  /** Called on every (re)connect after the first, so callers can resync missed events. */
  onReconnect?: () => void;
}

const MIN_BACKOFF = 1_000;
const MAX_BACKOFF = 15_000;

/**
 * Subscribes to the gateway's Server-Sent Events stream (`/api/events`) with
 * exponential-backoff auto-reconnect. In mock mode it subscribes to the in-memory bus.
 */
export function useEventStream(handlers: EventHandlers, enabled = true): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    if (MOCK_MODE) {
      let unsub: (() => void) | undefined;
      void import("./mock").then(({ mockBackend }) => {
        if (disposed) return;
        ref.current.onStatus?.("open");
        unsub = mockBackend.subscribe((event, data) => {
          if (event === "ticket") ref.current.onTicket?.(data as TicketRecord);
          else if (event === "outage") ref.current.onOutage?.(data as Outage);
          else if (event === "audit") ref.current.onAudit?.(data as AuditEvent);
        });
      });
      return () => {
        disposed = true;
        unsub?.();
      };
    }

    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let backoff = MIN_BACKOFF;
    let connectedOnce = false;

    const parse = <T,>(e: MessageEvent): T | null => {
      try {
        return JSON.parse(e.data) as T;
      } catch {
        return null;
      }
    };

    const connect = () => {
      if (disposed) return;
      ref.current.onStatus?.("connecting");
      es = new EventSource(api.eventsUrl());
      es.onopen = () => {
        backoff = MIN_BACKOFF;
        ref.current.onStatus?.("open");
        if (connectedOnce) ref.current.onReconnect?.();
        connectedOnce = true;
      };
      es.addEventListener("ticket", (e) => {
        const t = parse<TicketRecord>(e as MessageEvent);
        if (t) ref.current.onTicket?.(t);
      });
      es.addEventListener("outage", (e) => {
        const o = parse<Outage>(e as MessageEvent);
        if (o) ref.current.onOutage?.(o);
      });
      es.addEventListener("audit", (e) => {
        const a = parse<AuditEvent>(e as MessageEvent);
        if (a) ref.current.onAudit?.(a);
      });
      es.onerror = () => {
        // Take over reconnection ourselves so we control backoff and resync.
        es?.close();
        es = null;
        ref.current.onStatus?.("closed");
        if (disposed) return;
        timer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      es?.close();
    };
  }, [enabled]);
}

/**
 * Mount once (in the app shell). Loads the initial snapshot (tickets, outages, audit)
 * and keeps the global store in sync with the live event stream.
 */
export function useLiveSync(): void {
  const reloadToken = useLive((s) => s.reloadToken);

  useEffect(() => {
    let cancelled = false;
    const { setBootstrap, setSnapshot } = useLive.getState();
    setBootstrap("loading");
    (async () => {
      const [tickets, outages, audit] = await Promise.allSettled([api.listTickets({ limit: 200 }), api.listOutages(), api.listAudit(200)]);
      if (cancelled) return;
      setSnapshot({
        tickets: tickets.status === "fulfilled" ? tickets.value : undefined,
        outages: outages.status === "fulfilled" ? outages.value : undefined,
        audit: audit.status === "fulfilled" ? audit.value : undefined,
      });
      if (tickets.status === "rejected") setBootstrap("error", errorMessage(tickets.reason));
      else setBootstrap("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEventStream({
    onTicket: (t) => {
      useLive.getState().upsertTicket(t, { live: true });
      useLive.getState().markEvent();
    },
    onOutage: (o) => {
      useLive.getState().upsertOutage(o);
      useLive.getState().markEvent();
    },
    onAudit: (a) => {
      useLive.getState().addAudit(a);
      useLive.getState().markEvent();
    },
    onStatus: (s) => {
      useLive.getState().setSse(s);
      // Gateway came back after a failed bootstrap → reload the snapshot.
      if (s === "open" && useLive.getState().bootstrap === "error") useLive.getState().retry();
    },
    onReconnect: () => useLive.getState().retry(),
  });
}
