import type { DispatchTeam, MeshLink, NodeEvent, SensorNode } from "./types";

// No telemetry timestamp is invented before hardware has reported a reading.
export const DEMO_NOW = 0;

export const OUTPOST = {
  name: "Forest Outpost 03",
  location: "Cagayan de Oro Watershed",
  timezone: "Asia/Manila (PHT +08:00)",
  language: "English",
};

// ---------------------------------------------------------------------------
// Initial device configuration, seeded into SQLite exactly once.
// These telemetry placeholders are shown as unavailable until ingestion exists.
// ---------------------------------------------------------------------------

export const INITIAL_SENSOR_NODES: SensorNode[] = [
  {
    id: "NODE-01",
    name: "NODE-01",
    role: "Root Gateway",
    lat: 8.460140,
    lng: 124.700302,
    signal: 0,
    battery: 0,
    coreTemp: 0,
    uptimeHours: 0,
    firmware: "Not reported",
    deployed: "Not recorded",
    lastSyncAt: DEMO_NOW,
    status: "OFFLINE",
  },
  {
    id: "NODE-02",
    name: "NODE-02",
    role: "Relay",
    lat: 8.458825,
    lng: 124.701397,
    signal: 0,
    battery: 0,
    coreTemp: 0,
    uptimeHours: 0,
    firmware: "Not reported",
    deployed: "Not recorded",
    lastSyncAt: DEMO_NOW,
    status: "OFFLINE",
  },
  {
    id: "NODE-03",
    name: "NODE-03",
    role: "Endpoint",
    lat: 8.460395,
    lng: 124.701965,
    signal: 0,
    battery: 0,
    coreTemp: 0,
    uptimeHours: 0,
    firmware: "Not reported",
    deployed: "Not recorded",
    lastSyncAt: DEMO_NOW,
    status: "OFFLINE",
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
