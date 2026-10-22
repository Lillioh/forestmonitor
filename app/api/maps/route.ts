import { NextResponse } from "next/server";
import { apiUser, apiError, privateHeaders } from "@/lib/server/http";
import { mapInfo } from "@/lib/server/maps.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { await apiUser(); return NextResponse.json(await mapInfo(), { headers: privateHeaders }); }
  catch (error) { return apiError(error); }
}
