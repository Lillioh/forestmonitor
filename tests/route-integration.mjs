// Uses the compiled Next route modules and real request/cookie contexts, without sockets.
// Run after a production build. This complements the full HTTP smoke check.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, basename, sep } from "node:path";
import { createAccount } from "../lib/server/accounts.mjs";
import { getDatabase } from "../lib/server/database.mjs";

const require = createRequire(import.meta.url);
require("next/dist/server/node-environment");
const { NextRequest } = require("next/server");
const directory = mkdtempSync(join(tmpdir(), "forest-monitor-routes-"));
process.env.FOREST_DATABASE_PATH = join(directory, "routes.sqlite");
process.env.FOREST_SIMULATION_ENABLED = "true";
process.env.FOREST_COOKIE_SECURE = "false";
const password = "Isolated route test password 2026";
const base = "http://outpost.local:3000";
const fixtureMongoUri = "mongodb://isolated-route-fixture.invalid/test";
const originalMongoUri = process.env.MONGODB_URI;
const originalIngestToken = process.env.FOREST_INGEST_TOKEN;

async function request(path, { method = "GET", cookie, body, origin = base, serverOrigin = base, host, headers = {} } = {}) {
  const segments = path.split("/");
  const dynamic = ["alerts", "teams"].includes(segments[2]) && segments[3];
  const template = dynamic ? `/api/${segments[2]}/[id]` : path;
  const { routeModule } = require(`../.next/server/app${template}/route.js`);
  const req = new NextRequest(serverOrigin + path, {
    method, headers: { ...(host ? { Host: host } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(!["GET", "HEAD"].includes(method) ? { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return routeModule.handle(req, {
    params: dynamic ? { id: segments[3] } : undefined,
    renderOpts: { supportsDynamicResponse: true, experimental: {} },
    previewProps: { previewModeId: "test", previewModeEncryptionKey: "test", previewModeSigningKey: "test" },
    sharedContext: { buildId: "test", deploymentId: "test" },
  });
}

async function login(username) {
  const response = await request("/api/auth/login", { method: "POST", body: { username, password } });
  assert.equal(response.status, 200, await response.clone().text());
  const header = response.headers.get("set-cookie");
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=lax/i);
  assert.match(header, /Max-Age=43200/i);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal((await response.json()).user.password_hash, undefined);
  return header.split(";")[0];
}

try {
  await createAccount({ username: "admin", password, name: "Test Admin", role: "admin" });
  await createAccount({ username: "operator", password, name: "Test Operator", role: "operator" });
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.match(health.headers.get("cache-control"), /no-store/);
  assert.equal((await request("/api/state")).status, 401);
  assert.equal((await request("/api/state", { cookie: "forest_session=forged" })).status, 401);
  assert.equal((await request("/api/maps")).status, 401);
  assert.equal((await request("/api/maps/archive", { headers: { Range: "bytes=0-126" } })).status, 401);
  assert.equal((await request("/api/sync", { method: "POST", body: {} })).status, 404);
  for (const origin of ["http://untrusted.invalid", null]) {
    assert.equal((await request("/api/auth/login", { method: "POST", origin, body: { username: "admin", password } })).status, 403);
  }
  assert.equal((await request("/api/auth/login", { method: "POST", body: { username: "admin", password: "incorrect" } })).status, 401);
  const adminCookie = await login("admin");
  const operatorCookie = await login("operator");
  const mapMetadata = await request("/api/maps", { cookie: operatorCookie });
  assert.equal((await mapMetadata.json()).available, true);
  const mapHeader = await request("/api/maps/archive", { cookie: operatorCookie, headers: { Range: "bytes=0-126" } });
  assert.equal(mapHeader.status, 206);
  assert.equal(Buffer.from(await mapHeader.arrayBuffer()).subarray(0, 7).toString(), "PMTiles");
  assert.equal((await request("/api/maps/archive", { cookie: operatorCookie, method: "HEAD" })).status, 200);
  assert.equal((await request("/api/maps/archive", { cookie: operatorCookie, headers: { Range: "bytes=999999999-" } })).status, 416);
  const lanLogin = await request("/api/auth/login", { method: "POST", body: { username: "admin", password }, serverOrigin: "http://0.0.0.0:3000", host: "192.168.1.50:3000", origin: "http://192.168.1.50:3000" });
  assert.equal(lanLogin.status, 200);
  assert.equal((await request("/api/auth/login", { method: "POST", body: { username: "admin", password }, serverOrigin: "http://0.0.0.0:3000", host: "192.168.1.50:3000", origin: "http://untrusted.invalid" })).status, 403);
  const initial = await request("/api/state", { cookie: operatorCookie });
  assert.equal(initial.status, 200);
  assert.match(initial.headers.get("cache-control"), /no-store/);
  const initialState = await initial.json();
  assert.equal(initialState.sensors.length, 3);
  assert.ok(initialState.sensors.every((n) => n.status === "OFFLINE"));
  assert.equal(initialState.alerts.length, 0);
  for (const path of ["/api/alerts", "/api/teams"]) {
    assert.equal((await request(path, { cookie: operatorCookie, method: "POST", body: {} })).status, 403);
  }
  assert.equal((await request("/api/settings", { cookie: operatorCookie, method: "PATCH", body: {} })).status, 403);
  assert.equal((await request("/api/settings", { cookie: adminCookie, method: "PATCH", body: { outpostName: "Persisted outpost", location: "Local watershed" } })).status, 200);
  assert.equal((await request("/api/settings", { cookie: adminCookie, method: "PATCH", body: { outpostName: "x".repeat(17000) } })).status, 413);
  assert.equal((await request("/api/settings", { cookie: adminCookie, method: "PATCH", body: [] })).status, 400);
  const added = await request("/api/teams", { cookie: adminCookie, method: "POST", body: { name: "Test patrol" } });
  assert.equal(added.status, 201);
  const team = (await added.json()).team;
  assert.equal((await request(`/api/teams/${team.id}`, { cookie: adminCookie, method: "DELETE", body: {} })).status, 200);
  const detection = await request("/api/alerts", { cookie: adminCookie, method: "POST", body: {} });
  assert.equal(detection.status, 201);
  const incident = (await detection.json()).alert;
  assert.equal(incident.source, "SIMULATION");
  assert.equal((await request(`/api/alerts/${incident.id}`, { cookie: operatorCookie, method: "PATCH", body: { action: "dispatch", teamId: "missing" } })).status, 409);
  assert.equal((await request(`/api/alerts/${incident.id}`, { cookie: operatorCookie, method: "PATCH", body: { action: "dispatch", teamId: "qrt-a" } })).status, 200);
  assert.equal((await request(`/api/alerts/${incident.id}`, { cookie: operatorCookie, method: "PATCH", body: { action: "resolve" } })).status, 200);
  const persisted = await (await request("/api/state", { cookie: operatorCookie })).json();
  assert.equal(persisted.alerts.length, 1);
  assert.equal(persisted.alerts[0].status, "RESOLVED");
  assert.equal(persisted.settings.outpostName, "Persisted outpost");
  assert.equal((await request(`/api/teams/qrt-a`, { cookie: adminCookie, method: "DELETE", body: {} })).status, 409);
  process.env.FOREST_SIMULATION_ENABLED = "false";
  assert.equal((await request("/api/alerts", { cookie: adminCookie, method: "POST", body: {} })).status, 403);
  const logout = await request("/api/auth/logout", { cookie: adminCookie, method: "POST", body: {} });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await request("/api/state", { cookie: adminCookie })).status, 401);
  assert.equal((await request("/api/state", { cookie: operatorCookie })).status, 200);
  delete process.env.FOREST_INGEST_TOKEN;
  assert.equal((await request("/api/ingest", { method: "POST", body: {} })).status, 503);
  process.env.FOREST_INGEST_TOKEN = "isolated-receiver-ingestion-token-2026";
  assert.equal((await request("/api/ingest", { method: "POST", body: {} })).status, 401);
  const ingestHeaders = { Authorization: `Bearer ${process.env.FOREST_INGEST_TOKEN}` };
  assert.equal((await request("/api/ingest", { method: "POST", headers: ingestHeaders, body: { excessive: "x".repeat(17000) } })).status, 413);
  const observation = {
    version: 1, receiver_id: "11111111-2222-4333-8444-555555555555", sequence: 1, event_id: "1", node_id: "NODE-01",
    received_at: Date.now(), gps: { fix: true, latitude: 8.4602, longitude: 124.7004 }, kind: "audio",
    classification: { probability: 0.91, threshold: 0.6, detected: true, model_sha256: "a".repeat(64) },
  };
  const accepted = await request("/api/ingest", { method: "POST", origin: null, headers: ingestHeaders, body: observation });
  assert.equal(accepted.status, 201, await accepted.clone().text());
  const acknowledgement = await accepted.json();
  assert.equal(acknowledgement.accepted, true);
  assert.equal((await request("/api/ingest", { method: "POST", headers: ingestHeaders, body: observation })).status, 200);
  assert.equal((await request("/api/ingest", { method: "POST", headers: ingestHeaders, body: { ...observation, received_at: observation.received_at - 1 } })).status, 409);
  const receivedState = await (await request("/api/state", { cookie: operatorCookie })).json();
  assert.equal(receivedState.alerts.filter((alert) => alert.source === "SENSOR").length, 1);
  assert.equal(receivedState.alerts.find((alert) => alert.id === acknowledgement.alert_id).radiusM, null);
  assert.equal(receivedState.sensors.find((sensor) => sensor.id === "NODE-01").lat, observation.gps.latitude);
  process.env.FOREST_COOKIE_SECURE = "true";
  const secureLogin = await request("/api/auth/login", { method: "POST", origin: "https://outpost.local:3000", body: { username: "admin", password } });
  assert.equal(secureLogin.status, 200);
  assert.match(secureLogin.headers.get("set-cookie"), /; Secure/i);
  process.env.FOREST_DEPLOYMENT = "cloud";
  assert.equal((await request("/api/ingest", { method: "POST", headers: ingestHeaders, body: observation })).status, 404);
  delete process.env.MONGODB_URI;
  const unavailableHealth = await request("/api/health");
  assert.equal(unavailableHealth.status, 503);
  assert.deepEqual(await unavailableHealth.json(), { status: "unavailable" });
  assert.match(unavailableHealth.headers.get("cache-control"), /no-store/);
  const originalError = console.error;
  const safeLogs = [];
  try {
    console.error = (...values) => safeLogs.push(values);
    const unavailableLogin = await request("/api/auth/login", { method: "POST", body: { username: "clouduser", password }, origin: "https://outpost.local:3000" });
    assert.equal(unavailableLogin.status, 500);
    assert.deepEqual(await unavailableLogin.json(), { error: "The cloud database is unavailable. Contact the administrator." });
    assert.ok(!JSON.stringify(safeLogs).includes("MONGODB_URI"));
    assert.ok(!JSON.stringify(safeLogs).includes(password));
  } finally { console.error = originalError; }
  assert.equal((await request("/api/sync", { method: "POST", body: {} })).status, 401);
  assert.equal((await request("/api/sync", { method: "POST", body: {}, headers: { Authorization: "Bearer isolated-test-token" } })).status, 400);
  // Supply only the read operations needed for cloud session verification.
  // Every mutation must be denied before it reaches any monitoring datastore.
  const fixtureUser = { _id: 9001, username: "cloudadmin", name: "Cloud Admin", role: "admin", passwordHash: "isolated-fixture-hash" };
  const fixtureDatabase = { async command(value) { assert.deepEqual(value, { ping: 1 }); return { ok: 1 }; }, collection(name) {
    if (name === "users") return { findOne: async () => fixtureUser };
    if (name === "sessions") return { findOne: async () => ({ userId: fixtureUser._id, credentialVersion: createHash("sha256").update(fixtureUser.passwordHash).digest("hex") }) };
    throw new Error("Cloud mutation reached a datastore instead of being rejected.");
  } };
  process.env.MONGODB_URI = fixtureMongoUri;
  (globalThis.__forestMongoClients ??= new Map()).set(fixtureMongoUri, Promise.resolve({ db: () => fixtureDatabase }));
  const cloudHealth = await request("/api/health");
  assert.equal(cloudHealth.status, 200);
  assert.deepEqual(await cloudHealth.json(), { status: "ok" });
  for (const [path, method, body] of [["/api/settings", "PATCH", {}], ["/api/teams", "POST", {}], ["/api/teams/qrt-a", "DELETE", {}], ["/api/alerts", "POST", {}], ["/api/alerts/001", "PATCH", { action: "dispatch" }]]) {
    const denied = await request(path, { method, body, cookie: `forest_session=${"x".repeat(43)}`, origin: "https://outpost.local:3000" });
    assert.equal(denied.status, 403, await denied.clone().text());
    assert.match((await denied.json()).error, /read-only/);
  }
  globalThis.__forestMongoClients.delete(fixtureMongoUri);
  delete process.env.FOREST_DEPLOYMENT;
  console.log("Compiled API integration checks passed: login/logout cookies, CSRF, roles, validation, persistence, incident actions, offline map authorization/ranges, and sync boundary validation.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  delete process.env.FOREST_DEPLOYMENT;
  globalThis.__forestMongoClients?.delete(fixtureMongoUri);
  if (originalMongoUri === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = originalMongoUri;
  if (originalIngestToken === undefined) delete process.env.FOREST_INGEST_TOKEN; else process.env.FOREST_INGEST_TOKEN = originalIngestToken;
  getDatabase().close();
  const absolute = resolve(directory);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + sep) && basename(absolute).startsWith("forest-monitor-routes-"));
  rmSync(absolute, { recursive: true, force: true });
}
