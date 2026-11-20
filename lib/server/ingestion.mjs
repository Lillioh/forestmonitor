import { createHash, timingSafeEqual } from "node:crypto";
import { transaction, audit } from "./database.mjs";
import { StoreError } from "./monitoring.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const identifier = /^[A-Za-z0-9._:-]{1,80}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function authorizeIngestion(authorization) {
  const token = process.env.FOREST_INGEST_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new StoreError("Sensor ingestion is not configured.", 503);
  if (typeof authorization !== "string" || authorization.length > 300 || !authorization.startsWith("Bearer ") ||
      !timingSafeEqual(Buffer.from(digest(authorization.slice(7)), "hex"), Buffer.from(digest(token), "hex"))) {
    throw new StoreError("Receiver credentials are required.", 401);
  }
}

function object(value, fields, required = fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !fields.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) {
    throw new StoreError("Invalid observation fields.");
  }
}

function observation(input, now) {
  const fields = ["version", "receiver_id", "sequence", "event_id", "node_id", "received_at", "gps", "kind"];
  object(input, [...fields, "classification"], fields);
  if (input.version !== 1 || typeof input.receiver_id !== "string" || !uuid.test(input.receiver_id) ||
      !Number.isSafeInteger(input.sequence) || input.sequence < 1 ||
      typeof input.event_id !== "string" || !identifier.test(input.event_id) ||
      typeof input.node_id !== "string" || input.node_id.length > 40 || !identifier.test(input.node_id) ||
      !Number.isSafeInteger(input.received_at) || input.received_at <= 0 || input.received_at > now + 300_000 ||
      !["location", "audio"].includes(input.kind)) throw new StoreError("Invalid observation envelope.");
  object(input.gps, ["fix", "latitude", "longitude"], ["fix"]);
  if (typeof input.gps.fix !== "boolean") throw new StoreError("GPS fix must be a boolean.");
  let gps;
  if (input.gps.fix) {
    if (!Number.isFinite(input.gps.latitude) || Math.abs(input.gps.latitude) > 90 ||
        !Number.isFinite(input.gps.longitude) || Math.abs(input.gps.longitude) > 180) throw new StoreError("Invalid GPS coordinates.");
    gps = { fix: true, latitude: input.gps.latitude, longitude: input.gps.longitude };
  } else {
    if (Object.keys(input.gps).length !== 1) throw new StoreError("A missing GPS fix cannot contain coordinates.");
    gps = { fix: false };
  }
  const result = {
    version: 1, receiver_id: input.receiver_id, sequence: input.sequence, event_id: input.event_id,
    node_id: input.node_id, received_at: input.received_at, gps, kind: input.kind,
  };
  if (input.kind === "audio") {
    const value = input.classification;
    object(value, ["probability", "threshold", "detected", "model_sha256"]);
    if (!Number.isFinite(value.probability) || value.probability < 0 || value.probability > 1 ||
        !Number.isFinite(value.threshold) || value.threshold < 0 || value.threshold > 1 ||
        typeof value.detected !== "boolean" || value.detected !== (value.probability > value.threshold) ||
        typeof value.model_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.model_sha256)) {
      throw new StoreError("Invalid classification result.");
    }
    result.classification = { probability: value.probability, threshold: value.threshold, detected: value.detected, model_sha256: value.model_sha256 };
  } else if (Object.hasOwn(input, "classification")) throw new StoreError("A location observation cannot contain a classification.");
  return result;
}

export function ingestObservation(input, { now = Date.now() } = {}) {
  const event = observation(input, now);
  const hash = digest(JSON.stringify(event));
  return transaction((db) => {
    const receipt = db.prepare("SELECT * FROM ingestion_receipts WHERE node_id = ? AND event_id = ?").get(event.node_id, event.event_id);
    const response = (alertId, duplicate) => ({ accepted: true, event_id: event.event_id, node_id: event.node_id, alert_id: alertId, duplicate });
    if (receipt) {
      if (receipt.digest !== hash) throw new StoreError("This event identity was already used for different data.", 409);
      return response(receipt.alert_id, true);
    }
    const row = db.prepare("SELECT payload FROM sensors WHERE id = ?").get(event.node_id);
    if (!row) throw new StoreError("Unknown configured sensor node.");
    const sensor = JSON.parse(row.payload);
    if (sensor.receiverId && sensor.receiverId !== event.receiver_id) throw new StoreError("The node belongs to a different receiver. Restore the receiver's persistent data or deliberately re-provision it.", 409);
    if (db.prepare("SELECT 1 FROM ingestion_receipts WHERE receiver_id = ? AND sequence = ?").get(event.receiver_id, event.sequence)) throw new StoreError("This receiver sequence was already used.", 409);
    const configured = sensor.configuredPosition || { lat: sensor.lat, lng: sensor.lng };
    const hasPriorFix = Boolean(sensor.lastGpsAt && sensor.lastGpsAt <= event.received_at);
    const position = event.gps.fix ? { lat: event.gps.latitude, lng: event.gps.longitude } : hasPriorFix ? { lat: sensor.lat, lng: sensor.lng } : configured;
    const locationBasis = event.gps.fix ? "node_gps" : hasPriorFix ? "node_last_known" : "node_configured";
    if (!sensor.receiverSequence || event.sequence > sensor.receiverSequence) {
      const updated = {
        ...sensor, configuredPosition: configured, receiverId: event.receiver_id, receiverSequence: event.sequence,
        lastSyncAt: event.received_at, gpsFix: event.gps.fix, status: event.gps.fix ? "ONLINE" : "DEGRADED",
        signal: null, battery: null, coreTemp: null, uptimeHours: null,
      };
      if (event.gps.fix) Object.assign(updated, { lat: event.gps.latitude, lng: event.gps.longitude, lastGpsAt: event.received_at });
      if (event.classification) updated.lastClassification = { ...event.classification, receivedAt: event.received_at };
      db.prepare("UPDATE sensors SET payload = ? WHERE id = ?").run(JSON.stringify(updated), event.node_id);
    }
    let alertId = null;
    if (event.classification?.detected) {
      const result = db.prepare("INSERT INTO incidents (timestamp, status, payload) VALUES (?, 'NEW', '{}')").run(event.received_at);
      alertId = String(result.lastInsertRowid).padStart(3, "0");
      const alert = {
        id: alertId, code: `INC-${new Date(event.received_at).getUTCFullYear()}-${alertId.padStart(4, "0")}`,
        timestamp: event.received_at, ...position, locationBasis, radiusM: null, tdoa: [],
        classification: "Chainsaw Noise", confidence: Number((event.classification.probability * 100).toFixed(2)),
        status: "NEW", zone: sensor.name, nodeId: sensor.id, assignedTeamId: null, responseMinutes: null,
        priority: "HIGH", source: "SENSOR", modelSha256: event.classification.model_sha256,
      };
      db.prepare("UPDATE incidents SET payload = ? WHERE id = ?").run(JSON.stringify(alert), Number(alertId));
      audit(db, null, "DETECTION_CREATED", { id: alertId, source: "SENSOR", nodeId: event.node_id });
    }
    const nodeEvent = {
      id: `wifi-${digest(JSON.stringify([event.node_id, event.event_id]))}`, timestamp: event.received_at, nodeId: event.node_id,
      type: event.kind === "location" ? "GPS_RECEIVED" : event.classification.detected ? "CHAINSAW_DETECTED" : "AUDIO_CLASSIFIED",
      details: event.kind === "location" ? (event.gps.fix ? "GPS fix received over Wi-Fi." : "Node reported no GPS fix; retaining its last known or configured position.") :
        `${event.classification.detected ? "Chainsaw" : "Background"} classification: ${(event.classification.probability * 100).toFixed(1)}% model score. Position identifies the recording node.`,
      ...(event.classification ? { classification: event.classification } : {}),
    };
    db.prepare("INSERT INTO node_events(id, timestamp, payload) VALUES (?, ?, ?)").run(nodeEvent.id, event.received_at, JSON.stringify(nodeEvent));
    db.prepare("DELETE FROM node_events WHERE id NOT IN (SELECT id FROM node_events ORDER BY timestamp DESC, id DESC LIMIT 1000)").run();
    db.prepare("INSERT INTO ingestion_receipts(node_id, event_id, digest, alert_id, received_at, receiver_id, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(event.node_id, event.event_id, hash, alertId, event.received_at, event.receiver_id, event.sequence);
    return response(alertId, false);
  });
}
