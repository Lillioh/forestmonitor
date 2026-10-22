import { NextResponse } from "next/server";
import { apiError, apiUser, privateHeaders } from "@/lib/server/http";
import { monitoringState } from "@/lib/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await apiUser();
    return NextResponse.json(await monitoringState(), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
