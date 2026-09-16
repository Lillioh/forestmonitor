"use client";

import NodeDetailCard from "@/components/NodeDetailCard";
import MeshTopology from "@/components/MeshTopology";
import { useAlerts } from "@/context/AlertsContext";
import { formatRelativeTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";

export default function SensorNodesPage() {
  const now = useNow();
  const { sensors, nodeEvents } = useAlerts();
  const events = [...nodeEvents].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="p-5">
      <p className="mb-1 text-xs font-semibold tracking-wider text-gray-400">SENSOR NODES</p>
      <p className="mb-4 text-[10px] text-gray-600">Mesh Management &amp; Node Health Status</p>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {sensors.map((node) => (
          <NodeDetailCard key={node.id} node={node} now={now} />
        ))}
      </div>

      <div className="mb-5">
        <MeshTopology />
      </div>

      <div className="rounded-lg border border-[#24332a] bg-[#0f1913]">
        <p className="border-b border-[#24332a] px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Recent Node Event Logs
        </p>

        {events.length === 0 ? (
          <p className="px-4 py-8 text-center text-[10px] text-gray-600">
            No node events logged yet — the mesh will report sync and calibration events as they
            happen.
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-gray-600">
                  <th className="px-4 py-2 font-medium">Timestamp</th>
                  <th className="px-4 py-2 font-medium">Node</th>
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t border-[#1b2620]">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-gray-400">
                      {formatRelativeTime(event.timestamp, now)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-300">{event.nodeId}</td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-[#8fb999]">
                      {event.type}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{event.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
