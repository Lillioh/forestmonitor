import { NextResponse } from "next/server";
import { databaseHealth } from "@/lib/server/database-health.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public readiness probe. No accounts, credentials, hostnames, error details,
// collection names or deployment internals are returned.
export async function GET() {
  try {
    await databaseHealth();
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
