"use client";

import MetricBar from "./ui/MetricBar";
import { formatRelativeTime } from "@/lib/format";
import type { SensorNode } from "@/lib/types";

export default function NodeDetailCard({
  node,
  now,
}: {
  node: SensorNode;
  now: number;
}) {
  return (
    <div
      className="
        rounded-lg
        border border-[var(--border)]
        bg-[var(--card)]
        p-4
      "
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">
            {node.name}
          </p>

          <p className="text-[10px] text-[var(--text-muted)]">
            {node.lat.toFixed(4)}° N, {node.lng.toFixed(4)}° E
          </p>
        </div>

        <span
          className="
            flex items-center gap-1.5
            rounded
            bg-[var(--panel)]
            px-2 py-1
            text-[9px] font-bold
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

          {node.status}

          <span
            className="
              ml-1 font-normal
              text-[var(--text-muted)]
            "
          >
            {node.uptimeHours.toLocaleString()} hrs UPTIME
          </span>
        </span>
      </div>

      <p
        className="
          mt-1 text-[10px]
          text-[var(--text-muted)]
        "
      >
        Deployed: {node.deployed}
      </p>

      <div className="mt-4 space-y-2.5">
        <MetricBar
          label="Signal Quality"
          value={node.signal}
        />

        <MetricBar
          label="Battery Health"
          value={node.battery}
        />

        <div className="flex items-center gap-2">
          <span
            className="
              w-24 shrink-0
              text-[10px]
              text-[var(--text-muted)]
            "
          >
            Core Temp
          </span>

          <span
            className="
              text-[10px]
              text-[var(--text)]
            "
          >
            {node.coreTemp.toFixed(1)} °C
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className="
              w-24 shrink-0
              text-[10px]
              text-[var(--text-muted)]
            "
          >
            Last Sync
          </span>

          <span
            className="
              text-[10px]
              text-[var(--text)]
            "
          >
            {formatRelativeTime(node.lastSyncAt, now)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className="
              w-24 shrink-0
              text-[10px]
              text-[var(--text-muted)]
            "
          >
            Firmware
          </span>

          <span
            className="
              text-[10px]
              text-[var(--text)]
            "
          >
            {node.firmware}
          </span>
        </div>
      </div>
    </div>
  );
}