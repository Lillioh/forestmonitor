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
    <div className="rounded-lg border border-[#24332a] bg-[#101a14] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{name}</span>

        <span className="flex items-center gap-1.5 text-[8px] text-[#75b878]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#75b878]" />
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
      <span className="w-10 text-[8px] text-gray-500">
        {label}
      </span>

      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#253229]">
        <div
          className="h-full rounded-full bg-[#62b66d]"
          style={{
            width: `${value}%`,
          }}
        />
      </div>

      <span className="w-7 text-right text-[8px] text-gray-400">
        {value}%
      </span>
    </div>
  );
}