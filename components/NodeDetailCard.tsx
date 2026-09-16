"use client";

import MetricBar from "./ui/MetricBar";
import { formatRelativeTime } from "@/lib/format";
import type { SensorNode } from "@/lib/types";

export default function NodeDetailCard({ node, now }: { node: SensorNode; now: number }) {
  return (
    <div className="rounded-lg border border-[#24332a] bg-[#101a14] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{node.name}</p>
          <p className="text-[10px] text-gray-500">
            {node.lat.toFixed(4)}° N, {node.lng.toFixed(4)}° E
          </p>
        </div>

        <span className="flex items-center gap-1.5 rounded bg-[#152018] px-2 py-1 text-[9px] font-bold text-[#75b878]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#75b878]" />
          {node.status}
          <span className="ml-1 font-normal text-gray-500">
            {node.uptimeHours.toLocaleString()} hrs UPTIME
          </span>
        </span>
      </div>

      <p className="mt-1 text-[10px] text-gray-600">Deployed: {node.deployed}</p>

      <div className="mt-4 space-y-2.5">
        <MetricBar label="Signal Quality" value={node.signal} />
        <MetricBar label="Battery Health" value={node.battery} />
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-[10px] text-gray-500">Core Temp</span>
          <span className="text-[10px] text-gray-300">{node.coreTemp.toFixed(1)} °C</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-[10px] text-gray-500">Last Sync</span>
          <span className="text-[10px] text-gray-300">
            {formatRelativeTime(node.lastSyncAt, now)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-[10px] text-gray-500">Firmware</span>
          <span className="text-[10px] text-gray-300">{node.firmware}</span>
        </div>
      </div>
    </div>
  );
}
