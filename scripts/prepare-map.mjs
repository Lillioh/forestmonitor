import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { extractRegion } from "../lib/maps/archive-builder.mjs";

try {
  const { values } = parseArgs({ options: { source: { type: "string" }, bounds: { type: "string", default: "124.45,8.25,124.95,8.6" }, output: { type: "string" }, "max-zoom": { type: "string", default: "15" } } });
  if (!values.source) throw new Error("Supply --source https://build.protomaps.com/YYYYMMDD.pmtiles from the official build index.");
  const result = await extractRegion({ source: values.source, bounds: values.bounds.split(",").map(Number), destination: resolve(values.output || process.env.FOREST_MAP_ARCHIVE || "public/maps/mapawa_malasag.pmtiles"), maxZoom: Number(values["max-zoom"]) });
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
