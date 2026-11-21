"use client";

import { useState } from "react";
import { toast } from "sonner";
import { currentOperator } from "@/components/layout/operator-input";
import { api, errorMessage, type TicketActionInput, type TicketActionKind } from "@/lib/api";
import { useLive } from "@/lib/store";

const SUCCESS: Record<TicketActionKind, string> = {
  approve: "Reply approved & sent",
  edit: "Edit saved",
  reject: "Draft rejected",
  acknowledge: "Escalation acknowledged",
  override: "Classification overridden",
};

export function useTicketActions(ticketId: string) {
  const [busy, setBusy] = useState<TicketActionKind | null>(null);

  const run = async (action: TicketActionKind, extra: Omit<TicketActionInput, "action" | "operator"> = {}) => {
    setBusy(action);
    try {
      const next = await api.ticketAction(ticketId, { action, operator: currentOperator(), ...extra });
      useLive.getState().upsertTicket(next);
      toast.success(SUCCESS[action], { description: `Ticket ${ticketId}` });
      return next;
    } catch (e) {
      toast.error(`Action “${action}” failed`, { description: errorMessage(e) });
      return null;
    } finally {
      setBusy(null);
    }
  };

  return { run, busy };
}
