import { Map, Radio, Bell, FileText, Settings } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: typeof Map;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Live Map", href: "/", icon: Map },
  { label: "Sensor Nodes", href: "/sensor-nodes", icon: Radio },
  { label: "Alert Log", href: "/alerts", icon: Bell },
  { label: "Reports", href: "/reports", icon: FileText },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function titleForPathname(pathname: string): string {
  if (pathname.startsWith("/incidents/")) return "Incident Details";
  const match = NAV_ITEMS.find((item) => isNavActive(pathname, item.href));
  return match?.label ?? "Live Map";
}
