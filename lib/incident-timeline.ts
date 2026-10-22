import type { Alert } from "./types";

type TimelineRecord = Pick<Alert, "timestamp" | "dispatchedAt" | "resolvedAt" | "status" | "source">;

export function recordedIncidentTimeline(alert: TimelineRecord) {
  const events: { label: string; timestamp: number }[] = [];
  if (Number.isFinite(alert.timestamp)) events.push({ label: alert.source === "SIMULATION" ? "Simulated detection recorded" : "Detection recorded", timestamp: alert.timestamp });
  if (typeof alert.dispatchedAt === "number" && Number.isFinite(alert.dispatchedAt)) events.push({ label: "Dispatch recorded", timestamp: alert.dispatchedAt });
  if (typeof alert.resolvedAt === "number" && Number.isFinite(alert.resolvedAt) && ["RESOLVED", "FALSE_POSITIVE"].includes(alert.status)) events.push({ label: alert.status === "FALSE_POSITIVE" ? "Marked false positive" : "Marked resolved", timestamp: alert.resolvedAt });
  return events.sort((a, b) => a.timestamp - b.timestamp);
}
