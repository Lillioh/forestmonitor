export function databaseFailure(error: unknown): { category: string; code?: string };
export class CloudConfigurationError extends Error { constructor(message: string); }
export function cloudConfiguration(env?: Record<string, string | undefined>): { uri: string; database: string };
