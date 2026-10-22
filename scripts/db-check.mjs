// Read-only diagnostics. Credentials travel in a private file/process environment,
// never in command arguments, logs or generated reports.
import { Resolver } from "node:dns/promises";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { MongoClient } from "mongodb";
import { cloudConfiguration, databaseFailure } from "../lib/server/cloud/connection-check.mjs";
import { cloudClient, cloudDatabase, closeCloudConnections } from "../lib/server/cloud/database.mjs";
import { accountCount } from "../lib/server/cloud/accounts.mjs";
import { cloudState } from "../lib/server/cloud/mirror.mjs";

const report = {
  environment: { status: "not_checked" },
  shell: { status: "not_checked" },
  dns: { status: "not_checked" },
  network: { status: "not_checked" },
  authentication: { status: "not_checked" },
  authorization: { status: "not_checked" },
  application: { status: "not_checked" },
  shellPing: { status: "not_checked" },
};
const print = () => console.log(JSON.stringify(report, null, 2));
const deadline = setTimeout(() => {
  report.deadline = { status: "failed", category: "timeout" };
  print();
  process.exit(1);
}, 45000);

function command(executable, args, env = process.env, timeout = 16000) {
  return new Promise((resolve) => {
    let stdout = "";
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, category: "timeout" }); }, timeout);
    child.stdout.on("data", (chunk) => { if (stdout.length < 10000) stdout += chunk; });
    // Capture neither raw driver stderr nor URI-bearing shell error messages.
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); resolve({ ok: false, category: "unavailable" }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, stdout }); });
  });
}

function tcp(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => finish({ reachable: false, category: "timeout" }), 3000);
    function finish(value) { clearTimeout(timer); socket.destroy(); resolve(value); }
    socket.once("connect", () => finish({ reachable: true }));
    socket.once("error", (error) => finish({ reachable: false, ...databaseFailure(error) }));
  });
}

async function dnsCheck(host, operation = "resolve4") {
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  const timer = setTimeout(() => resolver.cancel(), 3000);
  try { return { status: "ok", records: await resolver[operation](host) }; }
  catch (error) { return { status: "failed", ...databaseFailure(error) }; }
  finally { clearTimeout(timer); resolver.cancel(); }
}

async function check() {
  const windowsRoots = [process.env.LOCALAPPDATA, join(homedir(), "AppData", "Local")].filter(Boolean);
  const candidates = ["mongosh", ...(process.platform === "win32" ? windowsRoots.flatMap((root) => [join(root, "Programs", "mongosh", "mongosh.exe"), join(root, "Programs", "mongosh", "bin", "mongosh.exe")]) : [])];
  let shell;
  for (const candidate of candidates) {
    if (candidate !== "mongosh" && !existsSync(candidate)) continue;
    const version = await command(candidate, ["--version"], process.env, 3000);
    if (version.ok && /^\d+\.\d+\.\d+[\w.-]*$/.test(version.stdout.trim())) {
      shell = candidate;
      report.shell = { status: "ok", version: version.stdout.trim() };
      break;
    }
  }
  if (!shell) report.shell = { status: "unavailable", action: "Install MongoDB Shell or reopen the terminal to refresh PATH." };

  let config;
  let parser;
  try {
    config = cloudConfiguration();
    parser = new MongoClient(config.uri);
    report.environment = { status: "ok", database: config.database, srv: Boolean(parser.options.srvHost), credentialsPresent: Boolean(parser.options.credentials) };
  } catch (error) {
    report.environment = { status: "failed", ...databaseFailure(error), action: "Set a complete MONGODB_URI in .env.cloud.local; leave the Pi's .env.local in local mode." };
  }

  const publicDns = await Promise.all(["mongodb.com", "google.com"].map((host) => dnsCheck(host)));
  report.dns = { publicMongoDB: publicDns[0].status, publicGoogle: publicDns[1].status, atlas: "not_checked" };
  if (publicDns.some((entry) => entry.status !== "ok")) report.dns.publicFailures = publicDns.map((entry, index) => ({ target: ["mongodb.com", "google.com"][index], status: entry.status, category: entry.category, code: entry.code }));
  if (!config || !parser) return;

  let hosts;
  if (parser.options.srvHost) {
    const [srv, txt] = await Promise.all([
      dnsCheck(`_${parser.options.srvServiceName}._tcp.${parser.options.srvHost}`, "resolveSrv"),
      dnsCheck(parser.options.srvHost, "resolveTxt"),
    ]);
    report.dns.atlas = srv.status;
    report.dns.srv = srv.status;
    // Missing optional TXT records are valid; resolver failures are distinct.
    report.dns.txt = txt.status === "ok" || ["ENODATA", "ENOTFOUND"].includes(txt.code) ? "ok" : "failed";
    if (srv.status !== "ok") { report.dns.failure = { category: srv.category, code: srv.code }; return; }
    hosts = srv.records.map((record) => ({ host: record.name, port: record.port }));
  } else {
    hosts = parser.options.hosts.map((address) => ({ host: address.host, port: address.port }));
    const lookups = await Promise.all(hosts.map(({ host }) => dnsCheck(host)));
    report.dns.atlas = lookups.every((entry) => entry.status === "ok") ? "ok" : "failed";
  }
  const probes = await Promise.all(hosts.slice(0, 3).map(({ host, port }) => tcp(host, port)));
  report.network = { status: probes.some((result) => result.reachable) ? "ok" : "failed", testedHosts: probes.length, reachableHosts: probes.filter((result) => result.reachable).length };
  if (!probes.some((result) => result.reachable)) { report.network.failures = probes.map(({ category, code }) => ({ category, code })); return; }

  // Run the independent Shell check even when the application's driver later
  // fails authentication or collection authorization.
  if (shell) {
    const shellResult = await command(shell, ["--nodb", "--quiet", "--eval", 'try { const c = new Mongo(process.env.FOREST_CHECK_URI); const r = c.getDB(process.env.FOREST_CHECK_DATABASE).runCommand({ping:1}); print(JSON.stringify({forestPing:r.ok})); } catch { print(JSON.stringify({forestPing:0})); exit(1); }'], { ...process.env, FOREST_CHECK_URI: config.uri, FOREST_CHECK_DATABASE: config.database });
    report.shellPing = { status: shellResult.ok && shellResult.stdout.includes('"forestPing":1') ? "ok" : "failed" };
  }
  const db = await cloudDatabase();
  await db.command({ ping: 1 }, { timeoutMS: 5000 });
  // Establishing a driver connection authenticates configured credentials; ping
  // alone on a server without access control does not establish authentication.
  const client = await cloudClient();
  report.authentication = { status: client.options.credentials ? "ok" : "not_verified" };
  const permissions = await db.command({ connectionStatus: 1, showPrivileges: true }, { timeoutMS: 5000 });
  const grants = permissions.authInfo?.authenticatedUserPrivileges || [];
  const actions = new Set(grants.filter((grant) => grant.resource?.anyResource || (grant.resource?.db === config.database || grant.resource?.db === "") && (grant.resource?.collection === "" || grant.resource?.collection === undefined)).flatMap((grant) => grant.actions));
  // Use actual application read operations without creating sample documents.
  await db.collection("devices").findOne({}, { projection: { _id: 1 }, timeoutMS: 5000 });
  await accountCount();
  report.authorization = { status: "ok", readsVerified: true, requiredWriteGrants: ["insert", "update", "remove", "createIndex"].every((action) => actions.has(action)), writesExecuted: false };
  if (process.env.FOREST_CLOUD_DEVICE_ID) {
    try {
      await cloudState();
      report.application = { status: "ok", dashboardStateVerified: true };
    } catch (error) { report.application = { status: "failed", ...databaseFailure(error) }; }
  } else {
    report.application = { status: "incomplete", readsVerified: true, action: "Register the actual Pi device and set FOREST_CLOUD_DEVICE_ID before using the remote dashboard." };
  }
  await parser.close();
}

try { await check(); }
catch (error) {
  const failure = databaseFailure(error);
  if (report.authentication.status === "not_checked") report.authentication = { status: failure.category === "authentication" ? "failed" : "not_verified", ...failure };
  else report.authorization = { status: "failed", ...failure };
}
finally {
  await closeCloudConnections();
  clearTimeout(deadline);
  print();
  if (report.authentication.status !== "ok" || report.authorization.status !== "ok" || !report.authorization.requiredWriteGrants || report.application.status !== "ok" || report.shellPing.status !== "ok") process.exitCode = 1;
  // A system DNS request may outlive its caller's deadline. Do not let detached
  // driver discovery keep this diagnostic command alive indefinitely.
  setTimeout(() => process.exit(process.exitCode || 0), 1000).unref();
}
