"use client";

import { useAlerts } from "@/context/AlertsContext";
import { OUTPOST } from "@/lib/mock-data";
import { NAV_ITEMS, isNavActive } from "@/lib/nav";
import { Home } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Sidebar() {
  const pathname = usePathname();
  const { alerts, sensors } = useAlerts();

  const onlineCount = sensors.filter(
    (n) => n.status === "ONLINE"
  ).length;

  const newAlertCount = alerts.filter(
    (a) => a.status === "NEW"
  ).length;

  return (
    <aside
      className="
        hidden w-[185px] shrink-0
        border-r border-[var(--border)]
        bg-[var(--panel)]
        md:flex md:flex-col
      "
    >
      {/* Header */}
      <div
        className="
          flex h-14 items-center px-7
          border-b border-[var(--border)]
        "
      >
        <span
          className="
            text-xs font-semibold tracking-widest
            text-[var(--text-muted)]
          "
        >
          BANTAY GUBAT
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isNavActive(pathname, item.href);

          const badge =
            item.href === "/dashboard" && newAlertCount > 0
              ? newAlertCount
              : null;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                relative flex w-full items-center gap-3
                px-6 py-3 text-xs transition

                ${
                  active
                    ? "bg-[var(--card)] text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--card)] hover:text-[var(--text)]"
                }
              `}
            >
              {/* Active indicator */}
              {active && (
                <span
                  className="
                    absolute left-0 top-0
                    h-full w-[3px]
                  "
                  style={{
                    backgroundColor: "var(--accent)",
                  }}
                />
              )}

              <Icon size={15} />

              <span>{item.label}</span>

              {/* Alert badge */}
              {badge !== null && (
                <span
                  className="
                    ml-auto rounded
                    px-1.5 py-0.5
                    text-[10px] font-bold
                    text-black
                  "
                  style={{
                    backgroundColor: "var(--accent)",
                  }}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Outpost Information */}
      <div
        className="
          border-t border-[var(--border)]
          p-5
        "
      >
        <div
          className="
            flex items-center gap-2
            text-xs font-semibold
            text-[var(--text)]
          "
        >
          <Home size={14} />

          {OUTPOST.name}
        </div>

        <p
          className="
            mt-1 text-[10px]
            text-[var(--text-muted)]
          "
        >
          {OUTPOST.location}
        </p>

        {/* Active Nodes */}
        <div
          className="
            mt-4 flex items-center gap-2
            text-[9px] uppercase tracking-wider
          "
          style={{
            color: "var(--status-online)",
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: "var(--status-online)",
            }}
          />

          {onlineCount} nodes active
        </div>
      </div>
    </aside>
  );
}