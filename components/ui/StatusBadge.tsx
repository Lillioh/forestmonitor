import type { AlertStatus } from "@/lib/types";

const STYLES: Record<AlertStatus, string> = {
  NEW: "bg-[#e95b47]/15 text-[#e95b47] border-[#e95b47]/40",
  DISPATCHED: "bg-[#e7a52c]/15 text-[#e7a52c] border-[#e7a52c]/40",
  RESOLVED: "bg-[#65a96d]/15 text-[#65a96d] border-[#65a96d]/40",
  FALSE_POSITIVE: "bg-gray-500/10 text-gray-500 border-gray-600/40",
};

const LABELS: Record<AlertStatus, string> = {
  NEW: "NEW PING",
  DISPATCHED: "DISPATCHED",
  RESOLVED: "RESOLVED",
  FALSE_POSITIVE: "FALSE POSITIVE",
};

export default function StatusBadge({ status }: { status: AlertStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-[9px] font-bold ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
