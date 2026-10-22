import { NextResponse } from "next/server";
import { apiError, apiUser, privateHeaders, readMutation } from "@/lib/server/http";
import { createDetection, StoreError } from "@/lib/server/monitoring.mjs";
import { monitoringState } from "@/lib/server/state";
import { generateLiveAlert } from "@/lib/simulation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await apiUser(true, true);
    await readMutation(request);
    const state = await monitoringState();
    if (!state.simulationEnabled) throw new StoreError("Simulation is disabled on this outpost.", 403);
    const detection = generateLiveAlert(0, state.sensors.map((n) => n.id), Date.now());
    const alert = createDetection({ ...detection, source: "SIMULATION" }, user.id);
    return NextResponse.json({ alert }, { status: 201, headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
