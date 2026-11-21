import { Activity, BarChart3, Inbox, Network, ScrollText, Siren, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Console", icon: Activity, description: "Triage a ticket live" },
  { href: "/queue", label: "Queue", icon: Inbox, description: "All tickets, live" },
  { href: "/outages", label: "Outages", icon: Siren, description: "Major incidents" },
  { href: "/metrics", label: "Metrics", icon: BarChart3, description: "Ops + offline eval" },
  { href: "/audit", label: "Audit", icon: ScrollText, description: "Who did what" },
  { href: "/system", label: "System", icon: Network, description: "Architecture & health" },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
