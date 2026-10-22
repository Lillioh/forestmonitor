import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, sep, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync, backup } from "node:sqlite";
import { getDatabase } from "../lib/server/database.mjs";
import { createAccount, authenticate, getSessionUser, revokeSession, resetPassword } from "../lib/server/accounts.mjs";
import { initializeMonitoring, readState, createDetection, updateIncident, addTeam, removeTeam, saveSettings } from "../lib/server/monitoring.mjs";

const dir = mkdtempSync(join(tmpdir(), "forest-monitor-test-"));
process.env.FOREST_DATABASE_PATH = join(dir, "test.sqlite");
delete process.env.FOREST_SIMULATION_ENABLED;
let admin;
let incident;
const secret = "A unique local test password 2026";
const defaults = {
  sensors: [{ id: "NODE-01", name: "NODE-01", lat: 8.46, lng: 124.7, status: "ONLINE", signal: 90, battery: 80, uptimeHours: 20, lastSyncAt: 100 }],
  teams: [{ id: "alpha", name: "Alpha", shortCode: "A", members: 3, channel: "Local Radio", status: "ACTIVE" }, { id: "offline", name: "Offline", status: "OFFLINE" }],
  settings: { outpostName: "Test outpost", location: "Test forest" },
};

after(() => {
  getDatabase().close();
  const absolute = resolve(dir);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + sep) && basename(absolute).startsWith("forest-monitor-test-"));
  rmSync(absolute, { recursive: true, force: true });
});

test("local accounts hash passwords, normalize usernames, and reject duplicate or weak accounts", async () => {
  await assert.rejects(createAccount({ username: "admin", password: "weak", name: "Admin", role: "admin" }));
  admin = await createAccount({ username: "Admin", password: secret, name: "Outpost Admin", role: "admin" });
  assert.equal(admin.username, "admin");
  const stored = getDatabase().prepare("SELECT password_hash FROM users WHERE id = ?").get(admin.id).password_hash;
  assert.ok(stored.startsWith("scrypt:"));
  assert.ok(!stored.includes(secret));
  await assert.rejects(createAccount({ username: "ADMIN", password: secret, name: "Duplicate", role: "operator" }));
});

test("invalid credentials, SQL-like input, and unknown accounts cannot authenticate", async () => {
  assert.equal((await authenticate("admin", "incorrect")).status, 401);
  assert.equal((await authenticate("' OR 1=1 --", secret)).status, 401);
  assert.equal((await authenticate("unknown", secret)).status, 401);
  assert.equal(getSessionUser("forged-session"), null);
});

test("opaque sessions are stored hashed and expire or revoke locally", async () => {
  const result = await authenticate("ADMIN", secret);
  assert.equal(result.status, 200);
  assert.equal(getSessionUser(result.token).id, admin.id);
  const session = getDatabase().prepare("SELECT * FROM sessions").get();
  assert.notEqual(session.token_hash, result.token);
  revokeSession(result.token);
  assert.equal(getSessionUser(result.token), null);
  const expiring = await authenticate("admin", secret);
  getDatabase().prepare("UPDATE sessions SET expires_at = 1").run();
  assert.equal(getSessionUser(expiring.token), null);
});

test("login throttling survives requests and does not disclose account existence", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await authenticate("unregistered", "incorrect")).status, 401);
  assert.equal((await authenticate("unregistered", secret)).status, 429);
});

test("monitoring initializes once without inventing telemetry or reseeding deleted teams", () => {
  initializeMonitoring(defaults);
  let state = readState();
  assert.equal(state.simulationEnabled, false);
  assert.equal(state.alerts.length, 0);
  assert.equal(state.sensors[0].status, "OFFLINE");
  assert.equal(state.sensors[0].lastSyncAt, 0);
  removeTeam("offline", admin.id);
  initializeMonitoring(defaults);
  state = readState();
  assert.equal(state.teams.length, 1);
});

test("incident IDs are persistent, dispatch timing is measured, and terminal transitions are enforced", () => {
  incident = createDetection({ timestamp: Date.now() - 120_000, lat: 8.46, lng: 124.7, classification: "Chainsaw Noise", confidence: 95, radiusM: 10, zone: "Test zone", nodeId: "NODE-01", tdoa: [], priority: "HIGH", source: "SIMULATION" }, admin.id);
  assert.equal(incident.id, "001");
  assert.throws(() => updateIncident(incident.id, "resolve", undefined, admin.id));
  assert.throws(() => updateIncident(incident.id, "dispatch", "missing", admin.id));
  const dispatched = updateIncident(incident.id, "dispatch", "alpha", admin.id);
  assert.equal(dispatched.status, "DISPATCHED");
  assert.ok(dispatched.responseMinutes >= 2 && dispatched.responseMinutes < 2.1);
  const repeat = updateIncident(incident.id, "dispatch", "alpha", admin.id);
  assert.equal(repeat.dispatchedAt, dispatched.dispatchedAt);
  const resolved = updateIncident(incident.id, "resolve", undefined, admin.id);
  assert.equal(resolved.status, "RESOLVED");
  assert.equal(resolved.responseMinutes, dispatched.responseMinutes);
  assert.throws(() => updateIncident(incident.id, "false-positive", undefined, admin.id));
  assert.throws(() => removeTeam("alpha", admin.id));
  assert.equal(createDetection({ ...incident, timestamp: Date.now() }, admin.id).id, "002");
});

test("configuration and team changes are committed, validated, and audited", () => {
  const team = addTeam("North Patrol", admin.id);
  assert.equal(readState().teams.at(-1).id, team.id);
  removeTeam(team.id, admin.id);
  assert.throws(() => saveSettings({ outpostName: "", location: "Forest" }, admin.id));
  saveSettings({ outpostName: "Updated Outpost", location: "Local watershed", ignored: "not persisted" }, admin.id);
  assert.deepEqual(readState().settings, { outpostName: "Updated Outpost", location: "Local watershed" });
  assert.ok(getDatabase().prepare("SELECT COUNT(*) AS n FROM audit_log").get().n >= 8);
});

test("records survive a new Node process", () => {
  const result = execFileSync(process.execPath, ["--input-type=module", "-e", "import {readState} from './lib/server/monitoring.mjs'; console.log(JSON.stringify(readState()));"], { cwd: process.cwd(), env: process.env, encoding: "utf8", windowsHide: true });
  const restored = JSON.parse(result);
  assert.equal(restored.alerts.length, 2);
  assert.equal(restored.settings.outpostName, "Updated Outpost");
});

test("online backups include committed WAL data and can be opened independently", async () => {
  const target = join(dir, "backup.sqlite");
  await backup(getDatabase(), target);
  const copy = new DatabaseSync(target);
  try {
    assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM incidents").get().n, 2);
    assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
  } finally { copy.close(); }
});

test("password reset invalidates existing sessions and accepts only the new password", async () => {
  const signedIn = await authenticate("admin", secret);
  const next = "A replacement local test password 2026";
  await resetPassword("admin", next);
  assert.equal(getSessionUser(signedIn.token), null);
  assert.equal((await authenticate("admin", secret)).status, 401);
  assert.equal((await authenticate("admin", next)).status, 200);
});

test("account provisioning and backup commands work without exposing passwords in arguments", async () => {
  const output = execFileSync(process.execPath, ["scripts/account.mjs", "--username", "cliadmin", "--name", "CLI Admin", "--role", "admin", "--generate-password"], { env: process.env, encoding: "utf8", windowsHide: true });
  const generated = output.match(/Generated password: (\S+)/)?.[1];
  assert.ok(generated && generated.length >= 24);
  assert.equal((await authenticate("cliadmin", generated)).status, 200);
  const target = join(dir, "cli-backup.sqlite");
  execFileSync(process.execPath, ["scripts/backup.mjs", target], { env: process.env, encoding: "utf8", windowsHide: true });
  const copy = new DatabaseSync(target);
  try { assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM users").get().n, 2); }
  finally { copy.close(); }
});
