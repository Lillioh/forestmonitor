"use client";

import Link from "next/link";
import { useAlerts } from "@/context/AlertsContext";
import { formatCoords } from "@/lib/format";

// A local coordinate plot: no downloaded scripts, map tiles, or API keys.
// It is explicitly not a geographic basemap or a navigation map.
export default function CoordinateMap() {
  const { sensors, alerts } = useAlerts();
  const active = alerts.filter((a) => a.status === "NEW" || a.status === "DISPATCHED");
  const points = [...sensors, ...active];
  const meanLat = sensors.reduce((sum, n) => sum + n.lat, 0) / Math.max(1, sensors.length);
  const meanLng = sensors.reduce((sum, n) => sum + n.lng, 0) / Math.max(1, sensors.length);
  const metersLng = 111320 * Math.cos(meanLat * Math.PI / 180);
  const toMeters = (p: { lat: number; lng: number }) => ({ x: (p.lng - meanLng) * metersLng, y: (meanLat - p.lat) * 111320 });
  const projected = points.map(toMeters);
  const extent = Math.max(120, ...projected.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)])) + 45;
  const scale = 200 / extent;
  const project = (p: { lat: number; lng: number }) => { const m = toMeters(p); return { x: 360 + m.x * scale, y: 250 + m.y * scale }; };
  const sensorPoints = sensors.map(project);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <span className="text-xs font-semibold text-[var(--text)]">Local detection area</span>
        <span className="text-[10px] text-[var(--text-muted)]">Offline coordinate view · North up · No basemap</span>
      </div>
      <svg viewBox="0 0 720 500" role="img" aria-labelledby="local-map-title local-map-description" className="max-h-[500px] w-full bg-[var(--panel)]">
        <title id="local-map-title">Sensor positions and active acoustic detections</title>
        <desc id="local-map-description">A locally rendered coordinate plot with three sensor nodes, their detection triangle, and active incidents. Terrain and roads are not shown.</desc>
        <defs><pattern id="local-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="1" /></pattern></defs>
        <rect width="720" height="500" fill="url(#local-grid)" />
        <polygon points={sensorPoints.map((p) => `${p.x},${p.y}`).join(" ")} fill="var(--status-online)" fillOpacity="0.08" stroke="var(--status-online)" strokeDasharray="6 5" strokeWidth="2" />
        <g fill="var(--text-muted)" fontSize="12"><text x="670" y="35">N ↑</text><text x="20" y="475">{Math.round(80 / scale)} m</text><path d="M 20 455 v 6 h 80 v -6" fill="none" stroke="var(--text-muted)" strokeWidth="2" /></g>
        {sensors.map((sensor) => {
          const p = project(sensor);
          const color = sensor.status === "ONLINE" ? "var(--status-online)" : sensor.status === "DEGRADED" ? "var(--status-warning)" : "var(--text-muted)";
          return <g key={sensor.id}><title>{sensor.name}: {sensor.status} · {formatCoords(sensor.lat, sensor.lng)}</title><circle cx={p.x} cy={p.y} r="8" fill={color} stroke="var(--card)" strokeWidth="3" /><text x={p.x} y={p.y - 17} textAnchor="middle" fill="var(--text)" fontSize="12" fontWeight="600">{sensor.name}</text><text x={p.x} y={p.y + 24} textAnchor="middle" fill="var(--text-muted)" fontSize="10">{sensor.status}</text></g>;
        })}
        {active.map((alert) => {
          const p = project(alert);
          return <a key={alert.id} href={`/incidents/${alert.id}`} aria-label={`Open ${alert.code}: ${alert.classification}`}><title>{alert.code} · {alert.classification} · {alert.confidence}% confidence{alert.locationBasis ? " · Reporting node position" : ""}{alert.source === "SIMULATION" ? " · SIMULATED" : ""}</title>{alert.radiusM !== null && <circle cx={p.x} cy={p.y} r={Math.max(5, alert.radiusM * scale)} fill="#e95b47" fillOpacity="0.15" stroke="#e95b47" />}<circle cx={p.x} cy={p.y} r="5" fill="#e95b47" /><text x={p.x + 9} y={p.y - 8} fill="var(--text)" fontSize="10">#{alert.id}</text></a>;
        })}
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[10px] text-[var(--text-muted)]"><span>{active.length} active detections · {sensors.length} configured sensors</span><Link href="/alerts" className="text-[var(--accent)] hover:underline">Open alert log</Link></div>
    </div>
  );
}
