interface SensorCardProps {
  name: string;
  status: string;
}

export default function SensorCard({
  name,
  status,
}: SensorCardProps) {
  const statusColor = status === "ONLINE" ? "var(--status-online)" : "var(--text-muted)";
  return (
    <div
      className="
        rounded-lg border border-[var(--border)]
        bg-[var(--card)] p-3
      "
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text)]">
          {name}
        </span>

        <span
          className="
            flex items-center gap-1.5
            text-[8px]
          "
          style={{
            color: statusColor,
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: statusColor,
            }}
          />

          {status}
        </span>
      </div>
    </div>
  );
}
