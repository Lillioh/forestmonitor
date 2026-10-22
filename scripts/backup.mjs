import { backup } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getDatabase } from "../lib/server/database.mjs";

try {
  const destination = resolve(process.argv[2] || `backups/forest-monitor-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
  const source = resolve(process.env.FOREST_DATABASE_PATH || "data/forest-monitor.sqlite");
  if (source === destination) throw new Error("Choose a backup path different from the live database.");
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  await backup(getDatabase(), destination);
  chmodSync(destination, 0o600);
  console.log(`Consistent database backup saved: ${destination}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
