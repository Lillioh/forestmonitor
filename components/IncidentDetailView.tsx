"use client";

import { useAlerts } from "@/context/AlertsContext";
import { formatCoords, formatRelativeTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import Link from "next/link";
import { useState } from "react";
import AudioWaveform from "./AudioWaveform";
import StatusBadge from "./ui/StatusBadge";

export default function IncidentDetailView({ id }: { id: string }) {
  const { getAlert, teams, dispatchAlert, markResolved, markFalsePositive, escalate, assignTeam } =
    useAlerts();
  const now = useNow();
  const alert = getAlert(id);
  const [selectedTeam, setSelectedTeam] = useState(alert?.assignedTeamId ?? "");

  if (!alert) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        Incident #{id} was not found.
        <div className="mt-3">
          <Link href="/" className="text-[#e6a52d] hover:underline">
            Return to Live Map
          </Link>
        </div>
      </div>
    );
  }

  const timeline = [
    { label: `Sound detected by ${alert.nodeId}`, offset: 0 },
    ...(alert.tdoa[0] ? [{ label: `Sound detected by NODE-02 (+${alert.tdoa[0].ms}ms)`, offset: alert.tdoa[0].ms }] : []),
    ...(alert.tdoa[2] ? [{ label: `Sound detected by NODE-03 (+${alert.tdoa[2].ms}ms)`, offset: alert.tdoa[2].ms }] : []),
    { label: "TDoA localization complete", offset: (alert.tdoa[2]?.ms ?? 0) + 400 },
    {
      label: `CNN classification: ${alert.classification} (${alert.confidence.toFixed(1)}%)`,
      offset: (alert.tdoa[2]?.ms ?? 0) + 1200,
    },
    { label: "Alert generated", offset: (alert.tdoa[2]?.ms ?? 0) + 2200 },
  ];

  return (
    <div className="p-5">
      <p className="mb-1 text-[10px] text-gray-600">
        <Link href="/" className="hover:text-gray-300">
          Live Map
        </Link>{" "}
        / Incident Feed / Incident #{alert.code}
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">{alert.code}</h2>
          <p className="text-[10px] text-gray-500">
            {new Date(alert.timestamp).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} PHT ·{" "}
            {formatRelativeTime(alert.timestamp, now)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={alert.status} />
          <span
            className={`rounded border px-2 py-0.5 text-[9px] font-bold ${
              alert.priority === "HIGH"
                ? "border-[#e95b47]/40 bg-[#e95b47]/15 text-[#e95b47]"
                : alert.priority === "MEDIUM"
                  ? "border-[#e7a52c]/40 bg-[#e7a52c]/15 text-[#e7a52c]"
                  : "border-gray-600/40 bg-gray-500/10 text-gray-400"
            }`}
          >
            {alert.priority} PRIORITY
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <AudioWaveform seed={Number(alert.id)} />

          <div className="rounded-lg border border-[#24332a] bg-[#0f1913] p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Time Difference of Arrival (TDoA) Analysis
            </p>
            <div className="space-y-2">
              {alert.tdoa.map((pair) => (
                <div
                  key={pair.pair}
                  className="flex items-center justify-between rounded border border-[#1b2620] px-3 py-2 text-[11px]"
                >
                  <span className="font-mono text-gray-400">{pair.pair}</span>
                  <span className="font-mono text-[#e6a52d]">{pair.ms.toFixed(1)}ms</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-gray-600">
              Estimated position: {formatCoords(alert.lat, alert.lng)} · Radius ±{alert.radiusM}m
            </p>
          </div>

          <div className="rounded-lg border border-[#24332a] bg-[#0f1913] p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Incident Timeline
            </p>
            <div className="space-y-2">
              {timeline.map((step, i) => (
                <div key={i} className="flex items-start gap-3 text-[11px]">
                  <span className="w-16 shrink-0 font-mono text-gray-600">
                    +{(step.offset / 1000).toFixed(1)}s
                  </span>
                  <span className="text-gray-300">{step.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-[#24332a] bg-[#0f1913] p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Response Actions
            </p>

            <label className="mb-3 block">
              <span className="mb-1 block text-[9px] uppercase tracking-wider text-gray-600">
                Assigned Command Team
              </span>
              <select
                value={selectedTeam}
                onChange={(e) => {
                  setSelectedTeam(e.target.value);
                  assignTeam(alert.id, e.target.value);
                }}
                className="w-full rounded-md border border-[#24332a] bg-[#101a14] px-3 py-2 text-[11px] text-gray-200"
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
              <button
                onClick={() => dispatchAlert(alert.id, selectedTeam || undefined)}
                disabled={alert.status === "RESOLVED" || alert.status === "FALSE_POSITIVE"}
                className="w-full rounded bg-[#e6a52d] py-2 text-[10px] font-bold text-black hover:bg-[#f0b63c] disabled:cursor-not-allowed disabled:opacity-30"
              >
                Dispatch DENR/ENRO Team
              </button>

              {alert.status === "DISPATCHED" && (
                <button
                  onClick={() => markResolved(alert.id)}
                  className="w-full rounded border border-[#26352b] py-2 text-[10px] text-gray-300 hover:bg-[#19251e]"
                >
                  Mark Resolved
                </button>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => markFalsePositive(alert.id)}
                  className="flex-1 rounded border border-[#26352b] py-2 text-[10px] text-gray-400 hover:bg-[#19251e]"
                >
                  False Positive
                </button>
                <button
                  onClick={() => escalate(alert.id)}
                  className="flex-1 rounded border border-[#e95b47]/40 py-2 text-[10px] text-[#e95b47] hover:bg-[#e95b47]/10"
                >
                  Escalate
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[#24332a] bg-[#0f1913] p-4 text-[11px]">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Detection Data
            </p>
            <Row label="Classification" value={alert.classification} />
            <Row label="Confidence" value={`${alert.confidence.toFixed(1)}%`} />
            <Row label="Detecting Node" value={alert.nodeId} />
            <Row label="Zone" value={alert.zone} />
            <Row label="Coordinates" value={formatCoords(alert.lat, alert.lng)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-[#1b2620] py-2 first:border-t-0 first:pt-0">
      <span className="text-gray-600">{label}</span>
      <span className="text-gray-300">{value}</span>
    </div>
  );
}
