import { layers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";

export function offlineStyle(archiveUrl: string, dark: boolean): StyleSpecification {
  const flavor = dark ? "dark" : "light";
  return {
    version: 8,
    glyphs: `${window.location.origin}/maps/glyphs/{fontstack}/{range}.pbf`,
    sprite: `${window.location.origin}/maps/sprites/${flavor}`,
    sources: { basemap: { type: "vector", url: `pmtiles://${archiveUrl}`, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank" rel="noopener noreferrer">Protomaps</a>' } },
    layers: layers("basemap", namedFlavor(flavor), { lang: "en" }) as StyleSpecification["layers"],
  };
}
