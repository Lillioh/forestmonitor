export type AlertStatus = "NEW" | "DISPATCHED" | "RESOLVED" | "FALSE_POSITIVE";

export type Classification =
  | "Chainsaw Noise"
  | "Vehicle Noise"
  | "Heavy Vehicle"
  | "Tree Crash Event"
  | "Human Voice";

export interface DispatchTeam {
  id: string;
  name: string;
  shortCode: string;
  members: number;
  channel: string;
  status: "ACTIVE" | "STANDBY" | "OFFLINE";
}

export interface TdoaPair {
  pair: string;
  ms: number;
}

export interface Alert {
  id: string; // "047"
  code: string; // "INC-2024-0047"
  timestamp: number; // epoch ms
  lat: number;
  lng: number;
  classification: Classification;
  confidence: number; // 0-100
  radiusM: number | null;
  status: AlertStatus;
  zone: string;
  nodeId: string;
  assignedTeamId: string | null;
  responseMinutes: number | null;
  tdoa: TdoaPair[];
  priority: "HIGH" | "MEDIUM" | "LOW";
  source?: "SENSOR" | "SIMULATION";
  locationBasis?: "node_gps" | "node_last_known" | "node_configured";
  modelSha256?: string;
  dispatchedAt?: number;
  resolvedAt?: number;
}

export type NodeRole = "Root Gateway" | "Relay" | "Endpoint";
export type NodeStatus = "ONLINE" | "OFFLINE" | "DEGRADED";

export interface SensorNode {
  id: string;
  name: string;
  role: NodeRole;
  lat: number;
  lng: number;
  signal: number | null;
  battery: number | null;
  coreTemp: number | null;
  uptimeHours: number | null;
  firmware: string;
  deployed: string;
  lastSyncAt: number;
  status: NodeStatus;
  gpsFix?: boolean;
  lastGpsAt?: number;
  configuredPosition?: { lat: number; lng: number };
  receiverId?: string;
  receiverSequence?: number;
  lastClassification?: { probability: number; threshold: number; detected: boolean; model_sha256: string; receivedAt: number };
}

export interface MeshLink {
  from: string;
  to: string;
  quality: number;
}

export interface NodeEvent {
  id: string;
  timestamp: number;
  nodeId: string;
  type: string;
  details: string;
  classification?: { probability: number; threshold: number; detected: boolean; model_sha256: string };
}

export interface MonitoringSettings {
  outpostName: string;
  location: string;
}

export interface MonitoringState {
  alerts: Alert[];
  sensors: SensorNode[];
  nodeEvents: NodeEvent[];
  teams: DispatchTeam[];
  settings: MonitoringSettings;
  simulationEnabled: boolean;
  readOnly: boolean;
  deployment: "local" | "cloud";
  sync: { deviceId: string; enabled: boolean; pending: number | null; lastSyncedAt: number | null; error: string | null };
}
