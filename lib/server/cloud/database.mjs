import { MongoClient } from "mongodb";

const clients = globalThis.__forestMongoClients ??= new Map();
export async function cloudClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI must be configured for the cloud deployment.");
  if (!clients.has(uri)) {
    const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
    const connection = client.connect().catch((error) => { clients.delete(uri); throw error; });
    clients.set(uri, connection);
  }
  return clients.get(uri);
}
export async function cloudDatabase() { return (await cloudClient()).db(process.env.MONGODB_DATABASE || "forest_monitor"); }

export async function closeCloudConnections() {
  const connections = [...clients.values()];
  clients.clear();
  await Promise.all(connections.map(async (connection) => { try { await (await connection).close(); } catch { /* Failed connections are already closed. */ } }));
}

export async function createCloudIndexes() {
  const db = await cloudDatabase();
  await Promise.all([
    db.collection("users").createIndex({ username: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("login_attempts").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("mirror").createIndex({ deviceId: 1, entity: 1, deleted: 1, "payload.timestamp": -1 }),
  ]);
}
