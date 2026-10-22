import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { getDatabase, transaction, audit } from "./database.mjs";

const derive = promisify(scrypt);
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
export const SESSION_SECONDS = 12 * 60 * 60;
const WINDOW_MS = 15 * 60 * 1000;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const publicUser = (row) => row ? { id: Number(row.id), username: row.username, name: row.name, role: row.role } : null;

export function validateAccount(username, password, name, role) {
  if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
    throw new Error("Username must contain 3–40 letters, numbers, dots, underscores, or hyphens.");
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw new Error("Use a password between 12 and 128 characters.");
  }
  if (typeof name !== "string" || !name.trim() || name.length > 80) throw new Error("Enter a name of at most 80 characters.");
  if (!["admin", "operator"].includes(role)) throw new Error("Role must be admin or operator.");
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [, salt, hash] = (stored || "scrypt:00000000000000000000000000000000:" + "0".repeat(128)).split(":");
  const key = await derive(password, salt, 64, SCRYPT_OPTIONS);
  const expected = Buffer.from(hash, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export async function createAccount({ username, password, name, role = "operator" }) {
  validateAccount(username, password, name, role);
  const hash = await hashPassword(password);
  return transaction((db) => {
    const result = db.prepare("INSERT INTO users (username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(username.toLowerCase(), name.trim(), hash, role, Date.now());
    const id = Number(result.lastInsertRowid);
    audit(db, id, "ACCOUNT_CREATED", { username: username.toLowerCase(), role });
    return publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
  });
}

export function accountCount() {
  return Number(getDatabase().prepare("SELECT COUNT(*) AS count FROM users").get().count);
}

export async function authenticate(username, password) {
  if (typeof username !== "string" || typeof password !== "string" || username.length > 40 || password.length > 128) {
    return { error: "Invalid username or password.", status: 401 };
  }
  const normalized = username.trim().toLowerCase();
  const key = digest(normalized);
  const now = Date.now();
  const allowed = transaction((db) => {
    db.prepare("DELETE FROM login_attempts WHERE started_at < ?").run(now - WINDOW_MS);
    for (const [attemptKey, limit] of [["global", 60], [key, 5]]) {
      const entry = db.prepare("SELECT attempts FROM login_attempts WHERE key = ?").get(attemptKey);
      if (entry && entry.attempts >= limit) return false;
    }
    for (const attemptKey of ["global", key]) {
      db.prepare("INSERT INTO login_attempts (key, attempts, started_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1").run(attemptKey, now);
    }
    return true;
  });
  if (!allowed) return { error: "Too many sign-in attempts. Try again in 15 minutes.", status: 429 };
  const row = getDatabase().prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(normalized);
  const matches = await verifyPassword(password, row?.password_hash);
  if (!row || !matches) return { error: "Invalid username or password.", status: 401 };
  return transaction((db) => {
    const current = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(row.id);
    if (current?.password_hash !== row.password_hash) return { error: "Invalid username or password.", status: 401 };
    db.prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    const token = randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(digest(token), row.id, now + SESSION_SECONDS * 1000);
    audit(db, row.id, "SIGNED_IN", {});
    return { user: publicUser(row), token, status: 200 };
  });
}

export function getSessionUser(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = getDatabase().prepare(`
    SELECT u.* FROM users u JOIN sessions s ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(digest(token), Date.now());
  return publicUser(row);
}

export function revokeSession(token) {
  if (token) getDatabase().prepare("DELETE FROM sessions WHERE token_hash = ?").run(digest(token));
}

export async function resetPassword(username, password) {
  validateAccount(username, password, username, "operator");
  const hash = await hashPassword(password);
  transaction((db) => {
    const user = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username);
    if (!user) throw new Error("Account not found.");
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM login_attempts WHERE key = ?").run(digest(username.toLowerCase()));
    audit(db, user.id, "PASSWORD_RESET", {});
  });
}
