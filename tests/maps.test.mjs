import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, sep, basename } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { PMTiles, zxyToTileId } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { offlineStyle } from "../lib/maps/style.ts";
import { createRegionalArchive, extractRegion } from "../lib/maps/archive-builder.mjs";
import { mapInfo, parseRange, serveArchive } from "../lib/server/maps.mjs";

// Windows can virtualize OS temp paths and disallow atomic renames there.
// Keep this filesystem integration test inside the writable project cache.
const testRoot = resolve(".cache");
mkdirSync(testRoot, { recursive: true });
const directory = mkdtempSync(join(testRoot, "forest-monitor-maps-"));
const originalArchive = process.env.FOREST_MAP_ARCHIVE;
const synthetic = createRegionalArchive([
  { id: zxyToTileId(1, 0, 0), data: gzipSync(Buffer.from("tile one")) },
  { id: zxyToTileId(1, 0, 1), data: gzipSync(Buffer.from("tile two")) },
  { id: zxyToTileId(1, 1, 1), data: gzipSync(Buffer.from("tile one")) },
], { version: "test", vector_layers: ["earth", "roads", "water"].map((id) => ({ id })) }, [-180, -85, 180, 85], 1, 1);
const path = join(directory, "test.pmtiles");
writeFileSync(path, synthetic);
function source(bytes) { return { getKey: () => "test-" + createHash("sha256").update(bytes).digest("hex"), getBytes: async (offset, length) => ({ data: Uint8Array.from(bytes.subarray(offset, offset + length)).buffer }) }; }
after(() => {
  if (originalArchive === undefined) delete process.env.FOREST_MAP_ARCHIVE; else process.env.FOREST_MAP_ARCHIVE = originalArchive;
  const absolute = resolve(directory);
  assert.ok(absolute.startsWith(testRoot + sep) && basename(absolute).startsWith("forest-monitor-maps-"));
  rmSync(absolute, { recursive: true, force: true });
});

test("regional writer round-trips independently through the official PMTiles reader, including deduplicated and missing tiles", async () => {
  const archive = new PMTiles(source(synthetic));
  const header = await archive.getHeader();
  assert.equal(header.specVersion, 3);
  assert.equal(header.numTileEntries, 3);
  assert.equal(header.numTileContents, 2);
  assert.equal((await archive.getMetadata()).version, "test");
  assert.equal(Buffer.from((await archive.getZxy(1, 0, 0)).data).toString(), "tile one");
  assert.equal(Buffer.from((await archive.getZxy(1, 0, 1)).data).toString(), "tile two");
  assert.equal(Buffer.from((await archive.getZxy(1, 1, 1)).data).toString(), "tile one");
  assert.equal(await archive.getZxy(1, 1, 0), undefined);
  assert.equal(await archive.getZxy(2, 0, 0), undefined);
});

test("range parser rejects malformed, multipart and out-of-bounds requests", () => {
  assert.deepEqual(parseRange("bytes=0-126", 200), { start: 0, end: 126 });
  assert.deepEqual(parseRange("bytes=100-", 200), { start: 100, end: 199 });
  assert.deepEqual(parseRange("bytes=-50", 200), { start: 150, end: 199 });
  assert.deepEqual(parseRange("bytes=190-999", 200), { start: 190, end: 199 });
  for (const range of ["bytes=200-", "bytes=2-1", "bytes=0-1,3-4", "bytes=-0", "items=1-2", "bytes=-", "bytes=999999999999999999-"]) assert.throws(() => parseRange(range, 200));
});

test("archive API streams exact 206 bytes, HEAD, ETag and failure responses", async () => {
  process.env.FOREST_MAP_ARCHIVE = path;
  const info = await mapInfo();
  assert.equal(info.available, true);
  const request = (headers = {}) => new Request("http://outpost.local/api/maps/archive", { headers });
  const response = await serveArchive(request({ Range: "bytes=0-126" }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), `bytes 0-126/${synthetic.length}`);
  assert.equal(response.headers.get("content-encoding"), "identity");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), synthetic.subarray(0, 127));
  const head = await serveArchive(request(), true);
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.equal(Number(head.headers.get("content-length")), synthetic.length);
  assert.equal((await serveArchive(request({ "If-None-Match": head.headers.get("etag") }))).status, 304);
  assert.equal((await serveArchive(request())).status, 400);
  assert.equal((await serveArchive(request({ Range: "bytes=999999-" }))).status, 416);
  process.env.FOREST_MAP_ARCHIVE = join(directory, "missing.pmtiles");
  assert.equal((await mapInfo()).available, false);
  assert.equal((await serveArchive(request())).status, 404);
  writeFileSync(join(directory, "broken.pmtiles"), "invalid archive");
  process.env.FOREST_MAP_ARCHIVE = join(directory, "broken.pmtiles");
  assert.equal((await mapInfo()).available, false);
});

test("extractor enforces regional budgets and rejects a source that ignores ranges", async () => {
  const options = { source: "https://example.invalid/world.pmtiles", destination: join(directory, "extracted.pmtiles"), bounds: [-180, -85, 180, 85], minZoom: 1, maxZoom: 1 };
  const rangeFetch = async (_url, init) => {
    const range = parseRange(init.headers.Range, synthetic.length);
    return new Response(synthetic.subarray(range.start, range.end + 1), { status: 206 });
  };
  const result = await extractRegion({ ...options, fetchImpl: rangeFetch });
  assert.equal(result.tiles, 3);
  const extracted = new PMTiles(source(readFileSync(options.destination)));
  assert.equal(Buffer.from((await extracted.getZxy(1, 0, 1)).data).toString(), "tile two");
  await assert.rejects(extractRegion({ ...options, source: "http://example.invalid/tiles" }), /HTTPS/);
  await assert.rejects(extractRegion({ ...options, maxZoom: 16 }), /zoom/);
  await assert.rejects(extractRegion({ ...options, fetchImpl: async () => new Response(synthetic) }), /byte ranges/);
  const world = Buffer.from(synthetic); world[100] = 0; world[101] = 15;
  let requests = 0;
  await assert.rejects(extractRegion({ ...options, minZoom: 0, maxZoom: 15, fetchImpl: async (_url, init) => {
    requests++; const range = parseRange(init.headers.Range, world.length);
    return new Response(world.subarray(range.start, range.end + 1), { status: 206 });
  } }), /4096-tile regional limit/);
  assert.equal(requests, 1, "reject oversized areas before downloading any tiles");
});

test("bundled map and glyph/sprite assets match their pinned hashes and cover configured sensor tiles", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/maps/asset-manifest.json", import.meta.url)));
  for (const asset of [...manifest.assets, ...(manifest.worker ? [manifest.worker] : []), manifest.archive]) {
    const bytes = readFileSync(new URL("../public/maps/" + asset.path, import.meta.url));
    assert.equal(bytes.length, asset.bytes, asset.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256, asset.path);
  }
  const archive = new PMTiles(source(readFileSync(new URL("../public/maps/" + manifest.archive.path, import.meta.url))));
  const metadata = await archive.getMetadata();
  assert.equal(metadata.version, "4.15.2");
  const x = Math.floor((124.7012 + 180) / 360 * 2 ** 15);
  const y = Math.floor((1 - Math.asinh(Math.tan(8.4598 * Math.PI / 180)) / Math.PI) / 2 * 2 ** 15);
  const tile = await archive.getZxy(15, x, y);
  assert.ok(tile?.data.byteLength > 0);
  const decoded = new VectorTile(new PbfReader(new Uint8Array(tile.data)));
  assert.ok(decoded.layers.roads?.length > 0);
  assert.ok(decoded.layers.earth?.length > 0);
});

test("both map themes validate and request only local renderer resources", () => {
  globalThis.window = { location: { origin: "http://outpost.local" } };
  try {
    for (const dark of [false, true]) {
      const style = offlineStyle("http://outpost.local/api/maps/archive", dark);
      assert.deepEqual(validateStyleMin(style), []);
      assert.ok(style.glyphs.startsWith("http://outpost.local/"));
      assert.ok(style.sprite.startsWith("http://outpost.local/"));
      assert.equal(Object.keys(style.sources).length, 1);
      assert.equal(style.sources.basemap.url, "pmtiles://http://outpost.local/api/maps/archive");
      const fontNames = (expression) => !Array.isArray(expression) ? [] : typeof expression[0] === "string" && expression[0].startsWith("Noto ") ? expression : expression.flatMap(fontNames);
      const fonts = new Set(style.layers.flatMap((layer) => fontNames(layer.layout?.["text-font"])));
      assert.equal(fonts.size, 3);
      for (const font of fonts) assert.ok(["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"].includes(font), font);
    }
  } finally { delete globalThis.window; }
});
