"use client";

import { ChevronDown, Globe2, Shuffle, Siren, Skull, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, errorMessage, type SimulateScenario } from "@/lib/api";

const SCENARIOS: { value: SimulateScenario; label: string; description: string; icon: typeof Zap }[] = [
  { value: "mixed", label: "Mixed traffic", description: "Billing, access, sales, incidents", icon: Shuffle },
  { value: "outage", label: "Outage storm", description: "Burst of correlated VPN failures", icon: Siren },
  { value: "german", label: "German tickets", description: "DE inputs, cross-lingual retrieval", icon: Globe2 },
  { value: "adversarial", label: "Adversarial", description: "Prompt injection & sensitive asks", icon: Skull },
];

export function SimulateMenu() {
  const [busy, setBusy] = useState(false);
  const start = async (scenario: SimulateScenario) => {
    setBusy(true);
    try {
      const r = await api.simulate({ scenario });
      toast.success(`Simulating ${r.started} tickets`, { description: `Scenario: ${r.scenario} — watch them stream in.` });
    } catch (e) {
      toast.error("Simulation failed", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={busy} />}>
        <Zap className="text-amber-500" /> Simulate traffic <ChevronDown className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Scenario</DropdownMenuLabel>
          {SCENARIOS.map((s) => (
            <DropdownMenuItem key={s.value} onClick={() => void start(s.value)} className="items-start py-1.5">
              <s.icon className="mt-0.5" />
              <div>
                <div className="text-[13px] font-medium">{s.label}</div>
                <div className="text-[11px] text-muted-foreground">{s.description}</div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
