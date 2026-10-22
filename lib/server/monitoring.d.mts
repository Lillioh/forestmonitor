import type { Alert, DispatchTeam, MonitoringSettings, MonitoringState, SensorNode } from "../types";
export class StoreError extends Error { status: number; constructor(message: string, status?: number) }
export function initializeMonitoring(defaults: { sensors: SensorNode[]; teams: DispatchTeam[]; settings: MonitoringSettings }): void;
export function readState(): MonitoringState;
export function createDetection(detection: Alert, actorId: number): Alert;
export function updateIncident(id: string, action: string, teamId: string | undefined, actorId: number): Alert;
export function addTeam(name: unknown, actorId: number): DispatchTeam;
export function removeTeam(id: string, actorId: number): void;
export function saveSettings(settings: unknown, actorId: number): MonitoringSettings;
