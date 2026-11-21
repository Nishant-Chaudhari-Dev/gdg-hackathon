"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Classification } from "@/lib/types";

const DEFAULTS = {
  type: ["Incident", "Request", "Problem", "Change"],
  queue: ["Technical Support", "Product Support", "Customer Service", "IT Support", "Billing and Payments", "Returns and Exchanges", "Service Outages and Maintenance", "Sales and Pre-Sales", "Human Resources", "General Inquiry"],
  priority: ["high", "medium", "low"],
};

type Head = keyof typeof DEFAULTS;

export function OverrideDialog({
  classification,
  busy,
  onSubmit,
}: {
  classification?: Classification | null;
  busy: boolean;
  onSubmit: (override: Record<string, string>, note: string) => Promise<unknown>;
}) {
  const initial = () => ({
    type: classification?.type.label ?? "",
    queue: classification?.queue.label ?? "",
    priority: classification?.priority.label ?? "",
  });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<Head, string>>(initial);
  const [note, setNote] = useState("");

  const options = (h: Head) => {
    const fromModel = classification ? Object.keys(classification[h].probs) : [];
    return Array.from(new Set([...fromModel, ...(fromModel.length ? [] : DEFAULTS[h])]));
  };

  const changed = (Object.keys(values) as Head[]).filter((h) => values[h] && values[h] !== (classification?.[h].label ?? ""));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setValues(initial());
          setNote("");
        }
      }}
    >
      <DialogTrigger render={<Button variant="secondary" size="sm" disabled={!classification} />}>
        <SlidersHorizontal /> Override fields
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Override AI fields</DialogTitle>
          <DialogDescription>Correct the type, queue or priority the model picked. Your change is recorded in the audit log and can be used to retrain the model.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {(["type", "queue", "priority"] as Head[]).map((h) => (
            <div key={h} className="grid grid-cols-[80px_1fr] items-center gap-3">
              <Label className="capitalize text-muted-foreground">{h}</Label>
              <Select value={values[h]} onValueChange={(v) => setValues((s) => ({ ...s, [h]: String(v ?? "") }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={`Select ${h}`} />
                </SelectTrigger>
                <SelectContent>
                  {options(h).map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                      {classification?.[h].label === o && <span className="ml-1 text-[10px] text-muted-foreground">(model)</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <div className="grid grid-cols-[80px_1fr] items-center gap-3">
            <Label className="text-muted-foreground">Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why? (optional)" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || changed.length === 0}
            onClick={async () => {
              const override: Record<string, string> = {};
              for (const h of changed) override[h] = values[h];
              const ok = await onSubmit(override, note);
              if (ok) setOpen(false);
            }}
          >
            {busy ? "Saving…" : `Apply ${changed.length || ""} override${changed.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
