export interface IngestionResult {
  accepted: true;
  event_id: string;
  node_id: string;
  alert_id: string | null;
  duplicate: boolean;
}
export function authorizeIngestion(authorization: string | null): void;
export function ingestObservation(input: unknown, options?: { now?: number }): IngestionResult;
