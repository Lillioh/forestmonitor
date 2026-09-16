import { INITIAL_SENSOR_NODES, MESH_LINKS } from "@/lib/mock-data";

const POSITIONS: Record<string, { x: number; y: number }> = {
  "NODE-01": { x: 90, y: 100 },
  "NODE-02": { x: 320, y: 40 },
  "NODE-03": { x: 320, y: 170 },
};

export default function MeshTopology() {
  return (
    <div className="rounded-lg border border-[#24332a] bg-[#0f1913] p-4">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        LoRa Mesh Topology <span className="text-gray-600">· Signal Link Quality (RSSI / SNR)</span>
      </p>

      <svg viewBox="0 0 400 210" className="h-[190px] w-full">
        {MESH_LINKS.map((link) => {
          const from = POSITIONS[link.from];
          const to = POSITIONS[link.to];
          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;
          const color =
            link.quality >= 85 ? "#62b66d" : link.quality >= 70 ? "#e5a52d" : "#e46a52";

          return (
            <g key={`${link.from}-${link.to}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={color}
                strokeWidth={Math.max(1, link.quality / 40)}
                opacity={0.75}
              />
              <rect
                x={midX - 20}
                y={midY - 9}
                width={40}
                height={16}
                rx={4}
                fill="#0b120f"
                stroke="#24332a"
              />
              <text
                x={midX}
                y={midY + 3}
                textAnchor="middle"
                fontSize={9}
                fill="#c9d6cd"
                fontFamily="ui-monospace, monospace"
              >
                {link.quality}%
              </text>
            </g>
          );
        })}

        {INITIAL_SENSOR_NODES.map((node) => {
          const p = POSITIONS[node.id];
          return (
            <g key={node.id}>
              <circle cx={p.x} cy={p.y} r={9} fill="#6da875" stroke="#0b120f" strokeWidth={2} />
              <text
                x={p.x}
                y={p.y - 16}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="#e6ede8"
              >
                {node.id}
              </text>
              <text x={p.x} y={p.y + 24} textAnchor="middle" fontSize={9} fill="#829087">
                {node.role}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
