export default function MetricBar({
  label,
  value,
  suffix = "%",
  invert = false,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  invert?: boolean;
}) {
  const good = value !== null && (invert ? value < 40 : value >= 60);
  const warn = value !== null && (invert ? value < 70 : value >= 30);

  const color = good
    ? "var(--status-online)"
    : warn
      ? "var(--status-warning)"
      : "#e46a52";

  return (
    <div className="flex items-center gap-2">
      <span
        className="
          w-24 shrink-0
          text-[10px]
          text-[var(--text-muted)]
        "
      >
        {label}
      </span>

      <div
        className="
          h-1.5 flex-1
          overflow-hidden rounded-full
          bg-[var(--border)]
        "
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(100, value ?? 0)}%`,
            backgroundColor: color,
          }}
        />
      </div>

      <span
        className="
          w-12 shrink-0
          text-right text-[10px]
          text-[var(--text)]
        "
      >
        {value === null ? "Not reported" : `${value}${suffix}`}
      </span>
    </div>
  );
}
