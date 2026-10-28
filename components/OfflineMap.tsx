"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapInstance, SymbolLayerSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useAlerts } from "@/context/AlertsContext";
import type { MapInfo } from "@/lib/server/maps.mjs";
import { mapFeatures } from "@/lib/maps/features";
import { offlineStyle } from "@/lib/maps/style";
import CoordinateMap from "./CoordinateMap";
import "maplibre-gl/dist/maplibre-gl.css";

// Keep protocol registration valid across React's development remounts.
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
maplibregl.setWorkerUrl("/maps/maplibre-gl-worker.js");
maplibregl.setWorkerCount(2);

export default function OfflineMap() {
  const router = useRouter();
  const { sensors, alerts } = useAlerts();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const features = useMemo(() => mapFeatures(sensors, alerts), [sensors, alerts]);
  const latest = useRef(features);
  const sensorsRef = useRef(sensors);
  const [info, setInfo] = useState<MapInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => { latest.current = features; sensorsRef.current = sensors; });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/maps", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Unable to read the local map package.");
      setInfo(await response.json());
    }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (error || !info?.available || !info.archiveUrl || !container.current) return;
    let map: MapInstance;
    const archiveUrl = new URL(info.archiveUrl, window.location.origin).href;
    function fit() {
      const nodes = sensorsRef.current;
      if (!nodes.length || !map) return;
      const bounds = new maplibregl.LngLatBounds();
      nodes.forEach((node) => bounds.extend([node.lng, node.lat]));
      map.fitBounds(bounds, { padding: 85, maxZoom: 17, duration: 0 });
    }
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: offlineStyle(archiveUrl, document.documentElement.classList.contains("dark")),
        center: [124.7012, 8.4598], zoom: 16,
        minZoom: info.minZoom ?? 8, maxZoom: 19,
        maxBounds: info.bounds ? [[info.bounds[0], info.bounds[1]], [info.bounds[2], info.bounds[3]]] : undefined,
        maxTileCacheSize: 100, fadeDuration: 0, renderWorldCopies: false,
        localIdeographFontFamily: "sans-serif",
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
      map.on("style.load", () => {
        for (const [id, data] of Object.entries(latest.current)) {
          if (!map.getSource(id)) map.addSource(id, { type: "geojson", data });
        }
        const labels: NonNullable<SymbolLayerSpecification["layout"]> = { "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, -1.4], "text-anchor": "bottom" };
        map.addLayer({ id: "triangle-fill", type: "fill", source: "triangle", paint: { "fill-color": "#71b785", "fill-opacity": 0.1 } });
        map.addLayer({ id: "triangle-line", type: "line", source: "triangle", paint: { "line-color": "#71b785", "line-width": 2, "line-dasharray": [3, 2] } });
        map.addLayer({ id: "uncertainty-fill", type: "fill", source: "areas", paint: { "fill-color": "#e95b47", "fill-opacity": 0.2 } });
        map.addLayer({ id: "uncertainty-line", type: "line", source: "areas", paint: { "line-color": "#e95b47", "line-width": 1.5 } });
        map.addLayer({ id: "sensor-points", type: "circle", source: "nodes", paint: { "circle-radius": 7, "circle-color": ["match", ["get", "status"], "ONLINE", "#62af7b", "DEGRADED", "#e6a52d", "#8b9890"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
        map.addLayer({ id: "sensor-labels", type: "symbol", source: "nodes", layout: { ...labels, "text-field": ["get", "name"], "text-allow-overlap": true }, paint: { "text-color": "#263d2d", "text-halo-color": "#ffffff", "text-halo-width": 2 } });
        map.addLayer({ id: "detection-points", type: "circle", source: "detections", paint: { "circle-radius": 6, "circle-color": "#e95b47", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
        map.addLayer({ id: "detection-labels", type: "symbol", source: "detections", layout: { ...labels, "text-field": ["get", "code"] }, paint: { "text-color": "#932e23", "text-halo-color": "#ffffff", "text-halo-width": 2 } });
        setReady(true);
      });
      map.once("load", fit);
      map.on("click", "detection-points", (event) => { const id = event.features?.[0]?.properties?.id; if (id) router.push(`/incidents/${encodeURIComponent(id)}`); });
      map.on("mouseenter", "detection-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "detection-points", () => { map.getCanvas().style.cursor = ""; });
      map.on("error", (event) => { setError(event.error?.message || "The geographic map could not be rendered."); });
      const observer = new MutationObserver(() => {
        if (mapRef.current) { setReady(false); map.setStyle(offlineStyle(archiveUrl, document.documentElement.classList.contains("dark"))); }
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      const resize = new ResizeObserver(() => map.resize());
      resize.observe(container.current);
      return () => { resize.disconnect(); observer.disconnect(); mapRef.current = null; map.remove(); };
    } catch {
      queueMicrotask(() => setError("This browser could not start the geographic map. The coordinate view is available below."));
    }
  }, [info, router, error]);

  useEffect(() => {
    if (!ready) return;
    for (const [id, data] of Object.entries(features)) {
      const source = mapRef.current?.getSource(id) as GeoJSONSource | undefined;
      if (source) void source.setData(data);
    }
  }, [features, ready]);

  const unavailable = error || (info && !info.available ? info.reason : null);
  const outside = info?.bounds && sensors.some((node) => node.lng < info.bounds![0] || node.lat < info.bounds![1] || node.lng > info.bounds![2] || node.lat > info.bounds![3]);
  return <div className="space-y-3">
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3 text-xs">
        <span className="font-semibold">Geographic detection map</span>
        <button disabled={!ready} onClick={() => { const bounds = new maplibregl.LngLatBounds(); sensors.forEach((node) => bounds.extend([node.lng, node.lat])); if (sensors.length) mapRef.current?.fitBounds(bounds, { padding: 85, maxZoom: 17 }); }} className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-40">Fit sensors</button>
      </div>
      <div ref={container} className={unavailable ? "hidden" : "h-[500px] w-full"} aria-label="Offline geographic map of the sensor area" />
      {!info && !error && <p className="px-4 py-2 text-xs text-[var(--text-muted)]">Reading local map package…</p>}
      {info?.available && !error && <p className="px-4 py-2 text-[10px] text-[var(--text-muted)]">Local basemap · OSM data {info.dataDate?.slice(0, 10)} · {((info.bytes ?? 0) / 1048576).toFixed(1)} MB · Geographic features depend on available mapping data.</p>}
    </div>
    {outside && <p role="status" className="text-xs text-amber-600 dark:text-amber-300">A configured sensor is outside the installed map area. Its coordinates remain visible below.</p>}
    {unavailable && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs"><span>{unavailable}</span><button onClick={() => { setError(null); setInfo(null); setReady(false); setRetry((n) => n + 1); }} className="underline">Retry map</button></div>}
    {(unavailable || outside) && <CoordinateMap />}
  </div>;
}
