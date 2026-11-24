import type { Alert } from "./types";

export const FEED_CLEARED_STORAGE_KEY = "forest_monitor_cleared_feed_keys";
export const FEED_CLEARED_EVENT = "forest-feed-cleared";

export function alertFeedKey(alert: Pick<Alert, "id" | "timestamp">): string {
  return `${alert.id}:${alert.timestamp}`;
}

export function parseClearedFeedKeys(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function filterVisibleFeedAlerts<T extends Pick<Alert, "id" | "timestamp">>(
  alerts: T[],
  clearedKeys: ReadonlySet<string>,
): T[] {
  if (clearedKeys.size === 0) return alerts;
  return alerts.filter((alert) => !clearedKeys.has(alertFeedKey(alert)));
}
