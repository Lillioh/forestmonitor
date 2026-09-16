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
  radiusM: number;
  status: AlertStatus;
  zone: string;
  nodeId: string;
  assignedTeamId: string | null;
  responseMinutes: number | null;
  tdoa: TdoaPair[];
  priority: "HIGH" | "MEDIUM" | "LOW";
}

export type NodeRole = "Root Gateway" | "Relay" | "Endpoint";
export type NodeStatus = "ONLINE" | "OFFLINE" | "DEGRADED";

export interface SensorNode {
  id: string;
  name: string;
  role: NodeRole;
  lat: number;
  lng: number;
  signal: number;
  battery: number;
  coreTemp: number;
  uptimeHours: number;
  firmware: string;
  deployed: string;
  lastSyncAt: number;
  status: NodeStatus;
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
}
