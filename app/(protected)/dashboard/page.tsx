"use client";

import DetectionMap from "@/components/DetectionMap";
import IncidentFeed from "@/components/IncidentFeed";
import SensorCard from "@/components/SensorCard";
import { useAlerts } from "@/context/AlertsContext";

export default function Home() {
  const { sensors } = useAlerts();

  return (
    <div className="flex min-h-full lg:h-full bg-[var(--background)]">

      {/* Main Dashboard Area */}
      <div className="flex min-w-0 flex-1 flex-col px-5 pt-3 pb-4 lg:overflow-y-auto">

        {/* Detection Map Title */}
        <div className="mb-2">
          <p className="text-xs font-semibold tracking-wider text-[var(--text-muted)]">
            DETECTION MAP
          </p>
        </div>

        {/* Detection Map */}
        <div className="shrink-0">
          <DetectionMap />
        </div>

        {/* Sensor Cards */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {sensors.map((sensor) => (
            <SensorCard
              key={sensor.id}
              name={sensor.name}
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