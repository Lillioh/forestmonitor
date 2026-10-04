"use client";

import { useAlerts } from "@/context/AlertsContext";
import { formatCoords, formatRelativeTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import Link from "next/link";
import { useState } from "react";
import AudioWaveform from "./AudioWaveform";
import StatusBadge from "./ui/StatusBadge";

export default function IncidentDetailView({ id }: { id: string }) {
  const {
    getAlert,
    teams,
    dispatchAlert,
    markResolved,
    markFalsePositive,
    escalate,
    assignTeam,
  } = useAlerts();

  const now = useNow();
  const alert = getAlert(id);

  const [selectedTeam, setSelectedTeam] = useState(
    alert?.assignedTeamId ?? ""
  );

  if (!alert) {
    return (
      <div className="p-8 text-center text-sm text-[var(--text-muted)]">
        Incident #{id} was not found.

        <div className="mt-3">
          <Link
            href="/"
            className="text-[var(--accent)] hover:underline"
          >
            Return to Live Map
          </Link>
        </div>
      </div>
    );
  }

  const timeline = [
    {
      label: `Sound detected by ${alert.nodeId}`,
      offset: 0,
    },
    ...(alert.tdoa[0]
      ? [
          {
            label: `Sound detected by NODE-02 (+${alert.tdoa[0].ms}ms)`,
            offset: alert.tdoa[0].ms,
          },
        ]
      : []),
    ...(alert.tdoa[2]
      ? [
          {
            label: `Sound detected by NODE-03 (+${alert.tdoa[2].ms}ms)`,
            offset: alert.tdoa[2].ms,
          },
        ]
      : []),
    {
      label: "TDoA localization complete",
      offset: (alert.tdoa[2]?.ms ?? 0) + 400,
    },
    {
      label: `CNN classification: ${alert.classification} (${alert.confidence.toFixed(
        1
      )}%)`,
      offset: (alert.tdoa[2]?.ms ?? 0) + 1200,
    },
    {
      label: "Alert generated",
      offset: (alert.tdoa[2]?.ms ?? 0) + 2200,
    },
  ];

  return (
    <div className="bg-[var(--background)] p-5">

      {/* Breadcrumb */}
      <p className="mb-1 text-[10px] text-[var(--text-muted)]">
        <Link
          href="/"
          className="transition hover:text-[var(--text)]"
        >
          Live Map
        </Link>{" "}
        / Incident Feed / Incident #{alert.code}
      </p>

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)]">
            {alert.code}
          </h2>

          <p className="text-[10px] text-[var(--text-muted)]">
            {new Date(alert.timestamp).toLocaleString("en-PH", {
              timeZone: "Asia/Manila",
            })}{" "}
            PHT · {formatRelativeTime(alert.timestamp, now)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={alert.status} />

          <span
            className={`
              rounded border px-2 py-0.5
              text-[9px] font-bold

              ${
                alert.priority === "HIGH"
                  ? "border-[#e95b47]/40 bg-[#e95b47]/15 text-[#e95b47]"
                  : alert.priority === "MEDIUM"
                    ? "border-[#e7a52c]/40 bg-[#e7a52c]/15 text-[#e7a52c]"
                    : "border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)]"
              }
            `}
          >
            {alert.priority} PRIORITY
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">

        {/* Left Column */}
        <div className="space-y-4 xl:col-span-2">

          <AudioWaveform seed={Number(alert.id)} />

          {/* TDoA Analysis */}
          <div
            className="
              rounded-lg border border-[var(--border)]
              bg-[var(--card)] p-4
            "
          >
            <p
              className="
                mb-3 text-[10px] font-semibold
                uppercase tracking-wider
                text-[var(--text-muted)]
              "
            >
              Time Difference of Arrival (TDoA) Analysis
            </p>

            <div className="space-y-2">
              {alert.tdoa.map((pair) => (
                <div
                  key={pair.pair}
                  className="
                    flex items-center justify-between
                    rounded border border-[var(--border)]
                    px-3 py-2 text-[11px]
                  "
                >
                  <span className="font-mono text-[var(--text-muted)]">
                    {pair.pair}
                  </span>

                  <span
                    className="font-mono"
                    style={{ color: "var(--accent)" }}
                  >
                    {pair.ms.toFixed(1)}ms
                  </span>
                </div>
              ))}
            </div>

            <p className="mt-3 text-[10px] text-[var(--text-muted)]">
              Estimated position:{" "}
              {formatCoords(alert.lat, alert.lng)} · Radius ±
              {alert.radiusM}m
            </p>
          </div>

          {/* Incident Timeline */}
          <div
            className="
              rounded-lg border border-[var(--border)]
              bg-[var(--card)] p-4
            "
          >
            <p
              className="
                mb-3 text-[10px] font-semibold
                uppercase tracking-wider
                text-[var(--text-muted)]
              "
            >
              Incident Timeline
            </p>

            <div className="space-y-2">
              {timeline.map((step, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 text-[11px]"
                >
                  <span
                    className="
                      w-16 shrink-0 font-mono
                      text-[var(--text-muted)]
                    "
                  >
                    +{(step.offset / 1000).toFixed(1)}s
                  </span>

                  <span className="text-[var(--text)]">
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4">

          {/* Response Actions */}
          <div
            className="
              rounded-lg border border-[var(--border)]
              bg-[var(--card)] p-4
            "
          >
            <p
              className="
                mb-3 text-[10px] font-semibold
                uppercase tracking-wider
                text-[var(--text-muted)]
              "
            >
              Response Actions
            </p>

            <label className="mb-3 block">
              <span
                className="
                  mb-1 block text-[9px]
                  uppercase tracking-wider
                  text-[var(--text-muted)]
                "
              >
                Assigned Command Team
              </span>

              <select
                value={selectedTeam}
                onChange={(e) => {
                  setSelectedTeam(e.target.value);
                  assignTeam(alert.id, e.target.value);
                }}
                className="
                  w-full rounded-md
                  border border-[var(--border)]
                  bg-[var(--panel)]
                  px-3 py-2 text-[11px]
                  text-[var(--text)]
                  outline-none
                "
              >
                <option value="">Select Team...</option>

                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.shortCode})
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-2">

              {/* Dispatch */}
              <button
                onClick={() =>
                  dispatchAlert(
                    alert.id,
                    selectedTeam || undefined
                  )
                }
                disabled={
                  alert.status === "RESOLVED" ||
                  alert.status === "FALSE_POSITIVE"
                }
                className="
                  w-full rounded
                  bg-[var(--accent)]
                  py-2 text-[10px]
                  font-bold text-black
                  transition
                  hover:brightness-110
                  disabled:cursor-not-allowed
                  disabled:opacity-30
                "
              >
                Dispatch DENR/ENRO Team
              </button>

              {/* Resolve */}
              {alert.status === "DISPATCHED" && (
                <button
                  onClick={() => markResolved(alert.id)}
                  className="
                    w-full rounded
                    border border-[var(--border)]
                    py-2 text-[10px]
                    text-[var(--text-muted)]
                    transition
                    hover:bg-[var(--panel)]
                    hover:text-[var(--text)]
                  "
                >
                  Mark Resolved
                </button>
              )}

              <div className="flex gap-2">

                {/* False Positive */}
                <button
                  onClick={() =>
                    markFalsePositive(alert.id)
                  }
                  className="
                    flex-1 rounded
                    border border-[var(--border)]
                    py-2 text-[10px]
                    text-[var(--text-muted)]
                    transition
                    hover:bg-[var(--panel)]
                    hover:text-[var(--text)]
                  "
                >
                  False Positive
                </button>

                {/* Escalate */}
                <button
                  onClick={() => escalate(alert.id)}
                  className="
                    flex-1 rounded
                    border border-[#e95b47]/40
                    py-2 text-[10px]
                    text-[#e95b47]
                    transition
                    hover:bg-[#e95b47]/10
                  "
                >
                  Escalate
                </button>

              </div>
            </div>
          </div>

          {/* Detection Data */}
          <div
            className="
              rounded-lg border border-[var(--border)]
              bg-[var(--card)] p-4 text-[11px]
            "
          >
            <p
              className="
                mb-3 text-[10px] font-semibold
                uppercase tracking-wider
                text-[var(--text-muted)]
              "
            >
              Detection Data
            </p>

            <Row
              label="Classification"
              value={alert.classification}
            />

            <Row
              label="Confidence"
              value={`${alert.confidence.toFixed(1)}%`}
            />

            <Row
              label="Detecting Node"
              value={alert.nodeId}
            />

            <Row
              label="Zone"
              value={alert.zone}
            />

            <Row
              label="Coordinates"
              value={formatCoords(alert.lat, alert.lng)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      className="
        flex items-center justify-between
        border-t border-[var(--border)]
        py-2
        first:border-t-0
        first:pt-0
      "
    >
      <span className="text-[var(--text-muted)]">
        {label}
      </span>

      <span className="text-[var(--text)]">
        {value}
      </span>
    </div>
  );
}