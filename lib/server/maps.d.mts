export interface MapInfo { available: boolean; reason?: string; bytes?: number; minZoom?: number; maxZoom?: number; bounds?: [number, number, number, number]; dataVersion?: string; dataDate?: string; archiveUrl?: string }
export function mapInfo(): Promise<MapInfo>;
export function serveArchive(request: Request, head?: boolean): Promise<Response>;
export function parseRange(value: string | null, size: number): { start: number; end: number } | null;
