import { MongoClient } from "mongodb";
import { cloudConfiguration, connectWithDeadline, CloudDatabaseError } from "./connection-check.mjs";

const clients = globalThis.__forestMongoClients ??= new Map();
export async function cloudClient() {
  const { uri } = cloudConfiguration();
  if (!clients.has(uri)) {
    let client;
    try { client = new MongoClient(uri, { maxPoolSize: 5, maxIdleTimeMS: 60000, waitQueueTimeoutMS: 8000, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 }); }
    catch (error) { throw new CloudDatabaseError(error); }
    const connection = connectWithDeadline(client).catch((error) => {
      if (clients.get(uri) === connection) clients.delete(uri);
      throw new CloudDatabaseError(error);
    });
    clients.set(uri, connection);
  }
  return clients.get(uri);
}
export async function cloudDatabase() { return (await cloudClient()).db(cloudConfiguration().database); }

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
