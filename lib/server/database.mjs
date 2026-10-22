import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { migrateSync } from "./sync/local.mjs";
import { isCloud } from "./deployment.mjs";

// One connection per process, including across Next.js development reloads.
const connections = globalThis.__forestDatabases ??= new Map();

export function getDatabase() {
  if (isCloud()) throw new Error("SQLite is not available in cloud mode. Configure MongoDB instead.");
  const path = resolve(process.env.FOREST_DATABASE_PATH || "data/forest-monitor.sqlite");
  if (connections.has(path)) { const cached = connections.get(path); migrateSync(cached); return cached; }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS login_attempts (
      key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, started_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS configuration (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sensors (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL,
      status TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS incidents_time ON incidents(timestamp DESC);
    CREATE TABLE IF NOT EXISTS node_events (
      id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL,
      actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL, details TEXT NOT NULL
    );
  `);
  migrateSync(db);
  connections.set(path, db);
  return db;
}

export function transaction(callback) {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function audit(db, actorId, action, details) {
  db.prepare("INSERT INTO audit_log (timestamp, actor_id, action, details) VALUES (?, ?, ?, ?)")
    .run(Date.now(), actorId, action, JSON.stringify(details));
}
