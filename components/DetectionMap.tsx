"use client";

import {
  AdvancedMarker,
  APIProvider,
  Circle,
  Map,
  Polygon,
  useMap,
} from "@vis.gl/react-google-maps";
import { useAlerts } from "@/context/AlertsContext";
import { useEffect, useMemo } from "react";

const TDOA_POINTS = [
  {
    id: "A",
    lat: 8.460140,
    lng: 124.700302,
    label: "ESP32 Sensor A",
  },
  {
    id: "B",
    lat: 8.458825,
    lng: 124.701397,
    label: "ESP32 Sensor B",
  },
  {
    id: "C",
    lat: 8.460395,
    lng: 124.701965,
    label: "ESP32 Sensor C",
  },
];

function MapBounds() {
  const map = useMap();
  const { alerts } = useAlerts();

  const activeAlerts = useMemo(
    () =>
      alerts.filter(
        (alert) =>
          alert.status !== "RESOLVED" &&
          alert.status !== "FALSE_POSITIVE"
      ),
    [alerts]
  );

  const locations = useMemo(
    () => [
      ...TDOA_POINTS.map((point) => ({
        lat: point.lat,
        lng: point.lng,
      })),
      ...activeAlerts.map((alert) => ({
        lat: alert.lat,
        lng: alert.lng,
      })),
    ],
    [activeAlerts]
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
  const { alerts } = useAlerts();

  const activeAlerts = useMemo(
    () =>
      alerts.filter(
        (alert) =>
          alert.status !== "RESOLVED" &&
          alert.status !== "FALSE_POSITIVE"
      ),
    [alerts]
  );

  return (
    <div className="h-[500px] w-full overflow-hidden rounded-xl">
      <APIProvider
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}
      >
        <Map
          defaultCenter={{
            lat: 8.4598,
            lng: 124.7012,
          }}
          defaultZoom={16}
          mapId="DEMO_MAP_ID"
        >
          <MapBounds />

          {/* TDoA triangulation area */}
          <Polygon
            paths={TDOA_POINTS.map((point) => ({
              lat: point.lat,
              lng: point.lng,
            }))}
            fillOpacity={0.12}
            strokeOpacity={0.8}
            strokeWeight={2}
          />

          {/* Simulated ESP32 sensor positions */}
          {TDOA_POINTS.map((point) => (
            <AdvancedMarker
              key={point.id}
              position={{
                lat: point.lat,
                lng: point.lng,
              }}
              title={point.label}
            />
          ))}

          {/* Active detections only */}
          {activeAlerts.map((alert) => (
            <div key={`detection-${alert.id}`}>
              <Circle
                center={{
                  lat: alert.lat,
                  lng: alert.lng,
                }}
                radius={alert.radiusM}
                fillOpacity={0.12}
                strokeOpacity={0.7}
                strokeWeight={2}
              />

              <AdvancedMarker
                position={{
                  lat: alert.lat,
                  lng: alert.lng,
                }}
                title={`${alert.classification} — ${alert.confidence}% confidence`}
              />
            </div>
          ))}
        </Map>
      </APIProvider>
    </div>
  );
}