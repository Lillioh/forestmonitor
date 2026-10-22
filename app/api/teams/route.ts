import { NextResponse } from "next/server";
import { apiError, apiUser, privateHeaders, readMutation } from "@/lib/server/http";
import { addTeam } from "@/lib/server/monitoring.mjs";
import { monitoringState } from "@/lib/server/state";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await apiUser(true, true);
    const { name } = await readMutation(request);
    await monitoringState();
    return NextResponse.json({ team: addTeam(name, user.id) }, { status: 201, headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
