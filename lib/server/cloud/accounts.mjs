import { createHash, randomBytes } from "node:crypto";
import { cloudDatabase } from "./database.mjs";
import { validateAccount, hashPassword, verifyPassword, SESSION_SECONDS } from "../accounts.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const publicUser = (user) => user ? { id: user._id, username: user.username, name: user.name, role: user.role } : null;

export async function createAccount({ username, password, name, role = "operator" }) {
  validateAccount(username, password, name, role);
  const db = await cloudDatabase();
  const user = { _id: randomBytes(6).readUIntBE(0, 6), username: username.toLowerCase(), name: name.trim(), role, passwordHash: await hashPassword(password) };
  await db.collection("users").insertOne(user);
  return publicUser(user);
}
export async function accountCount() { return (await cloudDatabase()).collection("users").countDocuments({}); }

export async function authenticate(username, password) {
  if (typeof username !== "string" || typeof password !== "string" || username.length > 40 || password.length > 128) return { status: 401, error: "Invalid username or password." };
  const db = await cloudDatabase();
  const normalized = username.trim().toLowerCase();
  const now = new Date();
  for (const [key, limit] of [["global", 60], [digest(normalized), 5]]) {
    await db.collection("login_attempts").deleteOne({ _id: key, expiresAt: { $lte: now } });
    const attempt = await db.collection("login_attempts").findOneAndUpdate({ _id: key }, { $inc: { attempts: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + 900000) } }, { upsert: true, returnDocument: "after" });
    if (attempt.attempts > limit) return { status: 429, error: "Too many sign-in attempts. Try again in 15 minutes." };
  }
  const user = await db.collection("users").findOne({ username: normalized });
  const matches = await verifyPassword(password, user?.passwordHash);
  if (!user || !matches) return { status: 401, error: "Invalid username or password." };
  await db.collection("login_attempts").deleteOne({ _id: digest(normalized) });
  const token = randomBytes(32).toString("base64url");
  await db.collection("sessions").insertOne({ _id: digest(token), userId: user._id, credentialVersion: digest(user.passwordHash), expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000) });
  return { status: 200, user: publicUser(user), token };
}

export async function getSessionUser(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = await cloudDatabase();
  const session = await db.collection("sessions").findOne({ _id: digest(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  const user = await db.collection("users").findOne({ _id: session.userId });
  return user && session.credentialVersion === digest(user.passwordHash) ? publicUser(user) : null;
}
export async function revokeSession(token) { if (token) await (await cloudDatabase()).collection("sessions").deleteOne({ _id: digest(token) }); }
export async function resetPassword(username, password) {
  validateAccount(username, password, username, "operator");
  const db = await cloudDatabase();
  const user = await db.collection("users").findOneAndUpdate({ username: username.toLowerCase() }, { $set: { passwordHash: await hashPassword(password) } }, { returnDocument: "after" });
  if (!user) throw new Error("Account not found.");
  await db.collection("sessions").deleteMany({ userId: user._id });
  await db.collection("login_attempts").deleteOne({ _id: digest(username.toLowerCase()) });
}
