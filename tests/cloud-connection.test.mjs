import test from "node:test";
import assert from "node:assert/strict";
import { cloudConfiguration, databaseFailure, connectWithDeadline, CloudDatabaseError } from "../lib/server/cloud/connection-check.mjs";
import { cloudClient, closeCloudConnections } from "../lib/server/cloud/database.mjs";
import { MongoClient } from "mongodb";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename, sep } from "node:path";

test("cloud configuration fails clearly without credentials and rejects placeholders and invalid database names", () => {
  for (const uri of [undefined, "", "https://private:secret@example.test", "mongodb+srv://user:<password>@cluster.example.test/"]) {
    assert.throws(() => cloudConfiguration({ MONGODB_URI: uri }), { name: "CloudConfigurationError" });
  }
  assert.throws(() => cloudConfiguration({ MONGODB_URI: "mongodb://localhost", MONGODB_DATABASE: "invalid/database" }), /database name/);
  assert.equal(cloudConfiguration({ MONGODB_URI: "mongodb://localhost" }).database, "forest_monitor");
});

test("diagnostic failures distinguish authentication, authorization, DNS, TLS and network without copying secrets", () => {
  const secret = "mongodb+srv://private:NeverExposeThis@private-host.example/";
  const cases = [[18, "authentication"], [13, "authorization"], ["ETIMEOUT", "dns"], ["ENOTFOUND", "dns"], ["EACCES", "network"], ["CERT_HAS_EXPIRED", "tls"]];
  for (const [code, category] of cases) {
    const error = Object.assign(new Error(secret), { code });
    assert.equal(databaseFailure(error).category, category);
    assert.ok(!JSON.stringify(databaseFailure(error)).includes("private"));
    const safe = new CloudDatabaseError(error);
    assert.equal(databaseFailure(safe).category, category);
    assert.ok(!safe.stack.includes(secret));
    assert.ok(!JSON.stringify(safe).includes(secret));
  }
  const nested = { name: "MongoServerSelectionError", reason: { servers: new Map([["private-host", { error: { cause: { code: "ECONNREFUSED" } } }]]) } };
  assert.deepEqual(databaseFailure(nested), { category: "network", code: "ECONNREFUSED" });
  assert.deepEqual(databaseFailure({ name: secret, code: secret, message: secret }), { category: "database" });
});

test("the connection deadline closes a late connection instead of leaving an uncached pool running", async () => {
  let finish;
  let closes = 0;
  const client = { connect: () => new Promise((resolve) => { finish = resolve; }), close: async () => { closes++; } };
  await assert.rejects(connectWithDeadline(client, 10), { name: "CloudConnectionTimeoutError" });
  assert.equal(closes, 1);
  finish(client);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closes, 2);
});

test("connection success remains open for reuse and failed attempts release their resources", async () => {
  let closes = 0;
  const client = { connect: async () => client, close: async () => { closes++; } };
  assert.equal(await connectWithDeadline(client, 1000), client);
  assert.equal(closes, 0);
  const failing = { connect: async () => { throw Object.assign(new Error("private details"), { code: 18 }); }, close: async () => { closes++; } };
  await assert.rejects(connectWithDeadline(failing, 1000), { code: 18 });
  assert.equal(closes, 1);
});

test("invalid driver options do not leak the configured URI or poison the process cache", async () => {
  const original = process.env.MONGODB_URI;
  const uri = "mongodb://private:NeverExposeThis@localhost/?forestUnsupportedOption=true";
  process.env.MONGODB_URI = uri;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(cloudClient(), (error) => {
        assert.equal(databaseFailure(error).category, "configuration");
        assert.ok(!error.stack.includes("NeverExposeThis"));
        assert.equal(globalThis.__forestMongoClients.has(uri), false);
        return true;
      });
    }
  } finally {
    if (original === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = original;
  }
});

test("concurrent requests share one pool and a rejected connection can be retried", async (t) => {
  const original = process.env.MONGODB_URI;
  const uri = "mongodb://connection-cache-fixture.invalid/";
  process.env.MONGODB_URI = uri;
  let attempts = 0;
  let fail = false;
  t.mock.method(MongoClient.prototype, "connect", async function () {
    attempts++;
    if (fail) throw Object.assign(new Error("private driver details"), { code: 18 });
    return this;
  });
  t.mock.method(MongoClient.prototype, "close", async () => {});
  try {
    const [first, second] = await Promise.all([cloudClient(), cloudClient()]);
    assert.equal(first, second);
    assert.equal(attempts, 1);
    await closeCloudConnections();
    fail = true;
    await assert.rejects(cloudClient(), (error) => databaseFailure(error).category === "authentication");
    assert.equal(globalThis.__forestMongoClients.has(uri), false);
    fail = false;
    await cloudClient();
    assert.equal(attempts, 3);
  } finally {
    await closeCloudConnections();
    if (original === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = original;
  }
});

test("cloud account provisioning refuses local mode before creating a database or account", () => {
  const directory = mkdtempSync(join(tmpdir(), "forest-cloud-guard-"));
  const database = join(directory, "must-not-exist.sqlite");
  try {
    const child = spawnSync(process.execPath, ["scripts/account.mjs", "--cloud", "--username", "guard", "--name", "Guard", "--role", "admin", "--generate-password"], {
      env: { ...process.env, FOREST_DEPLOYMENT: "local", VERCEL: "0", FOREST_DATABASE_PATH: database },
      encoding: "utf8", timeout: 5000, windowsHide: true,
    });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /require FOREST_DEPLOYMENT=cloud/);
    assert.equal(existsSync(database), false);
    assert.ok(!child.stdout.includes("Generated password"));
  } finally {
    const absolute = resolve(directory);
    assert.ok(absolute.startsWith(resolve(tmpdir()) + sep) && basename(absolute).startsWith("forest-cloud-guard-"));
    rmSync(absolute, { recursive: true, force: true });
  }
});
