// Run after `npm run build`: exercises the actual production server, not mocked handlers.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, basename, sep } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createAccount } from "../lib/server/accounts.mjs";
import { getDatabase } from "../lib/server/database.mjs";

const directory = mkdtempSync(join(tmpdir(), "forest-monitor-http-"));
process.env.FOREST_DATABASE_PATH = join(directory, "outpost.sqlite");
const password = "Isolated HTTP test password 2026";
let child;
let logs = "";
let base;

async function start(simulation) {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  logs = "";
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(), env: { ...process.env, FOREST_SIMULATION_ENABLED: String(simulation), FOREST_COOKIE_SECURE: "false", NEXT_TELEMETRY_DISABLED: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  const deadline = Date.now() + 45000;
  let lastFailure = "No response";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Production server exited: ${logs}`);
    try { const response = await fetch(base, { signal: AbortSignal.timeout(2000) }); if (response.ok) return; lastFailure = `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`; }
    catch (error) { lastFailure = `${error.message}: ${error.cause?.message || ""}`; }
    await delay(200);
  }
  throw new Error(`Production server did not respond (${lastFailure}): ${logs}`);
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  const ended = once(child, "exit");
  child.kill();
  await ended;
}

function request(path, { cookie, method = "GET", body, origin = base } = {}) {
  return fetch(base + path, { method, redirect: "manual", signal: AbortSignal.timeout(15000), headers: {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(method !== "GET" ? { Origin: origin, "Content-Type": "application/json" } : {}),
  }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function login(username) {
  const response = await request("/api/auth/login", { method: "POST", body: { username, password } });
  assert.equal(response.status, 200, await response.clone().text());
  const header = response.headers.get("set-cookie");
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=lax/i);
  assert.match(header, /Max-Age=43200/i);
  const user = (await response.json()).user;
  assert.equal(user.password_hash, undefined);
  return header.split(";")[0];
}

try {
  await createAccount({ username: "admin", password, name: "Test Admin", role: "admin" });
  await createAccount({ username: "operator", password, name: "Test Operator", role: "operator" });
  await start(true);
  const landing = await (await request("/")).text();
  assert.ok(landing.includes("Sign in to outpost"));
  assert.ok(!landing.includes("Continue with Google"));
  assert.equal((await request("/dashboard")).status, 307);
  assert.equal((await request("/api/state")).status, 401);
  assert.equal((await request("/api/auth/login", { method: "POST", origin: "http://other-site.invalid", body: { username: "admin", password } })).status, 403);
  assert.equal((await request("/api/auth/login", { method: "POST", body: { username: "admin", password: "incorrect" } })).status, 401);

  let adminCookie = await login("admin");
  const operatorCookie = await login("operator");
  assert.equal((await request("/", { cookie: adminCookie })).status, 307);
  const initialResponse = await request("/api/state", { cookie: adminCookie });
  assert.match(initialResponse.headers.get("cache-control"), /no-store/);
  const initial = await initialResponse.json();
  assert.equal(initial.alerts.length, 0);
  assert.equal(initial.sensors.length, 3);
  assert.ok(initial.sensors.every((n) => n.status === "OFFLINE"));
  assert.equal((await request("/api/alerts", { cookie: operatorCookie, method: "POST", body: {} })).status, 403);
  assert.equal((await request("/api/settings", { cookie: operatorCookie, method: "PATCH", body: {} })).status, 403);
  assert.equal((await request("/api/teams", { cookie: operatorCookie, method: "POST", body: { name: "Unauthorized" } })).status, 403);
  assert.equal((await request("/api/settings", { cookie: adminCookie, method: "PATCH", body: { outpostName: "Persisted Outpost", location: "Offline forest" } })).status, 200);
  assert.equal((await request("/api/settings", { cookie: adminCookie, method: "PATCH", body: { outpostName: "x".repeat(17000) } })).status, 413);
  assert.equal((await request("/api/settings", { cookie: adminCookie, method: "PATCH", body: [] })).status, 400);

  const added = await request("/api/teams", { cookie: adminCookie, method: "POST", body: { name: "Temporary patrol" } });
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
  const details = await request(`/incidents/${incident.id}`, { cookie: adminCookie });
  assert.equal(details.status, 200);
  assert.ok((await details.text()).includes(incident.code));
  for (const path of ["/dashboard", "/alerts", "/sensor-nodes", "/reports", "/settings"]) {
    assert.equal((await request(path, { cookie: operatorCookie })).status, 200, path);
  }
  assert.equal((await request("/api/auth/logout", { cookie: adminCookie, method: "POST", body: {} })).status, 200);
  assert.equal((await request("/api/state", { cookie: adminCookie })).status, 401);

  await stop();
  await start(false);
  const restored = await (await request("/api/state", { cookie: operatorCookie })).json();
  assert.equal(restored.settings.outpostName, "Persisted Outpost");
  assert.equal(restored.alerts.length, 1);
  assert.equal(restored.alerts[0].status, "RESOLVED");
  assert.equal(restored.simulationEnabled, false);
  adminCookie = await login("admin");
  assert.equal((await request("/api/alerts", { cookie: adminCookie, method: "POST", body: {} })).status, 403);
  assert.ok(!logs.includes("Error:"), logs);
  console.log("Production HTTP checks passed: local login/logout, CSRF, roles, validation, persistent shared records, incident routes, server restart, and simulation disabled by default.");
} catch (error) {
  console.error(error);
  console.error(logs);
  process.exitCode = 1;
} finally {
  await stop();
  getDatabase().close();
  const absolute = resolve(directory);
  assert.ok(absolute.startsWith(resolve(tmpdir()) + sep) && basename(absolute).startsWith("forest-monitor-http-"));
  rmSync(absolute, { recursive: true, force: true });
}
