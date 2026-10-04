"use client";

import { useAlerts } from "@/context/AlertsContext";
import { formatCoords, formatRelativeTime } from "@/lib/format";
import type { Alert } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import Link from "next/link";

export default function IncidentFeed() {
  const {
    alerts,
    dispatchAlert,
    markResolved,
    triggerDetection,
  } = useAlerts();

  const now = useNow();
  const visible = alerts.slice(0, 5);

  return (
    <aside
      className="
        hidden w-[280px] shrink-0
        border-l border-[var(--border)]
        bg-[var(--panel)]
        p-3 lg:block
      "
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-bold tracking-wide text-[var(--text)]">
          INCIDENT FEED
        </h2>

        <button
          onClick={triggerDetection}
          title="Manually simulate a new sensor detection (stand-in for the LoRa/Raspberry Pi feed, not yet connected)"
          className="
            rounded border border-[var(--border)]
            px-2 py-1 text-[9px]
            text-[var(--text-muted)]
            transition
            hover:bg-[var(--card)]
            hover:text-[var(--text)]
          "
        >
          + Simulate Ping
        </button>
      </div>

      {/* Empty State */}
      {visible.length === 0 ? (
        <div
          className="
            rounded-md border border-dashed
            border-[var(--border)]
            p-4 text-center text-[10px]
            text-[var(--text-muted)]
          "
        >
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

  const statusColor =
    isNew
      ? "#e95b47"
      : isDispatched
        ? "var(--accent)"
        : incident.status === "FALSE_POSITIVE"
          ? "var(--text-muted)"
          : "var(--status-online)";

  return (
    <div
      className={`
        rounded-md border p-3

        ${
          isNew
            ? "border-[#e45642] bg-[#f4e9e6] dark:bg-[#1c1d16]"
            : "border-[var(--border)] bg-[var(--card)]"
        }
      `}
    >
      {/* Status + Time */}
      <div className="flex items-center justify-between">
        <span
          className="text-[8px] font-bold"
          style={{ color: statusColor }}
        >
          {statusLabel}
        </span>

        <span className="text-[8px] text-[var(--text-muted)]">
          {formatRelativeTime(incident.timestamp, now)}
        </span>
      </div>

      {/* Coordinates */}
      <p className="mt-2 font-mono text-[10px] text-[var(--text)]">
        {formatCoords(incident.lat, incident.lng)}
      </p>

      {/* Detection Information */}
      <p className="mt-1 text-[9px] text-[var(--text-muted)]">
        Confidence:{" "}
        <span className="text-[var(--text)]">
          {incident.confidence.toFixed(1)}%
        </span>{" "}
        Radius:{" "}
        <span className="text-[var(--text)]">
          ±{incident.radiusM}m
        </span>
      </p>

      {/* Actions */}
      <div className="mt-3 flex gap-2">
        {isNew ? (
          <button
            onClick={onDispatch}
            className="
              flex-1 rounded
              bg-[var(--accent)]
              py-2 text-[9px] font-bold text-black
              transition
              hover:brightness-110
            "
          >
            Dispatch DENR/ENRO
          </button>
        ) : isDispatched ? (
          <button
            onClick={onResolve}
            className="
              flex-1 rounded
              border border-[var(--border)]
              py-2 text-[9px]
              text-[var(--text-muted)]
              transition
              hover:bg-[var(--panel)]
              hover:text-[var(--text)]
            "
          >
            Mark Resolved
          </button>
        ) : (
          <Link
            href={`/incidents/${incident.id}`}
            className="
              flex-1 rounded
              border border-[var(--border)]
              py-2 text-center text-[9px]
              text-[var(--text-muted)]
              transition
              hover:bg-[var(--panel)]
              hover:text-[var(--text)]
            "
          >
            Report
          </Link>
        )}

        <Link
          href={`/incidents/${incident.id}`}
          className="
            rounded border border-[var(--border)]
            px-3 py-2 text-[9px]
            text-[var(--text-muted)]
            transition
            hover:bg-[var(--panel)]
            hover:text-[var(--text)]
          "
        >
          View
        </Link>
      </div>
    </div>
  );
}