import { BarChart3, KanbanSquare, List, Network, ScrollText, Siren, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  group: "Service desk" | "Operations";
}

export const NAV: NavItem[] = [
  { href: "/", label: "Board", icon: KanbanSquare, description: "Every ticket by stage — what needs a human now", group: "Service desk" },
  { href: "/tickets", label: "Tickets", icon: List, description: "Searchable, sortable list of all tickets", group: "Service desk" },
  { href: "/incidents", label: "Incidents", icon: Siren, description: "Major incidents (outages) detected from bursts of similar tickets", group: "Operations" },
  { href: "/reports", label: "Reports", icon: BarChart3, description: "Live operations metrics and offline model evaluation", group: "Operations" },
  { href: "/audit", label: "Audit log", icon: ScrollText, description: "Who did what, when — every AI decision and human action", group: "Operations" },
  { href: "/system", label: "System", icon: Network, description: "Architecture and live service health", group: "Operations" },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
