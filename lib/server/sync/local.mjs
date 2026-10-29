import { randomUUID } from "node:crypto";

// Migration is called by the local database only. Every source write and its
// outbox entry share the same SQLite transaction, including deletions.
export function migrateSync(db) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 3) throw new Error("This database was created by a newer application version.");
  if (version === 3) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    // App and upload service may boot together. Another process can finish
    // migration while this connection waits for SQLite's write lock.
    const lockedVersion = db.prepare("PRAGMA user_version").get().user_version;
    if (lockedVersion > 3) throw new Error("This database was created by a newer application version.");
    if (lockedVersion === 3) { db.exec("COMMIT"); return; }
    if (lockedVersion < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_meta (
        id INTEGER PRIMARY KEY CHECK(id = 1), device_id TEXT NOT NULL,
        ack_seq INTEGER NOT NULL DEFAULT 0, last_synced_at INTEGER,
        last_error TEXT, lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sync_outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL,
        entity_id TEXT NOT NULL, operation TEXT NOT NULL, payload TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS outbox_entity ON sync_outbox(entity, entity_id);
    `);
    db.prepare("INSERT OR IGNORE INTO sync_meta(id, device_id) VALUES (1, ?)").run(randomUUID());
    for (const [table, entity] of [["incidents", "incident"], ["sensors", "sensor"], ["teams", "team"], ["node_events", "node_event"]]) {
      const condition = table === "incidents" ? "AND json_extract(NEW.payload, '$.id') IS NOT NULL" : "";
      for (const operation of ["INSERT", "UPDATE"]) {
        db.exec(`CREATE TRIGGER IF NOT EXISTS sync_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table}
          WHEN json_valid(NEW.payload) ${condition}
          BEGIN INSERT INTO sync_outbox(entity, entity_id, operation, payload) VALUES ('${entity}', CAST(NEW.id AS TEXT), 'upsert', NEW.payload); END;`);
      }
      db.exec(`CREATE TRIGGER IF NOT EXISTS sync_${table}_delete AFTER DELETE ON ${table}
        BEGIN INSERT INTO sync_outbox(entity, entity_id, operation, payload) VALUES ('${entity}', CAST(OLD.id AS TEXT), 'delete', NULL); END;`);
      db.exec(`INSERT INTO sync_outbox(entity, entity_id, operation, payload)
        SELECT '${entity}', CAST(id AS TEXT), 'upsert', payload FROM ${table} WHERE json_valid(payload) ${table === "incidents" ? "AND json_extract(payload, '$.id') IS NOT NULL" : ""};`);
    }
    for (const operation of ["INSERT", "UPDATE"]) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS sync_settings_${operation.toLowerCase()} AFTER ${operation} ON configuration WHEN NEW.key = 'settings'
        BEGIN INSERT INTO sync_outbox(entity, entity_id, operation, payload) VALUES ('settings', 'outpost', 'upsert', NEW.value); END;`);
    }
    db.exec("INSERT INTO sync_outbox(entity, entity_id, operation, payload) SELECT 'settings', 'outpost', 'upsert', value FROM configuration WHERE key = 'settings'; PRAGMA user_version = 2;");
    }
    db.exec(`
      CREATE TABLE ingestion_receipts (
        node_id TEXT NOT NULL, event_id TEXT NOT NULL, digest TEXT NOT NULL,
        alert_id TEXT, received_at INTEGER NOT NULL, receiver_id TEXT NOT NULL, sequence INTEGER NOT NULL,
        PRIMARY KEY (node_id, event_id), UNIQUE(receiver_id, sequence)
      );
      PRAGMA user_version = 3;
      COMMIT;
    `);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function localSyncStatus(db) {
  const meta = db.prepare("SELECT device_id, ack_seq, last_synced_at, last_error FROM sync_meta WHERE id = 1").get();
  return { deviceId: meta.device_id, pending: Number(db.prepare("SELECT COUNT(*) AS count FROM sync_outbox").get().count), lastSyncedAt: meta.last_synced_at, error: meta.last_error, enabled: Boolean(process.env.FOREST_SYNC_URL && process.env.FOREST_SYNC_TOKEN) };
}

export function nextBatch(db) {
  const meta = db.prepare("SELECT * FROM sync_meta WHERE id = 1").get();
  const events = [];
  let size = 0;
  for (const row of db.prepare("SELECT * FROM sync_outbox ORDER BY seq LIMIT 64").all()) {
    const event = { seq: row.seq, entity: row.entity, id: row.entity_id, operation: row.operation, payload: row.payload ? JSON.parse(row.payload) : null };
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (bytes > 180000) throw new Error("A queued record exceeds the cloud synchronization limit.");
    if (size + bytes > 220000 && events.length) break;
    size += bytes;
    events.push(event);
  }
  return { version: 1, deviceId: meta.device_id, afterSeq: meta.ack_seq, events };
}
