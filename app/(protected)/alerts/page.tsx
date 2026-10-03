"use client";

import StatusBadge from "@/components/ui/StatusBadge";
import { useAlerts } from "@/context/AlertsContext";
import { alertsToCsv, downloadTextFile, formatCoords, formatRelativeTime } from "@/lib/format";
import type { AlertStatus } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

const PAGE_SIZE = 8;
const STATUS_FILTERS: Array<{ value: AlertStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All Alerts" },
  { value: "NEW", label: "New Ping" },
  { value: "DISPATCHED", label: "Dispatched" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "FALSE_POSITIVE", label: "False Positive" },
];

export default function AlertLogPage() {
  const { alerts, dispatchAlert } = useAlerts();
  const now = useNow();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return alerts.filter((a) => {
      const matchesStatus = statusFilter === "ALL" || a.status === statusFilter;
      const matchesSearch =
        q.length === 0 ||
        a.code.toLowerCase().includes(q) ||
        a.classification.toLowerCase().includes(q) ||
        formatCoords(a.lat, a.lng).toLowerCase().includes(q) ||
        a.zone.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [alerts, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const totalAlerts = alerts.length;
  const avgConfidence =
    totalAlerts > 0 ? alerts.reduce((s, a) => s + a.confidence, 0) / totalAlerts : null;
  const respondedAlerts = alerts.filter((a) => a.responseMinutes !== null);
  const avgResponse =
    respondedAlerts.length > 0
      ? respondedAlerts.reduce((s, a) => s + (a.responseMinutes ?? 0), 0) / respondedAlerts.length
      : null;
  const resolvedCount = alerts.filter((a) => a.status === "RESOLVED").length;
  const resolutionRate = totalAlerts > 0 ? (resolvedCount / totalAlerts) * 100 : null;

  function handleExport() {
    const rows = filtered.map((a) => ({
      id: a.code,
      time: new Date(a.timestamp).toISOString(),
      lat: a.lat,
      lng: a.lng,
      classification: a.classification,
      confidence: a.confidence,
      radius_m: a.radiusM,
      status: a.status,
      zone: a.zone,
      node: a.nodeId,
    }));
    downloadTextFile("incident-log-export.csv", alertsToCsv(rows), "text/csv");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-5 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-1 min-w-[220px] items-center gap-2 rounded-md border border-[#24332a] bg-[#101a14] px-3 py-2">
            <Search size={13} className="text-gray-600" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search coordinates, IDs, categories..."
              className="w-full bg-transparent text-[11px] text-gray-200 placeholder:text-gray-600 focus:outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as AlertStatus | "ALL");
              setPage(1);
            }}
            className="rounded-md border border-[#24332a] bg-[#101a14] px-3 py-2 text-[11px] text-gray-300 focus:outline-none"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                Status: {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-hidden rounded-lg border border-[#24332a] bg-[#0f1913]">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-gray-600">
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Est. Coordinates</th>
                <th className="px-3 py-2 font-medium">Classification</th>
                <th className="px-3 py-2 font-medium">Conf.</th>
                <th className="px-3 py-2 font-medium">Radius</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((alert) => (
                <tr key={alert.id} className="border-t border-[#1b2620]">
                  <td className="px-3 py-2 font-mono text-gray-400">#{alert.id}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-400">
                    {formatRelativeTime(alert.timestamp, now)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-300">
                    {formatCoords(alert.lat, alert.lng)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-300">
                    {alert.classification}
                  </td>
                  <td className="px-3 py-2 text-gray-300">{alert.confidence.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-gray-500">±{alert.radiusM}m</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={alert.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {alert.status === "NEW" ? (
                      <button
                        onClick={() => dispatchAlert(alert.id)}
                        className="rounded bg-[#e6a52d] px-2 py-1 text-[9px] font-bold text-black hover:bg-[#f0b63c]"
                      >
                        Dispatch
                      </button>
                    ) : (
                      <Link
                        href={`/incidents/${alert.id}`}
                        className="rounded border border-[#26352b] px-2 py-1 text-[9px] text-gray-400 hover:bg-[#19251e]"
                      >
                        View Details
                      </Link>
                    )}
                  </td>
                </tr>
              ))}

              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-gray-600">
                    No alerts match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-[10px] text-gray-500">
          <span>
            Showing {filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–
            {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} events
          </span>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded border border-[#24332a] px-2 py-1 disabled:opacity-30"
            >
              Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={`rounded px-2 py-1 ${
                  n === currentPage
                    ? "bg-[#e6a52d] font-bold text-black"
                    : "border border-[#24332a] text-gray-400"
                }`}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded border border-[#24332a] px-2 py-1 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <aside className="w-full shrink-0 space-y-3 lg:w-64">
        <div className="rounded-lg border border-[#24332a] bg-[#101a14] p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Summary Metrics
          </p>
          <div className="space-y-3">
            <Stat label="Total Alerts Logged" value={totalAlerts} />
            <Stat label="Avg CNN Confidence" value={avgConfidence !== null ? `${avgConfidence.toFixed(1)}%` : "—"} />
            <Stat label="Avg Response Time" value={avgResponse !== null ? `${avgResponse.toFixed(1)}m` : "—"} />
            <Stat label="Resolution Rate" value={resolutionRate !== null ? `${resolutionRate.toFixed(0)}%` : "—"} />
          </div>
        </div>

        <div className="rounded-lg border border-[#24332a] bg-[#101a14] p-4">
          <p className="mb-2 text-[11px] font-semibold text-gray-200">Need a physical copy?</p>
          <p className="mb-3 text-[10px] text-gray-500">
            Generate and export official DENR/ENRO incident reports with acoustic telemetry logs.
          </p>
          <button
            onClick={handleExport}
            className="w-full rounded bg-[#e6a52d] py-2 text-[10px] font-bold text-black hover:bg-[#f0b63c]"
          >
            Export Incident Logs
          </button>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-gray-600">{label}</p>
      <p className="text-lg font-semibold text-gray-100">{value}</p>
    </div>
  );
}
