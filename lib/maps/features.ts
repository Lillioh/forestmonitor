import type { FeatureCollection, Point, Polygon } from "geojson";
import type { Alert, SensorNode } from "@/lib/types";

export function mapFeatures(sensors: SensorNode[], alerts: Alert[]) {
  const active = alerts.filter((alert) => alert.status === "NEW" || alert.status === "DISPATCHED");
  const nodes: FeatureCollection<Point> = { type: "FeatureCollection", features: sensors.map((sensor) => ({ type: "Feature", geometry: { type: "Point", coordinates: [sensor.lng, sensor.lat] }, properties: { id: sensor.id, name: sensor.name, status: sensor.status } })) };
  const detections: FeatureCollection<Point> = { type: "FeatureCollection", features: active.map((alert) => ({ type: "Feature", geometry: { type: "Point", coordinates: [alert.lng, alert.lat] }, properties: { id: alert.id, code: alert.code, simulated: alert.source === "SIMULATION" } })) };
  const areas: FeatureCollection<Polygon> = { type: "FeatureCollection", features: active.map((alert) => {
    const lat = alert.lat * Math.PI / 180;
    const coordinates = Array.from({ length: 49 }, (_, i) => {
      const angle = i / 48 * Math.PI * 2;
      return [alert.lng + Math.cos(angle) * alert.radiusM / (111320 * Math.cos(lat)), alert.lat + Math.sin(angle) * alert.radiusM / 111320];
    });
    return { type: "Feature", properties: { id: alert.id }, geometry: { type: "Polygon", coordinates: [coordinates] } };
  }) };
  const coordinates = sensors.map((sensor) => [sensor.lng, sensor.lat]);
  const triangle: FeatureCollection<Polygon> = { type: "FeatureCollection", features: sensors.length === 3 ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...coordinates, coordinates[0]]] } }] : [] };
  return { nodes, detections, areas, triangle };
}
