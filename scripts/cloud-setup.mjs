import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { cloudDatabase, createCloudIndexes, closeCloudConnections } from "../lib/server/cloud/database.mjs";
import { tokenHash } from "../lib/server/sync/protocol.mjs";
import { databaseFailure } from "../lib/server/cloud/connection-check.mjs";
import { isCloud } from "../lib/server/deployment.mjs";

try {
  if (!isCloud()) throw new Error("Run cloud setup with the private cloud environment file.");
  const { values } = parseArgs({ options: { device: { type: "string" }, name: { type: "string", default: "Forest Outpost 03" } } });
  if (!/^[a-f0-9-]{36}$/.test(values.device || "")) throw new Error("Supply --device <the local Pi's device ID from sync:status>.");
  await createCloudIndexes();
  const token = randomBytes(32).toString("base64url");
  await (await cloudDatabase()).collection("devices").insertOne({ _id: values.device, name: values.name, tokenHash: tokenHash(token), enabled: true, lastAck: 0, lastDigest: null, lastSyncedAt: null });
  console.log(`Registered device ${values.device}. Set FOREST_CLOUD_DEVICE_ID to this ID on Vercel.`);
  console.log(`Set FOREST_SYNC_TOKEN on the Pi to: ${token}`);
  console.log("The device token is displayed once. It grants upload access only for this device.");
} catch (error) { console.error(error.code === 11000 ? "This device is already registered. Do not overwrite its synchronization history." : "Cloud setup failed. Check the environment and device ID; run npm run db:check for safe connection diagnostics.", databaseFailure(error)); process.exitCode = 1; }
finally { await closeCloudConnections(); }
