"use client";

import { formatRelativeTime } from "@/lib/format";
import type { SensorNode } from "@/lib/types";

export default function NodeDetailCard({
  node,
  now,
}: {
  node: SensorNode;
  now: number;
}) {
  const statusColor = node.status === "ONLINE" ? "var(--status-online)" : "var(--text-muted)";
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
          <p className="text-[10px] text-[var(--text-muted)]">
            {node.gpsFix === true ? "Reported GPS fix" : node.lastGpsAt ? "Last known GPS position; no current fix" : "Configured node position; GPS not available"}
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
            color: statusColor,
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: statusColor,
            }}
          />

          {node.status}

          <span
            className="
              ml-1 font-normal
              text-[var(--text-muted)]
            "
          >
            {node.uptimeHours === null ? "Uptime not reported" : `${node.uptimeHours.toLocaleString()} hrs UPTIME`}
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
            {node.lastSyncAt ? formatRelativeTime(node.lastSyncAt, now) : "No telemetry received"}
          </span>
        </div>
      </div>
      {node.lastClassification && <p className="mt-3 text-[10px] text-[var(--text-muted)]">Latest audio: {node.lastClassification.detected ? "chainsaw detected" : "NOT CHAINSAW"} · {(node.lastClassification.probability * 100).toFixed(1)}% chainsaw score</p>}
    </div>
  );
}
