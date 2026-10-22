import { apiUser, apiError } from "@/lib/server/http";
import { serveArchive } from "@/lib/server/maps.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { await apiUser(); return await serveArchive(request); }
  catch (error) { return apiError(error); }
}
export async function HEAD(request: Request) {
  try { await apiUser(); return await serveArchive(request, true); }
  catch (error) { return apiError(error); }
}
