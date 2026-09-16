import { mulberry32, pick, range } from "./random";
import { DISPATCH_TEAMS } from "./mock-data";
import type { Alert, Classification, NodeEvent, SensorNode } from "./types";

// Bounds roughly matching the outpost's node coverage area.
const LAT_MIN = 8.437;
const LAT_MAX = 8.463;
const LNG_MIN = 124.6195;
const LNG_MAX = 124.6465;

export const ZONES = [
  "Zone Delta-3 (North Ridge)",
  "Zone Alpha-1 (River Basin)",
  "Zone Sigma-5 (Canyon Buffer)",
  "Zone Beta-2 (Saddle Trail)",
  "Zone Gamma-4 (Eastern Slope)",
] as const;

// Simple relative-frequency weighting (repeat = more likely) — not target
// totals, just a believable mix for detections as they actually occur.
const ZONE_WEIGHTS = [
  ZONES[0],
  ZONES[0],
  ZONES[0],
  ZONES[1],
  ZONES[1],
  ZONES[2],
  ZONES[3],
  ZONES[4],
];

const CLASSIFICATION_WEIGHTS: Classification[] = [
  "Chainsaw Noise",
  "Chainsaw Noise",
  "Chainsaw Noise",
  "Vehicle Noise",
  "Vehicle Noise",
  "Heavy Vehicle",
  "Tree Crash Event",
];

let liveRng = mulberry32(Date.now() & 0xffffffff);

function priorityFor(classification: Classification, confidence: number): Alert["priority"] {
  if (
    (classification === "Chainsaw Noise" || classification === "Tree Crash Event") &&
    confidence >= 90
  )
    return "HIGH";
  if (confidence >= 80) return "MEDIUM";
  return "LOW";
}

function buildTdoa(): Alert["tdoa"] {
  return [
    { pair: "NODE-01 ↔ NODE-02", ms: Number(range(liveRng, 6, 20).toFixed(1)) },
    { pair: "NODE-02 ↔ NODE-03", ms: Number(range(liveRng, 4, 14).toFixed(1)) },
    { pair: "NODE-01 ↔ NODE-03", ms: Number(range(liveRng, 14, 30).toFixed(1)) },
  ];
}

/** Generates one freshly-detected incident, as if a real node just triggered. */
export function generateLiveAlert(seq: number, nodeIds: string[], now: number): Alert {
  const classification = pick(liveRng, CLASSIFICATION_WEIGHTS);
  const confidence = Number(range(liveRng, 78, 99).toFixed(1));
  const year = new Date(now).getFullYear();

  return {
    id: String(seq).padStart(3, "0"),
    code: `INC-${year}-${String(seq).padStart(4, "0")}`,
    timestamp: now,
    lat: LAT_MIN + range(liveRng, 0, LAT_MAX - LAT_MIN),
    lng: LNG_MIN + range(liveRng, 0, LNG_MAX - LNG_MIN),
    classification,
    confidence,
    radiusM: Math.round(range(liveRng, 5, 14)),
    status: "NEW",
    zone: pick(liveRng, ZONE_WEIGHTS),
    nodeId: pick(liveRng, nodeIds),
    assignedTeamId: null,
    responseMinutes: null,
    tdoa: buildTdoa(),
    priority: priorityFor(classification, confidence),
  };
}

/** Random-walks one node's telemetry by a small, realistic step. */
export function driftTelemetry(node: SensorNode, now: number): SensorNode {
  const signal = clampDrift(node.signal, 3, 55, 99);
  const battery = clampDrift(node.battery, 0.6, 12, 100);
  const coreTemp = Number(clampDrift(node.coreTemp, 0.3, 20, 32).toFixed(1));

  const status: SensorNode["status"] =
    battery < 15 ? "OFFLINE" : battery < 35 || signal < 60 ? "DEGRADED" : "ONLINE";

  // Each node syncs on its own independent cadence, not every tick.
  const shouldSync = liveRng() < 0.4;

  return {
    ...node,
    signal: Math.round(signal),
    battery: Math.round(battery),
    coreTemp,
    status,
    uptimeHours: node.uptimeHours + 1 / 60,
    lastSyncAt: shouldSync ? now : node.lastSyncAt,
  };
}

function clampDrift(value: number, step: number, min: number, max: number): number {
  const next = value + range(liveRng, -step, step);
  return Math.min(max, Math.max(min, next));
}

const EVENT_TYPES = [
  "SYNC_COMPLETED",
  "CALIBRATION_COMPLETED",
  "MESH_HEARTBEAT",
] as const;

const EVENT_DETAILS: Record<(typeof EVENT_TYPES)[number], string> = {
  SYNC_COMPLETED: "Sensor node successfully synchronized payload data via LoRa mesh.",
  CALIBRATION_COMPLETED: "Acoustic microphone calibration completed. Drift within tolerance.",
  MESH_HEARTBEAT: "Routine mesh heartbeat acknowledged by root gateway.",
};

export function generateNodeEvent(nodeId: string, now: number): NodeEvent {
  const type = pick(liveRng, EVENT_TYPES);
  return {
    id: `evt-${now}-${nodeId}`,
    timestamp: now,
    nodeId,
    type,
    details: EVENT_DETAILS[type],
  };
}

export function pickDispatchTeamId(): string {
  return pick(liveRng, DISPATCH_TEAMS).id;
}

export function reseedLiveRng(seed: number) {
  liveRng = mulberry32(seed);
}
