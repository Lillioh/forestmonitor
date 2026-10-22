export interface LocalUser { id: number; username: string; name: string; role: "admin" | "operator" }
export const SESSION_SECONDS: number;
export function accountCount(): number;
export function createAccount(input: { username: string; password: string; name: string; role?: "admin" | "operator" }): Promise<LocalUser>;
export function authenticate(username: unknown, password: unknown): Promise<{ user?: LocalUser; token?: string; error?: string; status: number }>;
export function getSessionUser(token: string | undefined): LocalUser | null;
export function revokeSession(token: string | undefined): void;
export function resetPassword(username: string, password: string): Promise<void>;
