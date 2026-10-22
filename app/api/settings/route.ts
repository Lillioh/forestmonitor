import { NextResponse } from "next/server";
import { apiError, apiUser, privateHeaders, readMutation } from "@/lib/server/http";
import { saveSettings } from "@/lib/server/monitoring.mjs";
import { monitoringState } from "@/lib/server/state";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const user = await apiUser(true, true);
    const body = await readMutation(request);
    await monitoringState();
    return NextResponse.json({ settings: saveSettings(body, user.id) }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
