"use client";

import { useAlerts } from "@/context/AlertsContext";
import { formatCoords, formatRelativeTime, incidentPositionLabel } from "@/lib/format";
import {
  FEED_CLEARED_EVENT,
  FEED_CLEARED_STORAGE_KEY,
  alertFeedKey,
  filterVisibleFeedAlerts,
  parseClearedFeedKeys,
} from "@/lib/incident-feed";
import type { Alert } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";

function subscribeClearedFeed(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(FEED_CLEARED_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(FEED_CLEARED_EVENT, listener);
  };
}

function clearedFeedSnapshot(): string {
  try {
    return localStorage.getItem(FEED_CLEARED_STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export default function IncidentFeed() {
  const {
    alerts,
    dispatchAlert,
    markResolved,
    triggerDetection,
    simulationEnabled,
    user,
    readOnly,
  } = useAlerts();

  const now = useNow();
  const clearedRaw = useSyncExternalStore(subscribeClearedFeed, clearedFeedSnapshot, () => "[]");
  const clearedKeys = useMemo(() => new Set(parseClearedFeedKeys(clearedRaw)), [clearedRaw]);
  const visibleAlerts = useMemo(
    () => filterVisibleFeedAlerts(alerts, clearedKeys),
    [alerts, clearedKeys],
  );
  const hiddenCount = alerts.length - visibleAlerts.length;

  function writeClearedKeys(keys: string[]) {
    try {
      localStorage.setItem(FEED_CLEARED_STORAGE_KEY, JSON.stringify(keys));
    } catch {
      return;
    }
    window.dispatchEvent(new Event(FEED_CLEARED_EVENT));
  }

  function handleClearAll() {
    writeClearedKeys(alerts.map(alertFeedKey));
  }

  function handleRestoreHidden() {
    writeClearedKeys([]);
  }

  return (
    <aside
      className="
        hidden w-[280px] shrink-0
        border-l border-[var(--border)]
        bg-[var(--panel)]
        lg:flex lg:flex-col
        lg:h-full
        lg:overflow-hidden
      "
    >
      {/* Header */}
      <div className="shrink-0 p-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-bold tracking-wide text-[var(--text)]">
            INCIDENT FEED
          </h2>

          <div className="flex items-center gap-1.5">
            {simulationEnabled && user.role === "admin" && <button
              type="button"
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
            </button>}

            {visibleAlerts.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                title="Clear items from this view only (alerts remain in Alert Log)"
                className="
                  rounded border border-[var(--border)]
                  px-2 py-1 text-[9px]
                  text-[var(--text-muted)]
                  transition
                  hover:bg-[var(--card)]
                  hover:text-[var(--text)]
                "
              >
                Clear All
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Incident List */}
      <div
        className="
          min-h-0 flex-1
          overflow-y-auto
          overflow-x-hidden
          px-3 pb-3
          [scrollbar-width:none]
          [-ms-overflow-style:none]
          [&::-webkit-scrollbar]:hidden
        "
      >
        {visibleAlerts.length === 0 ? (
          <div
            className="
              rounded-md border border-dashed
              border-[var(--border)]
              p-4 text-center text-[10px]
              text-[var(--text-muted)]
            "
          >
            {hiddenCount > 0 ? (
              <>
                <p>Incident feed view cleared. All records remain in Alert Log.</p>
                <button
                  type="button"
                  onClick={handleRestoreHidden}
                  className="mt-2 rounded border border-[var(--border)] px-2.5 py-1 text-[9px] text-[var(--text-muted)] transition hover:bg-[var(--card)] hover:text-[var(--text)]"
                >
                  Show hidden ({hiddenCount})
                </button>
              </>
            ) : (
              "No detections recorded. Waiting for a positive sensor classification."
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleAlerts.map((incident) => (
              <IncidentCard
                key={incident.id}
                incident={incident}
                now={now}
                readOnly={readOnly}
                onDispatch={() => dispatchAlert(incident.id)}
                onResolve={() => markResolved(incident.id)}
              />
            ))}
            {hiddenCount > 0 && (
              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={handleRestoreHidden}
                  className="rounded border border-[var(--border)] px-2.5 py-1 text-[9px] text-[var(--text-muted)] transition hover:bg-[var(--card)] hover:text-[var(--text)]"
                >
                  Show {hiddenCount} cleared
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function IncidentCard({
  incident,
  now,
  readOnly,
  onDispatch,
  onResolve,
}: {
  incident: Alert;
  now: number;
  readOnly: boolean;
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
      {incident.source === "SIMULATION" && <p className="mt-2 text-[9px] font-bold text-amber-600 dark:text-amber-300">SIMULATED DETECTION</p>}
      {incident.locationBasis && <p className="mt-2 text-[9px] text-[var(--text-muted)]">{incidentPositionLabel(incident.locationBasis)}</p>}
      <p className="mt-2 font-mono text-[10px] text-[var(--text)]">
        {formatCoords(incident.lat, incident.lng)}
      </p>

      {/* Detection Information */}
      <p className="mt-1 text-[9px] text-[var(--text-muted)]">
        Confidence:{" "}
        <span className="text-[var(--text)]">
          {incident.confidence.toFixed(1)}%
        </span>{" "}
        {incident.radiusM === null ? "Sound-source position not estimated" : "Radius: "}
        <span className="text-[var(--text)]">
          {incident.radiusM === null ? "" : `±${incident.radiusM}m`}
        </span>
      </p>

      {/* Actions */}
      <div className="mt-3 flex gap-2">
        {!readOnly && isNew ? (
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
        ) : !readOnly && isDispatched ? (
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
