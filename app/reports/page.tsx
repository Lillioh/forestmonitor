"use client";

import { useMemo } from "react";
import { useAlerts } from "@/context/AlertsContext";

export default function ReportsPage() {
  const { alerts, teams } = useAlerts();

  const stats = useMemo(() => {
    const total = alerts.length;
    const dispatched = alerts.filter((a) => a.status !== "NEW").length;
    const responded = alerts.filter((a) => a.responseMinutes !== null);
    const avgResponse = responded.length > 0
      ? responded.reduce((s, a) => s + (a.responseMinutes ?? 0), 0) / responded.length
      : null;
    const falsePositives = alerts.filter((a) => a.status === "FALSE_POSITIVE").length;
    const falsePositiveRate = total > 0 ? (falsePositives / total) * 100 : null;

    const zoneCounts = new Map<string, number>();
    for (const a of alerts) zoneCounts.set(a.zone, (zoneCounts.get(a.zone) ?? 0) + 1);
    const zones = [...zoneCounts.entries()].sort((a, b) => b[1] - a[1]);

    const hourBuckets = new Array(24).fill(0);
    for (const a of alerts) {
      const hour = new Date(a.timestamp).getHours();
      hourBuckets[hour] += 1;
    }

    const teamPerf = teams.map((team) => {
      const teamAlerts = alerts.filter(
        (a) => a.assignedTeamId === team.id && a.responseMinutes !== null
      );
      const avg =
        teamAlerts.length > 0
          ? teamAlerts.reduce((s, a) => s + (a.responseMinutes ?? 0), 0) / teamAlerts.length
          : null;
      return { team, avg, count: teamAlerts.length };
    });

    return { total, dispatched, avgResponse, falsePositiveRate, zones, hourBuckets, teamPerf };
  }, [alerts, teams]);

  const maxZoneCount = stats.zones[0]?.[1] ?? 1;
  const maxHour = Math.max(1, ...stats.hourBuckets);
  const maxTeamAvg = Math.max(1, ...stats.teamPerf.map((t) => t.avg ?? 0));

  return (
    <div className="space-y-5 p-5">
      <div>
        <p className="text-xs font-semibold tracking-wider text-gray-400">REPORTS</p>
        <p className="text-[10px] text-gray-600">Forest Activity Analytics · Last 30 Days</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total Detections" value={stats.total} />
        <KpiCard label="Total Dispatches" value={stats.dispatched} />
        <KpiCard label="Avg Response Time" value={stats.avgResponse !== null ? `${stats.avgResponse.toFixed(1)} min` : "—"} />
        <KpiCard label="False Positive Rate" value={stats.falsePositiveRate !== null ? `${stats.falsePositiveRate.toFixed(1)}%` : "—"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Top Detection Zones">
          {stats.zones.length === 0 ? (
            <p className="text-[10px] text-gray-600">No detections yet this session.</p>
          ) : (
            <div className="space-y-3">
              {stats.zones.map(([zone, count]) => (
                <div key={zone}>
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="text-gray-300">{zone}</span>
                    <span className="text-gray-500">{count} detections</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#253229]">
                    <div
                      className="h-full rounded-full bg-[#e6a52d]"
                      style={{ width: `${(count / maxZoneCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Response Performance">
          <div className="space-y-3">
            {stats.teamPerf.map(({ team, avg, count }) => (
              <div key={team.id}>
                <div className="mb-1 flex items-center justify-between text-[10px]">
                  <span className="text-gray-300">
                    {team.name} <span className="text-gray-600">({team.shortCode})</span>
                  </span>
                  <span className="text-gray-500">
                    {avg !== null ? `${avg.toFixed(1)} min` : "No data"}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#253229]">
                  <div
                    className="h-full rounded-full bg-[#62b66d]"
                    style={{ width: avg !== null ? `${(avg / maxTeamAvg) * 100}%` : "0%" }}
                  />
                </div>
                <p className="mt-0.5 text-[9px] text-gray-600">{count} resolved incidents</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Hourly Detection Heatmap">
        <div className="grid grid-cols-12 gap-1 sm:grid-cols-24">
          {stats.hourBuckets.map((count, hour) => {
            const intensity = count / maxHour;
            return (
              <div key={hour} className="flex flex-col items-center gap-1">
                <div
                  title={`${hour}:00 — ${count} detections`}
                  className="h-8 w-full rounded-sm"
                  style={{
                    backgroundColor: `rgba(230, 165, 45, ${0.12 + intensity * 0.75})`,
                  }}
                />
                <span className="text-[8px] text-gray-600">{hour}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[9px] text-gray-600">Hour of day (PHT) · darker = more detections</p>
      </Panel>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[#24332a] bg-[#101a14] p-4">
      <p className="text-[9px] uppercase tracking-wider text-gray-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-100">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#24332a] bg-[#101a14] p-4">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </p>
      {children}
    </div>
  );
}
