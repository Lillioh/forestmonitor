import { mulberry32, pick, range } from "./random";
import { DISPATCH_TEAMS } from "./mock-data";
import type { Alert, Classification, NodeEvent, SensorNode } from "./types";

// ---------------------------------------------------------------------------
// TDoA triangulation area
//
// These three points represent the detection area formed by the three
// acoustic sensors. Simulated detections are generated INSIDE this triangle.
//
// Later, these coordinates will be replaced by the actual location returned
// by the Raspberry Pi TDoA + ML localization system.
// ---------------------------------------------------------------------------

const TDOA_AREA = [
  {
    lat: 8.460140,
    lng: 124.700302,
  },
  {
    lat: 8.458825,
    lng: 124.701397,
  },
  {
    lat: 8.460395,
    lng: 124.701965,
  },
] as const;

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

// ---------------------------------------------------------------------------
// Generates a random point INSIDE the TDoA triangle.
//
// This is only the simulation version of localization.
// In the actual system, the Raspberry Pi will provide the calculated
// latitude/longitude using TDoA and the ML detection result.
// ---------------------------------------------------------------------------

function generateTdoaDetectionLocation() {
  let a = liveRng();
  let b = liveRng();

  // Fold the random point so it always falls inside the triangle.
  if (a + b > 1) {
    a = 1 - a;
    b = 1 - b;
  }

  const pointA = TDOA_AREA[0];
  const pointB = TDOA_AREA[1];
  const pointC = TDOA_AREA[2];

  return {
    lat:
      pointA.lat +
      a * (pointB.lat - pointA.lat) +
      b * (pointC.lat - pointA.lat),

    lng:
      pointA.lng +
      a * (pointB.lng - pointA.lng) +
      b * (pointC.lng - pointA.lng),
  };
}

function priorityFor(
  classification: Classification,
  confidence: number
): Alert["priority"] {
  if (
    (classification === "Chainsaw Noise" ||
      classification === "Tree Crash Event") &&
    confidence >= 90
  ) {
    return "HIGH";
  }

  if (confidence >= 80) return "MEDIUM";

  return "LOW";
}

function buildTdoa(): Alert["tdoa"] {
  return [
    {
      pair: "NODE-01 ↔ NODE-02",
      ms: Number(range(liveRng, 6, 20).toFixed(1)),
    },
    {
      pair: "NODE-02 ↔ NODE-03",
      ms: Number(range(liveRng, 4, 14).toFixed(1)),
    },
    {
      pair: "NODE-01 ↔ NODE-03",
      ms: Number(range(liveRng, 14, 30).toFixed(1)),
    },
  ];
}

/**
 * Generates one freshly-detected incident.
 *
 * Simulation:
 *   Generate acoustic classification
 *   → generate TDoA-style location inside the detection triangle
 *   → create Alert
 *
 * Actual system:
 *   ESP32 acoustic nodes
 *   → LoRa
 *   → Raspberry Pi
 *   → ML classification + TDoA localization
 *   → actual Alert coordinates
 */
export function generateLiveAlert(
  seq: number,
  nodeIds: string[],
  now: number
): Alert {
  const classification = pick(liveRng, CLASSIFICATION_WEIGHTS);
  const confidence = Number(range(liveRng, 78, 99).toFixed(1));
  const year = new Date(now).getFullYear();

  const location = generateTdoaDetectionLocation();

  return {
    id: String(seq).padStart(3, "0"),
    code: `INC-${year}-${String(seq).padStart(4, "0")}`,
    timestamp: now,

    // Detection location comes from the TDoA localization area.
    lat: location.lat,
    lng: location.lng,

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
export function driftTelemetry(
  node: SensorNode,
  now: number
): SensorNode {
  const signal = clampDrift(node.signal, 3, 55, 99);
  const battery = clampDrift(node.battery, 0.6, 12, 100);
  const coreTemp = Number(
    clampDrift(node.coreTemp, 0.3, 20, 32).toFixed(1)
  );

  const status: SensorNode["status"] =
    battery < 15
      ? "OFFLINE"
      : battery < 35 || signal < 60
        ? "DEGRADED"
        : "ONLINE";

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

function clampDrift(
  value: number,
  step: number,
  min: number,
  max: number
): number {
  const next = value + range(liveRng, -step, step);

  return Math.min(max, Math.max(min, next));
}

const EVENT_TYPES = [
  "SYNC_COMPLETED",
  "CALIBRATION_COMPLETED",
  "MESH_HEARTBEAT",
] as const;

const EVENT_DETAILS: Record<
  (typeof EVENT_TYPES)[number],
  string
> = {
  SYNC_COMPLETED:
    "Sensor node successfully synchronized payload data via LoRa mesh.",

  CALIBRATION_COMPLETED:
    "Acoustic microphone calibration completed. Drift within tolerance.",

  MESH_HEARTBEAT:
    "Routine mesh heartbeat acknowledged by root gateway.",
};

export function generateNodeEvent(
  nodeId: string,
  now: number
): NodeEvent {
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