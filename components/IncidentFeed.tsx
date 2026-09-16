"use client";

import { useAlerts } from "@/context/AlertsContext";
import { formatCoords, formatRelativeTime } from "@/lib/format";
import type { Alert } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import Link from "next/link";

export default function IncidentFeed() {
  const { alerts, dispatchAlert, markResolved, triggerDetection } = useAlerts();
  const now = useNow();
  const visible = alerts.slice(0, 5);

  return (
    <aside className="hidden w-[280px] shrink-0 border-l border-[#1e2b24] bg-[#0c1510] p-3 lg:block">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-bold tracking-wide text-gray-200">INCIDENT FEED</h2>
        <button
          onClick={triggerDetection}
          title="Manually simulate a new sensor detection (stand-in for the LoRa/Raspberry Pi feed, not yet connected)"
          className="rounded border border-[#26352b] px-2 py-1 text-[9px] text-gray-400 hover:bg-[#19251e]"
        >
          + Simulate Ping
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-[#26352b] p-4 text-center text-[10px] text-gray-600">
          No detections yet. Waiting on the sensor mesh
          <span className="animate-pulse">…</span>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              now={now}
              onDispatch={() => dispatchAlert(incident.id)}
              onResolve={() => markResolved(incident.id)}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function IncidentCard({
  incident,
  now,
  onDispatch,
  onResolve,
}: {
  incident: Alert;
  now: number;
  onDispatch: () => void;
  onResolve: () => void;
}) {
  const isNew = incident.status === "NEW";
  const isDispatched = incident.status === "DISPATCHED";

  const statusLabel =
    incident.status === "NEW"
      ? "NEW PING"
      : incident.status === "FALSE_POSITIVE"
        ? "FALSE POSITIVE"
        : incident.status;

  return (
    <div
      className={`rounded-md border p-3 ${
        isNew ? "border-[#e45642] bg-[#1c1d16]" : "border-[#26352b] bg-[#121c16]"
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-[8px] font-bold ${
            isNew
              ? "text-[#e95b47]"
              : isDispatched
                ? "text-[#e7a52c]"
                : incident.status === "FALSE_POSITIVE"
                  ? "text-gray-500"
                  : "text-[#65a96d]"
          }`}
        >
          {statusLabel}
        </span>
        <span className="text-[8px] text-gray-600">
          {formatRelativeTime(incident.timestamp, now)}
        </span>
      </div>

      <p className="mt-2 font-mono text-[10px] text-gray-200">
        {formatCoords(incident.lat, incident.lng)}
      </p>

      <p className="mt-1 text-[9px] text-gray-500">
        Confidence: <span className="text-gray-300">{incident.confidence.toFixed(1)}%</span>{" "}
        Radius: <span className="text-gray-300">±{incident.radiusM}m</span>
      </p>

      <div className="mt-3 flex gap-2">
        {isNew ? (
          <button
            onClick={onDispatch}
            className="flex-1 rounded bg-[#e6a52d] py-2 text-[9px] font-bold text-black transition hover:bg-[#f0b63c]"
          >
            Dispatch DENR/ENRO
          </button>
        ) : isDispatched ? (
          <button
            onClick={onResolve}
            className="flex-1 rounded border border-[#26352b] py-2 text-[9px] text-gray-400 hover:bg-[#19251e]"
          >
            Mark Resolved
          </button>
        ) : (
          <Link
            href={`/incidents/${incident.id}`}
            className="flex-1 rounded border border-[#26352b] py-2 text-center text-[9px] text-gray-400 hover:bg-[#19251e]"
          >
            Report
          </Link>
        )}

        <Link
          href={`/incidents/${incident.id}`}
          className="rounded border border-[#26352b] px-3 py-2 text-[9px] text-gray-400 hover:bg-[#19251e]"
        >
          View
        </Link>
      </div>
    </div>
  );
}
