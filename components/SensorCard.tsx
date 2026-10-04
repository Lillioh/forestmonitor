interface SensorCardProps {
  name: string;
  signal: number;
  battery: number;
  status: string;
}

export default function SensorCard({
  name,
  signal,
  battery,
  status,
}: SensorCardProps) {
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
            color: "var(--status-online)",
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: "var(--status-online)",
            }}
          />

          {status}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        <Metric
          label="Signal"
          value={signal}
        />

        <Metric
          label="Batt."
          value={battery}
        />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-[8px] text-[var(--text-muted)]">
        {label}
      </span>

      {/* Progress Track */}
      <div
        className="
          h-1 flex-1 overflow-hidden rounded-full
          bg-[var(--border)]
        "
      >
        {/* Progress */}
        <div
          className="h-full rounded-full"
          style={{
            width: `${value}%`,
            backgroundColor: "var(--status-online)",
          }}
        />
      </div>

      <span
        className="
          w-7 text-right text-[8px]
          text-[var(--text-muted)]
        "
      >
        {value}%
      </span>
    </div>
  );
}