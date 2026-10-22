import { createHash } from "node:crypto";

export class SyncError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const tokenHash = (value) => createHash("sha256").update(value).digest("hex");
export const batchDigest = (batch) => createHash("sha256").update(JSON.stringify(batch)).digest("hex");

export function validateBatch(input) {
  if (!input || input.version !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.deviceId) || !Number.isSafeInteger(input.afterSeq) || input.afterSeq < 0 || !Array.isArray(input.events) || input.events.length > 64) throw new SyncError("Invalid synchronization envelope.");
  let previous = input.afterSeq;
  const entities = ["sensor", "incident", "team", "node_event", "settings"];
  for (const event of input.events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new SyncError("Invalid synchronization record.");
    if (!Number.isSafeInteger(event.seq) || event.seq <= previous || !entities.includes(event.entity) || typeof event.id !== "string" || !event.id || event.id.length > 120 || !["upsert", "delete"].includes(event.operation)) throw new SyncError("Invalid synchronization record.");
    previous = event.seq;
    if (event.operation === "delete") { if (event.payload !== null) throw new SyncError("A deletion must have an empty payload."); continue; }
    const data = event.payload;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new SyncError("Expected record data.");
    if (event.entity === "settings") {
      if (typeof data.outpostName !== "string" || data.outpostName.length > 80 || typeof data.location !== "string" || data.location.length > 160) throw new SyncError("Invalid outpost settings.");
    } else if (typeof data.id !== "string" || data.id.length > 120) throw new SyncError("Invalid record identity.");
    if (["sensor", "incident"].includes(event.entity) && (!Number.isFinite(data.lat) || !Number.isFinite(data.lng) || Math.abs(data.lat) > 90 || Math.abs(data.lng) > 180)) throw new SyncError("Invalid coordinates.");
    if (event.entity === "incident" && (!Number.isFinite(data.timestamp) || !["NEW", "DISPATCHED", "RESOLVED", "FALSE_POSITIVE"].includes(data.status))) throw new SyncError("Invalid incident.");
  }
  if (Buffer.byteLength(JSON.stringify(input)) > 256000) throw new SyncError("Synchronization batch is too large.", 413);
  return input;
}

// Repository is injectable so replay, stale-device, and partial-failure behavior
// can be tested without a running MongoDB server.
export async function acceptBatch(batch, repository) {
  validateBatch(batch);
  const device = await repository.device(batch.deviceId);
  if (!device) throw new SyncError("Unknown device.", 401);
  const digest = batchDigest(batch);
  const last = batch.events.at(-1)?.seq ?? batch.afterSeq;
  if (device.lastAck !== batch.afterSeq) {
    if (device.lastAck === last && device.lastDigest === digest) return { ackSeq: last };
    throw new SyncError("Device history does not match the cloud acknowledgment. Recover the device state before synchronizing.", 409);
  }
  for (const event of batch.events) await repository.apply(batch.deviceId, event);
  const committed = await repository.commit(batch.deviceId, batch.afterSeq, last, digest);
  if (!committed) {
    const current = await repository.device(batch.deviceId);
    if (current.lastAck !== last || current.lastDigest !== digest) throw new SyncError("Another synchronization stream changed this device.", 409);
  }
  return { ackSeq: last };
}
