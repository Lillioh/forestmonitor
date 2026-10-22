import { NextResponse } from "next/server";
import { apiError, apiUser, privateHeaders, readMutation } from "@/lib/server/http";
import { removeTeam } from "@/lib/server/monitoring.mjs";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await apiUser(true, true);
    await readMutation(request);
    removeTeam((await params).id, user.id);
    return NextResponse.json({ ok: true }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
