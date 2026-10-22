import { NextResponse } from "next/server";
import { isCloud } from "@/lib/server/deployment.mjs";
import { receiveBatch } from "@/lib/server/cloud/mirror.mjs";
import { validateBatch, SyncError } from "@/lib/server/sync/protocol.mjs";
import { apiError, privateHeaders } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!isCloud()) return NextResponse.json({ error: "Cloud ingestion is disabled on this deployment." }, { status: 404, headers: privateHeaders });
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length > 200) throw new SyncError("Device credentials are required.", 401);
    const reader = request.body?.getReader();
    if (!reader || !request.headers.get("content-type")?.includes("application/json")) throw new SyncError("Expected JSON.", 415);
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const result = await reader.read(); if (result.done) break;
      length += result.value.length;
      if (length > 256000) { await reader.cancel(); throw new SyncError("Batch too large.", 413); }
      chunks.push(result.value);
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new SyncError("Invalid JSON."); }
    const batch = validateBatch(value);
    if (request.headers.get("x-forest-device") !== batch.deviceId) throw new SyncError("Device identity mismatch.", 401);
    return NextResponse.json(await receiveBatch(batch, authorization.slice(7)), { headers: privateHeaders });
  } catch (error) {
    if (error instanceof SyncError) return NextResponse.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    return apiError(error);
  }
}
