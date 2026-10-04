"use client";

import DetectionMap from "@/components/DetectionMap";
import IncidentFeed from "@/components/IncidentFeed";
import SensorCard from "@/components/SensorCard";
import { useAlerts } from "@/context/AlertsContext";

export default function Home() {
  const { sensors } = useAlerts();

  return (
    <div className="flex min-h-0 flex-1 bg-[var(--background)]">

      {/* Main Dashboard Area */}
      <div className="flex min-w-0 flex-1 flex-col p-5">

        {/* Detection Map Title */}
        <div className="mb-3">
          <p className="text-xs font-semibold tracking-wider text-[var(--text-muted)]">
            DETECTION MAP
          </p>
        </div>

        {/* Detection Map */}
        <div className="min-h-0 flex-1">
          <DetectionMap />
        </div>

        {/* Sensor Cards */}
        <div className="mt-4 grid grid-cols-3 gap-4">
          {sensors.map((sensor) => (
            <SensorCard
              key={sensor.id}
              name={sensor.name}
              signal={sensor.signal}
              battery={sensor.battery}
              status={sensor.status}
            />
          ))}
        </div>
      </div>

      {/* Incident Feed */}
      <IncidentFeed />

    </div>
  );
}