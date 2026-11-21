"use client";

import { UserRound } from "lucide-react";
import { useEffect } from "react";
import { OPERATOR_STORAGE_KEY } from "@/lib/config";
import { useLive } from "@/lib/store";

export function OperatorInput() {
  const operator = useLive((s) => s.operator);
  const setOperator = useLive((s) => s.setOperator);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(OPERATOR_STORAGE_KEY);
      if (saved) setOperator(saved);
    } catch {
      /* ignore */
    }
  }, [setOperator]);

  return (
    <label className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background/50 pl-2 pr-1 text-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
      <UserRound className="size-3.5 text-muted-foreground" />
      <span className="sr-only">Operator name</span>
      <input
        value={operator}
        onChange={(e) => {
          setOperator(e.target.value);
          try {
            localStorage.setItem(OPERATOR_STORAGE_KEY, e.target.value);
          } catch {
            /* ignore */
          }
        }}
        placeholder="Operator name"
        className="w-28 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
      />
    </label>
  );
}

/** Operator name to attach to actions (falls back to "operator"). */
export function currentOperator(): string {
  return useLive.getState().operator.trim() || "operator";
}
