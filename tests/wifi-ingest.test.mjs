import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { getDatabase } from "../lib/server/database.mjs";
import { initializeMonitoring, readState, StoreError } from "../lib/server/monitoring.mjs";
import { ingestObservation } from "../lib/server/ingestion.mjs";
import { currentSensor } from "../lib/server/sensor-status.mjs";

const directory = mkdtempSync(join(tmpdir(), "forest-wifi-ingest-"));
const connections = [];
const now = Date.now();
const receiver = "7f497af2-2616-4cfe-8f2e-1cb0f8ec20d9";
const otherReceiver = "508f1535-1ec8-4a57-9bd5-8e763f6efaf4";
const defaults = {
  sensors: [{ id: "NODE-01", name: "North node", lat: 8.46, lng: 124.7 }],
  teams: [], settings: { outpostName: "Test outpost", location: "Test forest" },
};

beforeEach(() => {
  delete process.env.FOREST_DEPLOYMENT;
  process.env.FOREST_DATABASE_PATH = join(directory, `${connections.length}.sqlite`);
  initializeMonitoring(defaults);
  connections.push(getDatabase());
});

after(() => {
  for (const db of connections) db.close();
  const absolute = resolve(directory);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + sep) && basename(absolute).startsWith("forest-wifi-ingest-"));
  rmSync(absolute, { recursive: true, force: true });
});

function observation(overrides = {}) {
  return {
    version: 1, receiver_id: receiver, sequence: 1, event_id: "boot1:record1", node_id: "NODE-01",
    received_at: now - 1000, gps: { fix: true, latitude: 8.5, longitude: 124.8 }, kind: "location",
    ...overrides,
  };
}

function audio(overrides = {}) {
  return observation({ kind: "audio", classification: {
    probability: 0.95, threshold: 0.6, detected: true, model_sha256: "a".repeat(64),
  }, ...overrides });
}

const ingest = (input) => ingestObservation(input, { now });
const storedSensor = () => JSON.parse(getDatabase().prepare("SELECT payload FROM sensors WHERE id='NODE-01'").get().payload);
const snapshot = () => Object.fromEntries(["sensors", "incidents", "node_events", "ingestion_receipts", "sync_outbox", "audit_log"].map((table) => [table, getDatabase().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const failsWith = (value, status) => assert.throws(() => ingest(value), (error) => error instanceof StoreError && error.status === status);

test("upgrading a version-two outpost preserves existing records and its pending cloud queue", () => {
  const db = getDatabase();
  const sensors = db.prepare("SELECT * FROM sensors ORDER BY id").all();
  const pending = db.prepare("SELECT * FROM sync_outbox ORDER BY seq").all();
  const identity = db.prepare("SELECT * FROM sync_meta").all();
  db.exec("DROP TABLE ingestion_receipts; PRAGMA user_version = 2;");
  getDatabase();
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
  assert.deepEqual(db.prepare("SELECT * FROM sensors ORDER BY id").all(), sensors);
  assert.deepEqual(db.prepare("SELECT * FROM sync_outbox ORDER BY seq").all(), pending);
  assert.deepEqual(db.prepare("SELECT * FROM sync_meta").all(), identity);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ingestion_receipts").get().n, 0);
  getDatabase();
  assert.deepEqual(db.prepare("SELECT * FROM sync_outbox ORDER BY seq").all(), pending);
});

test("ingestion rejects malformed and unexpected fields without writing anything", () => {
  const valid = observation();
  const bad = [null, [], false, "event", 1,
    { ...valid, version: 2 }, { ...valid, version: "1" }, { ...valid, receiver_id: "not-a-uuid" },
    { ...valid, sequence: 0 }, { ...valid, sequence: 1.5 }, { ...valid, sequence: true },
    { ...valid, sequence: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, sequence: "1" },
    { ...valid, event_id: "" }, { ...valid, event_id: "x".repeat(81) }, { ...valid, event_id: "has space" },
    { ...valid, node_id: 1 }, { ...valid, node_id: "x".repeat(41) },
    { ...valid, received_at: "123" }, { ...valid, received_at: true }, { ...valid, received_at: -1 },
    { ...valid, received_at: now + 86_400_000 }, { ...valid, kind: "sound" },
    { ...valid, audio: "private-recording" }, { ...valid, radiusM: 12 },
    { ...valid, gps: null }, { ...valid, gps: { fix: "true", latitude: 8, longitude: 124 } },
    { ...valid, gps: { fix: true, latitude: true, longitude: 124 } },
    { ...valid, gps: { fix: true, latitude: 91, longitude: 124 } },
    { ...valid, gps: { fix: true, latitude: 8, longitude: -181 } },
    { ...valid, gps: { fix: true, latitude: NaN, longitude: 124 } },
    { ...valid, gps: { fix: true, latitude: 8 } },
    { ...valid, gps: { fix: false, latitude: 8, longitude: 124 } },
    { ...valid, gps: { fix: false, accuracy: 5 } },
    { ...valid, classification: audio().classification },
    ...["version", "receiver_id", "sequence", "event_id", "node_id", "received_at", "gps", "kind"].map((key) => {
      const missing = { ...valid }; delete missing[key]; return missing;
    }),
  ];
  const before = snapshot();
  for (const value of bad) failsWith(value, 400);
  assert.deepEqual(snapshot(), before);
});

test("classification requires finite scores, exact model identity and a consistent strict threshold", () => {
  const valid = audio();
  const malformed = [
    { ...valid, classification: undefined }, { ...valid, classification: [] },
    ...[{ probability: -0.1 }, { probability: 1.1 }, { probability: Infinity }, { probability: "0.95" },
      { probability: true }, { threshold: -1 }, { threshold: NaN }, { threshold: "0.6" },
      { detected: false }, { detected: "true" }, { model_sha256: "wrong" }, { model_sha256: "A".repeat(64) },
      { accuracy: 0.99 }].map((change) => ({ ...valid, classification: { ...valid.classification, ...change } })),
    { ...valid, classification: { ...valid.classification, probability: 0.6, detected: true } },
  ];
  const before = snapshot();
  for (const value of malformed) failsWith(value, 400);
  assert.deepEqual(snapshot(), before);
  const accepted = ingest(audio({ classification: { ...valid.classification, probability: 0.6, detected: false } }));
  assert.equal(accepted.alert_id, null);
  assert.equal(readState().alerts.length, 0);
});

test("true and false GPS update fix state while preserving the last known position", () => {
  assert.deepEqual(ingest(observation()), { accepted: true, event_id: "boot1:record1", node_id: "NODE-01", alert_id: null, duplicate: false });
  let sensor = storedSensor();
  assert.equal(sensor.lat, 8.5); assert.equal(sensor.lng, 124.8);
  assert.equal(sensor.gpsFix, true); assert.equal(sensor.lastGpsAt, now - 1000);
  assert.equal(sensor.lastSyncAt, now - 1000);
  assert.equal(sensor.receiverId, receiver); assert.equal(sensor.receiverSequence, 1);
  assert.deepEqual(sensor.configuredPosition, { lat: 8.46, lng: 124.7 });
  const measured = { signal: sensor.signal, battery: sensor.battery, uptimeHours: sensor.uptimeHours, temperature: sensor.temperature };
  ingest(observation({ sequence: 2, event_id: "boot1:record2", received_at: now, gps: { fix: false } }));
  sensor = storedSensor();
  assert.equal(sensor.gpsFix, false); assert.equal(sensor.lat, 8.5); assert.equal(sensor.lng, 124.8);
  assert.equal(sensor.lastGpsAt, now - 1000); assert.equal(sensor.lastSyncAt, now);
  assert.deepEqual({ signal: sensor.signal, battery: sensor.battery, uptimeHours: sensor.uptimeHours, temperature: sensor.temperature }, measured);
  assert.equal(readState().alerts.length, 0);
});

test("positive classification creates one truthful incident and exact replay has no effects", () => {
  const input = audio();
  const result = ingest(input);
  assert.equal(result.accepted, true); assert.equal(result.duplicate, false); assert.equal(typeof result.alert_id, "string");
  const state = readState();
  assert.equal(state.alerts.length, 1);
  const alert = state.alerts[0];
  assert.equal(alert.id, result.alert_id); assert.equal(alert.timestamp, input.received_at);
  assert.equal(alert.lat, 8.5); assert.equal(alert.lng, 124.8); assert.equal(alert.nodeId, "NODE-01");
  assert.equal(alert.locationBasis, "node_gps"); assert.equal(alert.source, "SENSOR");
  assert.equal(alert.radiusM, null); assert.deepEqual(alert.tdoa, []);
  const beforeReplay = snapshot();
  assert.deepEqual(ingest(structuredClone(input)), { ...result, duplicate: true });
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  reordered.classification = Object.fromEntries(Object.entries(input.classification).reverse());
  assert.deepEqual(ingest(reordered), { ...result, duplicate: true });
  assert.deepEqual(snapshot(), beforeReplay);
  assert.equal(getDatabase().prepare("SELECT count(*) AS count FROM sync_outbox WHERE entity='incident'").get().count, 1);
});

test("negative audio persists its classification without raising an incident", () => {
  const input = audio({ classification: { ...audio().classification, probability: 0.2, detected: false } });
  const result = ingest(input);
  assert.equal(result.alert_id, null); assert.equal(result.duplicate, false);
  const state = readState();
  assert.equal(state.alerts.length, 0); assert.equal(state.nodeEvents.length, 1);
  assert.deepEqual(storedSensor().lastClassification, { ...input.classification, receivedAt: input.received_at });
  const beforeReplay = snapshot();
  assert.equal(ingest(input).duplicate, true);
  assert.deepEqual(snapshot(), beforeReplay);
});

test("changed identities, unknown nodes and receiver takeover are rejected without effects", () => {
  const input = audio(); ingest(input);
  const before = snapshot();
  failsWith({ ...input, received_at: input.received_at - 1 }, 409);
  failsWith({ ...input, classification: { ...input.classification, probability: 0.99 } }, 409);
  failsWith({ ...input, event_id: "another-event" }, 409);
  failsWith({ ...input, sequence: 2 }, 409);
  failsWith(observation({ sequence: 2, event_id: "new", receiver_id: otherReceiver }), 409);
  failsWith(observation({ node_id: "NODE-99" }), 400);
  assert.deepEqual(snapshot(), before);
});

test("older queued audio creates its historical incident once without rewinding the node", () => {
  ingest(observation({ sequence: 20, event_id: "newest", received_at: now, gps: { fix: true, latitude: 10, longitude: 120 } }));
  const latest = storedSensor();
  const old = audio({ sequence: 19, event_id: "older", received_at: now - 60_000, gps: { fix: true, latitude: 9, longitude: 121 } });
  ingest(old);
  assert.deepEqual(storedSensor(), latest);
  const alert = readState().alerts[0];
  assert.equal(alert.lat, 9); assert.equal(alert.lng, 121); assert.equal(alert.timestamp, old.received_at);
  assert.equal(alert.locationBasis, "node_gps");
  assert.equal(ingest(old).duplicate, true); assert.equal(readState().alerts.length, 1);
});

test("a previously used older receiver sequence cannot identify a second event", () => {
  ingest(audio({ sequence: 3, event_id: "original-three" }));
  ingest(observation({ sequence: 10, event_id: "latest-ten", received_at: now }));
  const before = snapshot();
  failsWith(audio({ sequence: 3, event_id: "reused-three" }), 409);
  assert.deepEqual(snapshot(), before);
});

test("no-fix incidents label configured and last-known fallback positions", () => {
  ingest(audio({ gps: { fix: false } }));
  let alert = readState().alerts[0];
  assert.equal(alert.locationBasis, "node_configured"); assert.equal(alert.lat, 8.46); assert.equal(alert.lng, 124.7);
  ingest(observation({ sequence: 2, event_id: "fix", received_at: now - 500, gps: { fix: true, latitude: 9, longitude: 125 } }));
  ingest(audio({ sequence: 3, event_id: "no-fix", received_at: now, gps: { fix: false } }));
  alert = readState().alerts[0];
  assert.equal(alert.locationBasis, "node_last_known"); assert.equal(alert.lat, 9); assert.equal(alert.lng, 125);
  assert.equal(alert.radiusM, null); assert.deepEqual(alert.tdoa, []);
});

test("an old no-fix recording never borrows a GPS position learned after the recording", () => {
  ingest(observation({ sequence: 10, event_id: "later-fix", received_at: now, gps: { fix: true, latitude: 9, longitude: 125 } }));
  ingest(audio({ sequence: 9, event_id: "historical-no-fix", received_at: now - 60_000, gps: { fix: false } }));
  const alert = readState().alerts[0];
  assert.equal(alert.locationBasis, "node_configured"); assert.equal(alert.lat, 8.46); assert.equal(alert.lng, 124.7);
  assert.equal(storedSensor().lat, 9);
});

test("node freshness uses receiver time and distinguishes degraded from offline", () => {
  ingest(observation({ received_at: now - 86_400_000 }));
  assert.equal(storedSensor().lastSyncAt, now - 86_400_000);
  assert.equal(currentSensor(storedSensor(), now).status, "OFFLINE");
  ingest(observation({ sequence: 2, event_id: "fresh", received_at: now }));
  const fresh = storedSensor();
  assert.equal(currentSensor(fresh, now).status, "ONLINE");
  assert.equal(currentSensor(fresh, now + 90_001).status, "DEGRADED");
  assert.equal(currentSensor(fresh, now + 180_001).status, "OFFLINE");
  assert.equal(currentSensor({ ...fresh, gpsFix: false }, now).status, "DEGRADED");
  assert.equal(currentSensor({ id: "legacy", status: "OFFLINE", lastSyncAt: 0 }, now).status, "OFFLINE");
});

test("database failure rolls back receipt, incident, sensor, event and outbox together", () => {
  const before = snapshot();
  getDatabase().exec("CREATE TRIGGER fail_wifi_event BEFORE INSERT ON node_events BEGIN SELECT RAISE(ABORT, 'injected event failure'); END;");
  try { assert.throws(() => ingest(audio()), /injected event failure/); }
  finally { getDatabase().exec("DROP TRIGGER fail_wifi_event"); }
  assert.deepEqual(snapshot(), before);
  const result = ingest(audio());
  assert.equal(result.duplicate, false); assert.equal(readState().alerts.length, 1);
});

test("a restarted process recognizes the durable receipt without duplicating cloud changes", () => {
  const input = audio(); const result = ingest(input); const before = snapshot();
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { ingestObservation } from './lib/server/ingestion.mjs';
    import { getDatabase } from './lib/server/database.mjs';
    try { process.stdout.write(JSON.stringify(ingestObservation(JSON.parse(process.env.WIFI_TEST_EVENT), { now: Number(process.env.WIFI_TEST_NOW) }))); }
    finally { getDatabase().close(); }
  `], { env: { ...process.env, WIFI_TEST_EVENT: JSON.stringify(input), WIFI_TEST_NOW: String(now) }, encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.deepEqual(JSON.parse(output), { ...result, duplicate: true });
  assert.deepEqual(snapshot(), before);
});
