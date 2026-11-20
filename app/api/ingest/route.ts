import { NextResponse } from "next/server";
import { isCloud } from "@/lib/server/deployment.mjs";
import { authorizeIngestion, ingestObservation } from "@/lib/server/ingestion.mjs";
import { monitoringState } from "@/lib/server/state";
import { apiError, privateHeaders, readJson } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (isCloud()) return NextResponse.json({ error: "Sensor ingestion is disabled on this deployment." }, { status: 404, headers: privateHeaders });
  try {
    authorizeIngestion(request.headers.get("authorization"));
    const input = await readJson(request);
    await monitoringState();
    const result = ingestObservation(input);
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201, headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
