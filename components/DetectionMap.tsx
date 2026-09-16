"use client";

import { AdvancedMarker, APIProvider, Map } from "@vis.gl/react-google-maps";

const detections = [
  {
    id: 1,
    lat: 8.460140,
    lng: 124.700302,
    label: "Chainsaw Detection",
  },
  {
    id: 2,
    lat: 8.458825,
    lng: 124.701397,
    label: "Possible Illegal Logging",
  },
  {
    id: 3,
    lat: 8.460395,
    lng: 124.701965,
    label: "Possible Illegal Logging",
  },
];

// Default map location
const DEFAULT_CENTER = {
  lat: 8.459787,
  lng: 124.701221,
};

export default function DetectionMap() {
  return (
    <div className="h-[500px] w-full overflow-hidden rounded-xl">
      <APIProvider
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}
      >
        <Map
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={15}
          mapId="DEMO_MAP_ID"
        >
          {detections.map((detection) => (
            <AdvancedMarker
              key={detection.id}
              position={{
                lat: detection.lat,
                lng: detection.lng,
              }}
              title={detection.label}
            />
          ))}
        </Map>
      </APIProvider>
    </div>
  );
}