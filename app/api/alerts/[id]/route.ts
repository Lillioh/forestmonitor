import { NextResponse } from "next/server";
import { apiError, apiUser, privateHeaders, readMutation } from "@/lib/server/http";
import { StoreError, updateIncident } from "@/lib/server/monitoring.mjs";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await apiUser(false, true);
    const { id } = await params;
    if (!/^\d{1,12}$/.test(id)) throw new StoreError("Incident not found.", 404);
    const { action, teamId } = await readMutation(request);
    if (typeof action !== "string" || (teamId !== undefined && typeof teamId !== "string")) throw new StoreError("Invalid incident action.");
    const alert = updateIncident(id, action, teamId as string | undefined, user.id);
    return NextResponse.json({ alert }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
