import { randomUUID } from "node:crypto";
import { getDatabase, transaction } from "../database.mjs";
import { nextBatch } from "./local.mjs";

const INFLIGHT_KEY = "sync_inflight";

export async function syncOnce({ fetchImpl = fetch } = {}) {
  const url = process.env.FOREST_SYNC_URL;
  const token = process.env.FOREST_SYNC_TOKEN;
  if (!url || !token) return { configured: false, uploaded: 0 };
  if (new URL(url).protocol !== "https:" || token.length < 32) throw new Error("Synchronization requires an HTTPS endpoint and a strong per-device token.");
  const owner = randomUUID();
  const now = Date.now();
  const leased = transaction((db) => db.prepare("UPDATE sync_meta SET lease_owner = ?, lease_until = ? WHERE id = 1 AND (lease_until <= ? OR lease_until > ?)").run(owner, now + 90000, now, now + 120000).changes);
  if (!leased) return { configured: true, uploaded: 0, busy: true };
  try {
    const body = transaction((db) => {
      const status = db.prepare("SELECT lease_owner, last_synced_at FROM sync_meta WHERE id = 1").get();
      if (status.lease_owner !== owner) throw new Error("Synchronization lease expired before upload.");
      // Freeze the exact request durably before sending it. New local writes
      // must not change a retry after the cloud has committed but its reply
      // was lost, including when the worker process has restarted.
      const saved = db.prepare("SELECT value FROM configuration WHERE key = ?").get(INFLIGHT_KEY);
      if (saved) return saved.value;
      const batch = nextBatch(db);
      const elapsed = now - status.last_synced_at;
      if (!batch.events.length && status.last_synced_at && elapsed >= 0 && elapsed < 60000) return null;
      const value = JSON.stringify(batch);
      // Internal configuration keys do not enter the telemetry outbox.
      db.prepare("INSERT INTO configuration(key, value) VALUES (?, ?)").run(INFLIGHT_KEY, value);
      return value;
    });
    if (body === null) return { configured: true, uploaded: 0 };
    const batch = JSON.parse(body);
    const response = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Forest-Device": batch.deviceId }, body, signal: AbortSignal.timeout(25000), redirect: "error" });
    if (!response.ok) throw new Error(response.status === 409 ? "Cloud history differs from this device. Resolve the device identity or restore before retrying." : `Cloud synchronization returned HTTP ${response.status}.`);
    const result = await response.json();
    if (result.ackSeq !== (batch.events.at(-1)?.seq ?? batch.afterSeq)) throw new Error("The cloud acknowledgment did not match the uploaded batch.");
    transaction((db) => {
      const lock = db.prepare("SELECT lease_owner FROM sync_meta WHERE id = 1").get();
      if (lock.lease_owner !== owner) throw new Error("Synchronization lease expired before acknowledgment.");
      db.prepare("DELETE FROM sync_outbox WHERE seq <= ?").run(result.ackSeq);
      db.prepare("UPDATE sync_meta SET ack_seq = ?, last_synced_at = ?, last_error = NULL WHERE id = 1").run(result.ackSeq, Date.now());
      db.prepare("DELETE FROM configuration WHERE key = ?").run(INFLIGHT_KEY);
    });
    return { configured: true, uploaded: batch.events.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getDatabase().prepare("UPDATE sync_meta SET last_error = ? WHERE id = 1 AND lease_owner = ?").run(message.slice(0, 300), owner);
    throw error;
  } finally {
    getDatabase().prepare("UPDATE sync_meta SET lease_owner = NULL, lease_until = 0 WHERE id = 1 AND lease_owner = ?").run(owner);
  }
}
