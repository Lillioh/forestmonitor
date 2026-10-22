import { setTimeout as delay } from "node:timers/promises";
import { syncOnce } from "../lib/server/sync/worker.mjs";
import { isCloud } from "../lib/server/deployment.mjs";

if (isCloud()) throw new Error("Run the synchronization worker on the local Pi, not Vercel.");
let stopped = false;
process.once("SIGINT", () => { stopped = true; });
process.once("SIGTERM", () => { stopped = true; });
let failures = 0;
do {
  try {
    const result = await syncOnce();
    if (!result.configured) { console.log("Cloud sync is not configured. Local operation is unaffected."); break; }
    if (result.uploaded) console.log(`Uploaded ${result.uploaded} monitoring changes.`);
    failures = 0;
  } catch (error) { console.error(error.message); failures++; if (process.argv.includes("--once")) process.exitCode = 1; }
  if (stopped || process.argv.includes("--once")) break;
  await delay(Math.min(60000, 5000 * 2 ** Math.min(failures, 4)));
} while (!stopped);
