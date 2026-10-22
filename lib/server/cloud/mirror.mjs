import { cloudClient, cloudDatabase } from "./database.mjs";
import { acceptBatch, tokenHash, SyncError } from "../sync/protocol.mjs";
import { timingSafeEqual } from "node:crypto";
import { CloudConfigurationError } from "./connection-check.mjs";

export async function receiveBatch(batch, token) {
  const client = await cloudClient();
  const db = client.db(process.env.MONGODB_DATABASE || "forest_monitor");
  const session = client.startSession();
  try { return await session.withTransaction(async () => {
  const device = await db.collection("devices").findOne({ _id: batch.deviceId, enabled: true }, { session });
  const expected = Buffer.from(device?.tokenHash || "0".repeat(64), "hex");
  const supplied = Buffer.from(tokenHash(token), "hex");
  if (!device || !timingSafeEqual(expected, supplied)) throw new SyncError("Invalid device credentials.", 401);
  return acceptBatch(batch, {
    device: (id) => db.collection("devices").findOne({ _id: id, enabled: true }, { session }),
    async apply(deviceId, event) {
      const key = `${deviceId}:${event.entity}:${event.id}`;
      await db.collection("mirror").updateOne({ _id: key }, { $set: { deviceId, entity: event.entity, entityId: event.id, revision: event.seq, deleted: event.operation === "delete", payload: event.payload } }, { upsert: true, session });
    },
    async commit(id, after, last, digest) {
      const result = await db.collection("devices").updateOne({ _id: id, enabled: true, lastAck: after }, { $set: { lastAck: last, lastDigest: digest, lastSyncedAt: Date.now() } }, { session });
      return result.matchedCount === 1;
    },
  });
  }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 10000 }); }
  finally { await session.endSession(); }
}

export async function cloudState() {
  const deviceId = process.env.FOREST_CLOUD_DEVICE_ID;
  if (!deviceId) throw new CloudConfigurationError("FOREST_CLOUD_DEVICE_ID must identify the cloud dashboard's outpost.");
  const db = await cloudDatabase();
  const device = await db.collection("devices").findOne({ _id: deviceId });
  if (!device) throw new CloudConfigurationError("The cloud outpost has not been registered.");
  // Only the latest node events are displayed. Do not pull the entire retained
  // event stream into every five-second dashboard poll.
  const [rows, nodeEvents] = await Promise.all([
    db.collection("mirror").find({ deviceId, deleted: false, entity: { $ne: "node_event" } }).toArray(),
    db.collection("mirror").find({ deviceId, deleted: false, entity: "node_event" }).sort({ "payload.timestamp": -1 }).limit(100).toArray(),
  ]);
  const records = (entity) => rows.filter((row) => row.entity === entity).map((row) => row.payload);
  return {
    alerts: records("incident").sort((a, b) => b.timestamp - a.timestamp), sensors: records("sensor"),
    nodeEvents: nodeEvents.map((row) => row.payload), teams: records("team"),
    settings: records("settings")[0] || { outpostName: device.name, location: "Waiting for the first synchronization" },
    simulationEnabled: false, readOnly: true, deployment: "cloud",
    sync: { deviceId, enabled: true, pending: null, lastSyncedAt: device.lastSyncedAt || null, error: null },
  };
}
