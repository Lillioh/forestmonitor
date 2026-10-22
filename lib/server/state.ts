import { DISPATCH_TEAMS, INITIAL_SENSOR_NODES, OUTPOST } from "@/lib/mock-data";
import { initializeMonitoring, readState } from "./monitoring.mjs";
import { isCloud } from "./deployment.mjs";

export async function monitoringState() {
  if (isCloud()) return (await import("./cloud/mirror.mjs")).cloudState();
  initializeMonitoring({
    sensors: INITIAL_SENSOR_NODES,
    teams: DISPATCH_TEAMS,
    settings: { outpostName: OUTPOST.name, location: OUTPOST.location },
  });
  return readState();
}
