"use client";

import {
  AdvancedMarker,
  APIProvider,
  Map,
  useMap,
} from "@vis.gl/react-google-maps";
import { useAlerts } from "@/context/AlertsContext";
import { useEffect, useMemo } from "react";

function MapBounds() {
  const map = useMap();
  const { alerts, sensors } = useAlerts();

  const locations = useMemo(
    () => [
      ...sensors.map((sensor) => ({
        lat: sensor.lat,
        lng: sensor.lng,
      })),
      ...alerts.map((alert) => ({
        lat: alert.lat,
        lng: alert.lng,
      })),
    ],
    [sensors, alerts]
  );

  useEffect(() => {
    if (!map || locations.length === 0) return;

    const bounds = new google.maps.LatLngBounds();

    locations.forEach((location) => {
      bounds.extend(location);
    });

    map.fitBounds(bounds, 80);
  }, [map, locations]);

  return null;
}

export default function DetectionMap() {
  const { alerts, sensors } = useAlerts();

  return (
    <div className="h-[500px] w-full overflow-hidden rounded-xl">
      <APIProvider
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}
      >
        <Map
          defaultCenter={{
            lat: 8.4542,
            lng: 124.6319,
          }}
          defaultZoom={14}
          mapId="DEMO_MAP_ID"
        >
          <MapBounds />

          {/* Sensor nodes */}
          {sensors.map((sensor) => (
            <AdvancedMarker
              key={sensor.id}
              position={{
                lat: sensor.lat,
                lng: sensor.lng,
              }}
              title={`${sensor.name} — ${sensor.status}`}
            />
          ))}

          {/* Detections */}
          {alerts.map((alert) => (
            <AdvancedMarker
              key={`alert-${alert.id}`}
              position={{
                lat: alert.lat,
                lng: alert.lng,
              }}
              title={`${alert.classification} — ${alert.confidence}% confidence`}
            />
          ))}
        </Map>
      </APIProvider>
    </div>
  );
}