export default function MetricBar({
  label,
  value,
  suffix = "%",
  invert = false,
}: {
  label: string;
  value: number;
  suffix?: string;
  invert?: boolean;
}) {
  const good = invert ? value < 40 : value >= 60;
  const warn = invert ? value < 70 : value >= 30;
  const color = good ? "bg-[#62b66d]" : warn ? "bg-[#e5a52d]" : "bg-[#e46a52]";

  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-[10px] text-gray-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#253229]">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right text-[10px] text-gray-300">
        {value}
        {suffix}
      </span>
    </div>
  );
}
