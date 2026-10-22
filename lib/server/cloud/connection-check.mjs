// Safe to include in server logs and CLI output: never return error.message,
// URI strings, hostnames, user names, or arbitrary driver error fields.
export function databaseFailure(error) {
  if (error instanceof CloudDatabaseError) return { ...error.failure };
  const pending = [error];
  const seen = new Set();
  const codes = new Set();
  const names = new Set();
  while (pending.length && seen.size < 30) {
    const item = pending.shift();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    codes.add(item.code);
    names.add(item.name);
    pending.push(item.cause, item.reason?.error);
    if (item.reason?.servers instanceof Map) {
      for (const server of item.reason.servers.values()) pending.push(server.error);
    }
  }
  if (names.has("CloudConfigurationError") || names.has("MongoParseError") || names.has("MongoInvalidArgumentError")) return { category: "configuration" };
  if (codes.has(18) || names.has("MongoAuthenticationError")) return { category: "authentication" };
  if (codes.has(13)) return { category: "authorization" };
  for (const code of ["ENOTFOUND", "ENODATA", "ESERVFAIL", "EREFUSED", "ETIMEOUT", "EBADRESP", "ECANCELLED", "EAI_AGAIN"]) {
    if (codes.has(code)) return { category: "dns", code };
  }
  for (const code of ["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID"]) {
    if (codes.has(code)) return { category: "tls", code };
  }
  for (const code of ["EACCES", "EPERM", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH"]) {
    if (codes.has(code)) return { category: "network", code };
  }
  if (names.has("CloudConnectionTimeoutError") || names.has("MongoServerSelectionError") || names.has("MongoNetworkTimeoutError") || names.has("MongoOperationTimeoutError")) return { category: "timeout" };
  return { category: "database" };
}

export class CloudDatabaseError extends Error {
  constructor(error) {
    const failure = databaseFailure(error);
    super(`Cloud database connection failed (${failure.category}). Run npm run db:check for diagnostics.`);
    this.name = "CloudDatabaseError";
    this.failure = failure;
  }
}

export class CloudConfigurationError extends Error {
  constructor(message) { super(message); this.name = "CloudConfigurationError"; }
}

export function cloudConfiguration(env = process.env) {
  const uri = env.MONGODB_URI?.trim();
  if (!uri) throw new CloudConfigurationError("Set MONGODB_URI in the private cloud environment file.");
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri) || /[<>\r\n]/.test(uri)) {
    throw new CloudConfigurationError("MONGODB_URI must be a MongoDB connection string with all placeholders replaced.");
  }
  const database = env.MONGODB_DATABASE || "forest_monitor";
  if (typeof database !== "string" || /[\/\\."$\x00\s]/.test(database) || Buffer.byteLength(database) > 63) {
    throw new CloudConfigurationError("MONGODB_DATABASE must be a valid application database name.");
  }
  return { uri, database };
}

// Driver serverSelectionTimeoutMS starts after SRV discovery. Bound the whole
// connection attempt too, so failed DNS cannot hold an HTTP request indefinitely.
// Close both immediately on failure and again if a timed-out attempt connects late.
export async function connectWithDeadline(client, timeoutMS = 12000) {
  let expired = false;
  let timer;
  const close = () => { void Promise.resolve().then(() => client.close()).catch(() => {}); };
  try {
    return await Promise.race([
      Promise.resolve().then(() => client.connect()).then((connected) => {
        if (expired) { close(); throw Object.assign(new Error("Cloud connection deadline exceeded."), { name: "CloudConnectionTimeoutError" }); }
        return connected;
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(Object.assign(new Error("Cloud connection deadline exceeded."), { name: "CloudConnectionTimeoutError" }));
        }, timeoutMS);
      }),
    ]);
  } catch (error) { close(); throw error; }
  finally { clearTimeout(timer); }
}
