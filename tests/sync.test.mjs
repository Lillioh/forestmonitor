import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, sep, basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { getDatabase, transaction } from "../lib/server/database.mjs";
import { createAccount } from "../lib/server/accounts.mjs";
import { initializeMonitoring, addTeam, removeTeam, saveSettings } from "../lib/server/monitoring.mjs";
import { nextBatch, localSyncStatus, migrateSync } from "../lib/server/sync/local.mjs";
import { syncOnce } from "../lib/server/sync/worker.mjs";
import { acceptBatch, validateBatch } from "../lib/server/sync/protocol.mjs";

const directory = mkdtempSync(join(tmpdir(), "forest-monitor-sync-"));
process.env.FOREST_DATABASE_PATH = join(directory, "sync.sqlite");
delete process.env.FOREST_SYNC_URL; delete process.env.FOREST_SYNC_TOKEN;
const defaults = { sensors: [{ id: "NODE-01", name: "Node 1", lat: 8.46, lng: 124.7 }], teams: [], settings: { outpostName: "Test outpost", location: "Test forest" } };
const deviceId = "cd5ee533-2afc-4d0d-9818-dfc6f99a9f63";
const envelope = (events = [], afterSeq = 0) => ({ version: 1, deviceId, afterSeq, events });
const event = (seq, operation = "upsert") => ({ seq, entity: "team", id: "alpha", operation, payload: operation === "delete" ? null : { id: "alpha", name: "Alpha" } });
function repository() {
  const device = { lastAck: 0, lastDigest: null };
  const rows = new Map(); let applied = 0;
  return { rows, device: async () => ({ ...device }), apply: async (_id, change) => { rows.set(change.id, change); applied++; }, commit: async (_id, after, last, digest) => { if (device.lastAck !== after) return false; device.lastAck = last; device.lastDigest = digest; return true; }, get applied() { return applied; } };
}
after(() => {
  delete process.env.FOREST_DEPLOYMENT;
  getDatabase().close();
  const absolute = resolve(directory);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + sep) && basename(absolute).startsWith("forest-monitor-sync-"));
  rmSync(absolute, { recursive: true, force: true });
});

test("migration establishes one persistent identity and queues telemetry without account credentials", async () => {
  const account = await createAccount({ username: "syncadmin", name: "Admin", password: "Sync account test password", role: "admin" });
  initializeMonitoring(defaults);
  const db = getDatabase(); const initial = nextBatch(db);
  assert.equal(initial.events.length, 2);
  assert.deepEqual(initial.events.map((e) => e.entity).sort(), ["sensor", "settings"]);
  assert.ok(!JSON.stringify(initial).includes("password"));
  migrateSync(db);
  assert.equal(nextBatch(db).deviceId, initial.deviceId);
  assert.equal(nextBatch(db).events.length, initial.events.length);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
  const team = addTeam("Test patrol", account.id);
  removeTeam(team.id, account.id);
  const events = nextBatch(db).events;
  assert.equal(events.at(-1).operation, "delete");
  assert.equal(events.at(-1).payload, null);
  assert.equal(events.at(-1).id, team.id);
});

test("rolled-back source changes never enter the outbox", () => {
  const before = localSyncStatus(getDatabase()).pending;
  assert.throws(() => transaction((db) => { db.prepare("INSERT INTO teams(id,payload) VALUES ('rollback', ?)").run(JSON.stringify({ id: "rollback" })); throw new Error("rollback"); }));
  assert.equal(localSyncStatus(getDatabase()).pending, before);
  assert.equal(getDatabase().prepare("SELECT id FROM teams WHERE id='rollback'").get(), undefined);
});

test("upgrading an existing version-one database bootstraps records once and captures later writes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE incidents(id INTEGER PRIMARY KEY, payload TEXT); CREATE TABLE sensors(id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE teams(id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE node_events(id TEXT PRIMARY KEY,payload TEXT); CREATE TABLE configuration(key TEXT PRIMARY KEY,value TEXT); PRAGMA user_version=1;");
    for (const [table, id] of [["incidents", 1], ["sensors", "node"], ["teams", "team"], ["node_events", "event"]]) db.prepare(`INSERT INTO ${table}(id,payload) VALUES (?,?)`).run(id, JSON.stringify({ id: String(id) }));
    db.prepare("INSERT INTO configuration(key,value) VALUES ('settings',?)").run(JSON.stringify(defaults.settings));
    migrateSync(db); const initial = nextBatch(db); assert.equal(initial.events.length, 5);
    migrateSync(db); assert.equal(nextBatch(db).events.length, 5); assert.equal(nextBatch(db).deviceId, initial.deviceId);
    let staleObservation = true;
    migrateSync({ exec: (sql) => db.exec(sql), prepare: (sql) => {
      if (sql === "PRAGMA user_version" && staleObservation) { staleObservation = false; return { get: () => ({ user_version: 1 }) }; }
      return db.prepare(sql);
    } });
    assert.equal(nextBatch(db).events.length, 5, "a migration completed while waiting for the write lock must not bootstrap twice");
    db.exec("INSERT INTO incidents(id,payload) VALUES (2,'{}')");
    assert.equal(nextBatch(db).events.length, 5, "incomplete incident insert must not be uploaded");
    db.prepare("UPDATE incidents SET payload=? WHERE id=2").run(JSON.stringify({ id: "002" }));
    assert.equal(nextBatch(db).events.at(-1).entity, "incident");
    assert.equal(nextBatch(db).events.at(-1).payload.id, "002");
    db.exec("PRAGMA user_version=3"); assert.throws(() => migrateSync(db), /newer application/);
  } finally { db.close(); }
});

test("cloud protocol applies upserts and tombstones once, accepts lost-ACK replay and rejects stale or changed history", async () => {
  const repo = repository(); const first = envelope([event(1), event(2, "delete")]);
  assert.deepEqual(await acceptBatch(first, repo), { ackSeq: 2 });
  assert.equal(repo.rows.get("alpha").operation, "delete");
  assert.equal(repo.applied, 2);
  assert.deepEqual(await acceptBatch(first, repo), { ackSeq: 2 });
  assert.equal(repo.applied, 2);
  await assert.rejects(acceptBatch(envelope([event(1)]), repo), (e) => e.status === 409);
  await assert.rejects(acceptBatch(envelope([event(1), event(2)]), repo), (e) => e.status === 409);
  assert.deepEqual(await acceptBatch(envelope([], 2), repo), { ackSeq: 2 });
  assert.equal(repo.applied, 2);
  await assert.rejects(acceptBatch(envelope([], 0), repo), (e) => e.status === 409);
});

test("invalid batches cannot advance acknowledgment and partial application cannot be acknowledged", async () => {
  const repo = repository();
  for (const bad of [envelope([event(1), event(1)]), envelope([event(0)]), { ...envelope(), deviceId: "-".repeat(36) }, envelope([{ ...event(1), entity: "users" }]), envelope([event(1, "delete"), { ...event(2), payload: null }])]) assert.throws(() => validateBatch(bad));
  const failing = { ...repo, apply: async () => { throw new Error("simulated transaction failure"); } };
  await assert.rejects(acceptBatch(envelope([event(1)]), failing), /transaction failure/);
  assert.equal((await repo.device()).lastAck, 0);
  await assert.rejects(acceptBatch(envelope([event(1)]), { ...repo, commit: async () => false }), (e) => e.status === 409);
});

test("malformed event values return client validation errors", () => {
  for (const value of [null, false, "record", 1, []]) assert.throws(() => validateBatch(envelope([value])), (error) => error.status === 400);
});

test("disabled sync makes no network request; network failure and bad acknowledgments retain the durable queue", async () => {
  assert.equal((await syncOnce({ fetchImpl: () => { throw new Error("must not fetch"); } })).configured, false);
  process.env.FOREST_SYNC_URL = "https://forest.example/api/sync";
  process.env.FOREST_SYNC_TOKEN = "isolated-test-device-token-with-strong-length";
  const before = localSyncStatus(getDatabase()).pending;
  await assert.rejects(syncOnce({ fetchImpl: async () => { throw new Error("offline"); } }), /offline/);
  assert.equal(localSyncStatus(getDatabase()).pending, before);
  assert.match(localSyncStatus(getDatabase()).error, /offline/);
  await assert.rejects(syncOnce({ fetchImpl: async () => Response.json({ ackSeq: 999999 }) }), /acknowledgment/);
  assert.equal(localSyncStatus(getDatabase()).pending, before);
  assert.equal(getDatabase().prepare("SELECT lease_owner FROM sync_meta WHERE id=1").get().lease_owner, null);
});

test("worker retries a lost cloud response, removes only acknowledged changes, and heartbeats without flooding", async () => {
  const repo = repository(); const db = getDatabase(); let calls = 0;
  const receiver = async (_url, init) => {
    calls++; assert.equal(init.redirect, "error"); assert.match(init.headers.Authorization, /^Bearer /);
    return Response.json(await acceptBatch(JSON.parse(init.body), repo));
  };
  let originalBody;
  await assert.rejects(syncOnce({ fetchImpl: async (url, init) => {
    originalBody = init.body;
    await receiver(url, init);
    saveSettings({ outpostName: "Written after lost acknowledgment", location: "Forest" }, 1);
    throw new Error("ack lost");
  } }), /ack lost/);
  const restartedBody = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { syncOnce } from './lib/server/sync/worker.mjs';
    import { getDatabase } from './lib/server/database.mjs';
    try { await syncOnce({fetchImpl: async (_url, init) => {
      process.stdout.write(init.body);
      throw new Error('Restarted without network');
    }}); } catch (error) { if (error.message !== 'Restarted without network') throw error; }
    finally { getDatabase().close(); }
  `], { env: process.env, encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(restartedBody, originalBody, "a restarted worker must retain the exact unacknowledged request");
  let replayBody;
  const uploaded = (await syncOnce({ fetchImpl: async (url, init) => { replayBody = init.body; return receiver(url, init); } })).uploaded;
  assert.equal(replayBody, originalBody, "new local writes must not change an unacknowledged batch");
  assert.ok(uploaded > 0); assert.equal(localSyncStatus(db).pending, 1);
  assert.equal(repo.applied, uploaded);
  await syncOnce({ fetchImpl: receiver }); assert.equal(localSyncStatus(db).pending, 0);
  const previousCalls = calls;
  await syncOnce({ fetchImpl: receiver }); assert.equal(calls, previousCalls);
  db.prepare("UPDATE sync_meta SET last_synced_at=1 WHERE id=1").run();
  assert.equal((await syncOnce({ fetchImpl: receiver })).uploaded, 0);
  assert.equal(calls, previousCalls + 1);
  assert.equal(localSyncStatus(db).error, null);
  saveSettings({ outpostName: "Offline renamed", location: "Forest" }, 1);
  await syncOnce({ fetchImpl: async (url, init) => {
    const response = await receiver(url, init);
    saveSettings({ outpostName: "Changed during upload", location: "Forest" }, 1);
    return response;
  } });
  assert.equal(localSyncStatus(db).pending, 1);
  await syncOnce({ fetchImpl: receiver }); assert.equal(localSyncStatus(db).pending, 0);
});

test("concurrent worker leases prevent competing uploads, and cloud mode refuses to open SQLite", async () => {
  const db = getDatabase(); db.prepare("UPDATE sync_meta SET lease_owner='other', lease_until=? WHERE id=1").run(Date.now() + 90000);
  assert.equal((await syncOnce({ fetchImpl: () => { throw new Error("must not fetch"); } })).busy, true);
  db.prepare("UPDATE sync_meta SET lease_owner=NULL, lease_until=0 WHERE id=1").run();
  process.env.FOREST_DEPLOYMENT = "cloud";
  assert.throws(() => getDatabase(), /SQLite is not available/);
  delete process.env.FOREST_DEPLOYMENT;
});
