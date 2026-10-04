import type { AlertStatus } from "@/lib/types";

const STYLES: Record<AlertStatus, React.CSSProperties> = {
  NEW: {
    backgroundColor: "color-mix(in srgb, #e95b47 15%, transparent)",
    color: "#e95b47",
    borderColor: "color-mix(in srgb, #e95b47 40%, transparent)",
  },

  DISPATCHED: {
    backgroundColor: "color-mix(in srgb, var(--accent) 15%, transparent)",
    color: "var(--accent)",
    borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
  },

  RESOLVED: {
    backgroundColor: "color-mix(in srgb, var(--status-online) 15%, transparent)",
    color: "var(--status-online)",
    borderColor: "color-mix(in srgb, var(--status-online) 40%, transparent)",
  },

  FALSE_POSITIVE: {
    backgroundColor: "color-mix(in srgb, var(--text-muted) 10%, transparent)",
    color: "var(--text-muted)",
    borderColor: "color-mix(in srgb, var(--text-muted) 40%, transparent)",
  },
};

const LABELS: Record<AlertStatus, string> = {
  NEW: "NEW PING",
  DISPATCHED: "DISPATCHED",
  RESOLVED: "RESOLVED",
  FALSE_POSITIVE: "FALSE POSITIVE",
};

export default function StatusBadge({
  status,
}: {
  status: AlertStatus;
}) {
  return (
    <span
      className="
        inline-block whitespace-nowrap
        rounded border
        px-2 py-0.5
        text-[9px] font-bold
      "
      style={STYLES[status]}
    >
      {LABELS[status]}
    </span>
  );
}