import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";

// The checked-in manifest pins every renderer asset; verification works offline.
const root = resolve("public/maps");
const manifest = JSON.parse(await readFile(resolve(root, "asset-manifest.json"), "utf8"));
const check = process.argv.includes("--check");
const items = check ? [...manifest.assets, manifest.archive] : manifest.assets;
for (const asset of items) {
  const path = resolve(root, asset.path);
  if (!path.startsWith(root + sep)) throw new Error("Invalid asset destination.");
  if (check) {
    const bytes = await readFile(path);
    if (bytes.length !== asset.bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error(`Asset verification failed: ${asset.path}`);
  } else {
    const response = await fetch(asset.source, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Asset download returned ${response.status}: ${asset.path}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== asset.bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error(`Upstream asset changed: ${asset.path}. Review the source before updating the manifest.`);
    await mkdir(dirname(path), { recursive: true });
    const temporary = path + "." + randomUUID() + ".partial";
    try { await writeFile(temporary, bytes, { flag: "wx" }); await rename(temporary, path); }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
}
console.log(`${check ? "Verified" : "Prepared"} ${items.length} local map assets.`);
