import { open, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { PMTiles, bytesToHeader } from "pmtiles";

export const defaultMapPath = "public/maps/mapawa_malasag.pmtiles";
export function mapPath() { return resolve(process.env.FOREST_MAP_ARCHIVE || defaultMapPath); }

export async function mapInfo() {
  try {
    const path = mapPath();
    const info = await stat(path);
    const source = {
      getKey: () => path,
      async getBytes(offset, length) {
        const file = await open(path, "r");
        try {
          const bytes = Buffer.alloc(Math.min(length, info.size - offset));
          const read = await file.read(bytes, 0, bytes.length, offset);
          return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + read.bytesRead) };
        } finally { await file.close(); }
      },
    };
    const reader = new PMTiles(source);
    const header = await reader.getHeader();
    if (header.specVersion !== 3 || header.tileType !== 1 || header.minZoom > header.maxZoom) throw new Error("Unsupported archive. Expected a vector PMTiles v3 basemap.");
    const metadata = await reader.getMetadata();
    const layerNames = (metadata.vector_layers || []).map((layer) => layer.id);
    if (!["earth", "roads", "water"].every((layer) => layerNames.includes(layer))) throw new Error("This archive does not use the supported Protomaps basemap schema.");
    return { available: true, bytes: info.size, minZoom: header.minZoom, maxZoom: header.maxZoom, bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat], dataVersion: String(metadata.version || "unknown"), dataDate: String(metadata["planetiler:osm:osmosisreplicationtime"] || metadata.extractedAt || "unknown"), archiveUrl: "/api/maps/archive" };
  } catch (error) {
    if (error.code === "ENOENT") return { available: false, reason: "The local geographic map package has not been installed on this device." };
    return { available: false, reason: "The local map package could not be read. Ask the administrator to verify it." };
  }
}

export function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new Error("Invalid byte range.");
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || (!match[1] && Number(match[2]) === 0)) throw new Error("Unsatisfiable byte range.");
  start = Math.trunc(start);
  return { start, end };
}

export async function serveArchive(request, head = false) {
  const path = mapPath();
  let info;
  try { info = await stat(path); } catch { return new Response("Map package unavailable.", { status: 404 }); }
  const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
  const headers = { "Content-Type": "application/vnd.pmtiles", "Accept-Ranges": "bytes", "Cache-Control": "private, no-cache, no-transform", "Content-Encoding": "identity", ETag: etag, "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  let range;
  try { range = parseRange(request.headers.get("range"), info.size); }
  catch { return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${info.size}` } }); }
  if (!range && !head) return new Response("A byte range is required.", { status: 400, headers });
  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  if (!head && end - start + 1 > 4 * 1024 * 1024) return new Response("Range exceeds the 4 MB request limit.", { status: 413, headers });
  const body = head ? null : Readable.toWeb(createReadStream(path, { start, end, signal: request.signal }));
  return new Response(body, { status: range ? 206 : 200, headers: { ...headers, "Content-Length": String(end - start + 1), ...(range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {}) } });
}

// Used by tests and preparation checks without decoding the entire archive.
export { bytesToHeader };
