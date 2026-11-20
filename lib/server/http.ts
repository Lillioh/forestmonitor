import { NextResponse } from "next/server";
import { currentUser } from "./auth";
import { StoreError } from "./monitoring.mjs";
import { isCloud, secureCookies } from "./deployment.mjs";
import { databaseFailure } from "./cloud/connection-check.mjs";

export const privateHeaders = { "Cache-Control": "no-store, private" };

export async function apiUser(admin = false, mutation = false) {
  const user = await currentUser();
  if (!user) throw new StoreError("Your session has expired. Please sign in again.", 401);
  if (admin && user.role !== "admin") throw new StoreError("An administrator account is required.", 403);
  if (mutation && isCloud()) throw new StoreError("The remote dashboard is read-only. Perform incident actions at the local outpost.", 403);
  return user;
}

export async function readMutation(request: Request): Promise<Record<string, unknown>> {
  // Next may construct request.url from its bind address (0.0.0.0), while
  // a browser reaches the Pi by its LAN IP or hostname. Host is the browser's
  // actual destination; do not trust an arbitrary X-Forwarded-Host value.
  const expected = new URL(request.url);
  const host = request.headers.get("host");
  if (host) expected.host = host;
  if (secureCookies()) expected.protocol = "https:";
  if (request.headers.get("origin") !== expected.origin) {
    throw new StoreError("The request must come from this outpost's dashboard.", 403);
  }
  return readJson(request);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new StoreError("Expected JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new StoreError("A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) { await reader.cancel(); throw new StoreError("Request too large.", 413); }
    chunks.push(value);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new StoreError("Invalid JSON."); }
  if (!isJsonObject(parsed)) throw new StoreError("Expected a JSON object.");
  return parsed;
}

export function apiError(error: unknown) {
  if (error instanceof StoreError) return NextResponse.json({ error: error.message }, { status: error.status, headers: privateHeaders });
  console.error("Outpost API error:", databaseFailure(error));
  return NextResponse.json({ error: isCloud() ? "The cloud database is unavailable. Contact the administrator." : "The local database is unavailable. Check the outpost server." }, { status: 500, headers: privateHeaders });
}
