import type { DispatchTeam, MeshLink, NodeEvent, SensorNode } from "./types";

// Fixed "boot" anchor baked in at module load, used only as the SSR-safe
// starting point for the live clock (see use-now.ts). It is NOT a source of
// fake incident history.
export const DEMO_NOW = Date.now();

export const OUTPOST = {
  name: "Forest Outpost 03",
  location: "Cagayan de Oro Watershed",
  timezone: "Asia/Manila (PHT +08:00)",
  language: "English",
};

// ---------------------------------------------------------------------------
// Sensor nodes + mesh — real deployed node identities/config. Telemetry
// values below are the baseline reading at boot; they drift live once the
// simulation engine starts (see context/AlertsContext.tsx + lib/simulation.ts).
// ---------------------------------------------------------------------------

export const INITIAL_SENSOR_NODES: SensorNode[] = [
  {
    id: "NODE-01",
    name: "NODE-01",
    role: "Root Gateway",
    lat: 8.4542,
    lng: 124.6319,
    signal: 88,
    battery: 74,
    coreTemp: 24.8,
    uptimeHours: 0,
    firmware: "v1.2.4 alpha",
    deployed: "Jan 14, 2024",
    lastSyncAt: DEMO_NOW,
    status: "ONLINE",
  },
  {
    id: "NODE-02",
    name: "NODE-02",
    role: "Relay",
    lat: 8.4498,
    lng: 124.6287,
    signal: 95,
    battery: 61,
    coreTemp: 26.1,
    uptimeHours: 0,
    firmware: "v1.2.4 alpha",
    deployed: "Jan 15, 2024",
    lastSyncAt: DEMO_NOW,
    status: "ONLINE",
  },
  {
    id: "NODE-03",
    name: "NODE-03",
    role: "Endpoint",
    lat: 8.4561,
    lng: 124.6402,
    signal: 79,
    battery: 83,
    coreTemp: 23.9,
    uptimeHours: 0,
    firmware: "v1.2.3 release",
    deployed: "Feb 02, 2024",
    lastSyncAt: DEMO_NOW,
    status: "ONLINE",
  },
];

export const MESH_LINKS: MeshLink[] = [
  { from: "NODE-01", to: "NODE-02", quality: 91 },
  { from: "NODE-01", to: "NODE-03", quality: 79 },
  { from: "NODE-02", to: "NODE-03", quality: 84 },
];

// Empty at boot — the node event log is populated live by the simulation
// engine as nodes sync/calibrate, not pre-written.
export const INITIAL_NODE_EVENTS: NodeEvent[] = [];

// ---------------------------------------------------------------------------
// Dispatch teams — real configured response units. Shared by Settings
// (management), Incident Details (assignment) and Reports (computed
// response-time performance from whatever incidents actually occur).
// ---------------------------------------------------------------------------

export const DISPATCH_TEAMS: DispatchTeam[] = [
  {
    id: "qrt-a",
    name: "Quick Response Team Alpha",
    shortCode: "QRT A",
    members: 4,
    channel: "VHF CH 12",
    status: "ACTIVE",
  },
  {
    id: "wsp",
    name: "West Sector Patrol",
    shortCode: "WSP",
    members: 3,
    channel: "VHF CH 14",
    status: "ACTIVE",
  },
  {
    id: "wr-03",
    name: "Watershed Rangers Unit 03",
    shortCode: "WR 03",
    members: 5,
    channel: "Radio Mesh",
    status: "STANDBY",
  },
  {
    id: "cvu",
    name: "Community Volunteer Unit",
    shortCode: "CVU",
    members: 6,
    channel: "Mobile Push",
    status: "OFFLINE",
  },
];
