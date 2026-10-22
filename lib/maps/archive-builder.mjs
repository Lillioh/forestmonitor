import { PMTiles, zxyToTileId } from "pmtiles";
import { gzipSync } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

// A bounded regional PMTiles v3 writer. It deliberately cannot download a planet.
// Format: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
function varint(value) {
  const bytes = [];
  do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
  return bytes;
}

export function createRegionalArchive(tiles, metadata, bounds, minZoom, maxZoom) {
  const sorted = [...tiles].sort((a, b) => a.id - b.id);
  if (!sorted.length || sorted.length > 4096) throw new Error("A regional archive must contain 1–4096 tiles.");
  const contents = [];
  const known = new Map();
  const entries = [];
  let size = 0;
  for (const tile of sorted) {
    const bytes = Buffer.from(tile.data);
    const hash = createHash("sha256").update(bytes).digest("hex");
    let offset = known.get(hash);
    if (offset === undefined) { offset = size; known.set(hash, offset); contents.push(bytes); size += bytes.length; }
    entries.push({ id: tile.id, length: bytes.length, offset });
  }
  const directory = [...varint(entries.length)];
  let lastId = 0;
  for (const entry of entries) { directory.push(...varint(entry.id - lastId)); lastId = entry.id; }
  for (let i = 0; i < entries.length; i++) directory.push(...varint(1));
  for (const entry of entries) directory.push(...varint(entry.length));
  for (let i = 0; i < entries.length; i++) directory.push(...varint(i && entries[i].offset === entries[i - 1].offset + entries[i - 1].length ? 0 : entries[i].offset + 1));
  const root = gzipSync(Buffer.from(directory));
  if (root.length > 16257) throw new Error("Region index is too large. Select a smaller area.");
  const json = gzipSync(Buffer.from(JSON.stringify(metadata)));
  const header = Buffer.alloc(127);
  header.write("PMTiles", 0, "ascii"); header[7] = 3;
  const values = [127, root.length, 127 + root.length, json.length, 127 + root.length + json.length, 0, 127 + root.length + json.length, size, entries.length, entries.length, contents.length];
  values.forEach((value, i) => header.writeBigUInt64LE(BigInt(value), 8 + i * 8));
  header[96] = 0; header[97] = 2; header[98] = 2; header[99] = 1;
  header[100] = minZoom; header[101] = maxZoom;
  bounds.forEach((value, i) => header.writeInt32LE(Math.round(value * 1e7), 102 + i * 4));
  header[118] = Math.min(15, maxZoom);
  header.writeInt32LE(Math.round((bounds[0] + bounds[2]) / 2 * 1e7), 119);
  header.writeInt32LE(Math.round((bounds[1] + bounds[3]) / 2 * 1e7), 123);
  return Buffer.concat([header, root, json, ...contents]);
}

export async function extractRegion({ source, destination, bounds, minZoom = 8, maxZoom = 15, fetchImpl = fetch, onProgress = () => {} }) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3] || bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -85 || bounds[3] > 85) throw new Error("Invalid west,south,east,north bounds.");
  if (minZoom < 0 || maxZoom > 15 || minZoom > maxZoom || !Number.isInteger(minZoom) || !Number.isInteger(maxZoom)) throw new Error("Use integer zoom levels between 0 and 15.");
  const url = new URL(source);
  if (url.protocol !== "https:") throw new Error("Use a trusted HTTPS map source.");
  const archive = new PMTiles({
    getKey: () => source,
    async getBytes(offset, length, signal) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 4 * 1024 * 1024) throw new Error("Source map range exceeds the 4 MB read budget.");
      const response = await fetchImpl(source, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal: signal || AbortSignal.timeout(30000) });
      if (response.status !== 206) throw new Error(`The map source must support byte ranges (received ${response.status}).`);
      const data = await response.arrayBuffer();
      if (data.byteLength > length) throw new Error("Map server ignored the requested byte range.");
      return { data, etag: response.headers.get("etag") || undefined };
    },
  });
  const header = await archive.getHeader();
  if (header.specVersion !== 3 || header.tileType !== 1 || header.tileCompression !== 2) throw new Error("Expected PMTiles v3 with gzip-compressed MVT tiles.");
  if (maxZoom > header.maxZoom || minZoom < header.minZoom) throw new Error("The source does not cover the requested zoom range.");
  const tiles = [];
  const jobs = [];
  const longitude = (value, z) => Math.floor((value + 180) / 360 * 2 ** z);
  const latitude = (value, z) => { const radians = value * Math.PI / 180; return Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** z); };
  for (let z = minZoom; z <= maxZoom; z++) {
    for (let x = longitude(bounds[0], z); x <= Math.min(2 ** z - 1, longitude(bounds[2], z)); x++) {
      for (let y = latitude(bounds[3], z); y <= latitude(bounds[1], z); y++) {
        if (jobs.length >= 4096) throw new Error("Area exceeds the 4096-tile regional limit. Reduce bounds or zoom.");
        jobs.push({ z, x, y });
      }
    }
  }
  let next = 0; let downloaded = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < jobs.length) {
      const { z, x, y } = jobs[next++];
      // getZxy returns decompressed bytes; re-encode consistently for the writer.
      const tile = await archive.getZxy(z, x, y);
      if (tile) {
        const compressed = gzipSync(Buffer.from(tile.data));
        downloaded += compressed.length;
        if (downloaded > 256 * 1024 * 1024) throw new Error("Region exceeds the 256 MB map budget.");
        tiles.push({ id: zxyToTileId(z, x, y), data: compressed });
      }
      onProgress(tiles.length, jobs.length);
    }
  }));
  const metadata = { ...await archive.getMetadata(), name: "Bantay Gubat regional basemap", source, extractedAt: new Date().toISOString(), bounds: bounds.join(","), minzoom: String(minZoom), maxzoom: String(maxZoom) };
  const bytes = createRegionalArchive(tiles, metadata, bounds, minZoom, maxZoom);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = destination + "." + randomUUID() + ".partial";
  try { await writeFile(temporary, bytes, { flag: "wx" }); await rename(temporary, destination); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  return { bytes: bytes.length, tiles: tiles.length, sha256: createHash("sha256").update(bytes).digest("hex"), bounds, source, version: metadata.version };
}
