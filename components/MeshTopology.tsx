import { MESH_LINKS } from "@/lib/mock-data";
import { useAlerts } from "@/context/AlertsContext";

const POSITIONS: Record<string, { x: number; y: number }> = {
  "NODE-01": { x: 90, y: 100 },
  "NODE-02": { x: 320, y: 40 },
  "NODE-03": { x: 320, y: 170 },
};

export default function MeshTopology() {
  const { sensors } = useAlerts();
  return (
    <div
      className="
        rounded-lg
        border border-[var(--border)]
        bg-[var(--card)]
        p-4
      "
    >
      <p
        className="
          mb-2 text-[10px] font-semibold
          uppercase tracking-wider
          text-[var(--text-muted)]
        "
      >
        LoRa Mesh Topology{" "}
        <span className="text-[var(--text-muted)]">
          · Configured links — live link telemetry not connected
        </span>
      </p>

      <svg
        viewBox="0 0 400 210"
        className="h-[190px] w-full"
      >
        {MESH_LINKS.map((link) => {
          const from = POSITIONS[link.from];
          const to = POSITIONS[link.to];

          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;

          const color = "var(--text-muted)";

          return (
            <g key={`${link.from}-${link.to}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={color}
                strokeWidth={2}
                opacity={0.75}
              />

              <rect
                x={midX - 20}
                y={midY - 9}
                width={40}
                height={16}
                rx={4}
                fill="var(--background)"
                stroke="var(--border)"
              />

              <text
                x={midX}
                y={midY + 3}
                textAnchor="middle"
                fontSize={9}
                fill="var(--text)"
                fontFamily="ui-monospace, monospace"
              >
                —
              </text>
            </g>
          );
        })}

        {sensors.map((node) => {
          const p = POSITIONS[node.id];

          return (
            <g key={node.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r={9}
                fill={node.status === "ONLINE" ? "var(--status-online)" : "var(--text-muted)"}
                stroke="var(--background)"
                strokeWidth={2}
              />

              <text
                x={p.x}
                y={p.y - 16}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="var(--text)"
              >
                {node.id}
              </text>

              <text
                x={p.x}
                y={p.y + 24}
                textAnchor="middle"
                fontSize={9}
                fill="var(--text-muted)"
              >
                {node.role}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
