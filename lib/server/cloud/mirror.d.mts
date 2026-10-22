import type { MonitoringState } from "../../types";
export function receiveBatch(batch: unknown, token: string): Promise<{ ackSeq: number }>;
export function cloudState(): Promise<MonitoringState>;
