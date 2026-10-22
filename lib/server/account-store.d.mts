import type { LocalUser } from "./accounts.mjs";
export const SESSION_SECONDS: number;
export function createAccount(input: { username: string; password: string; name: string; role?: "admin" | "operator" }): Promise<LocalUser>;
export function authenticate(username: unknown, password: unknown): Promise<{ user?: LocalUser; token?: string; error?: string; status: number }>;
export function accountCount(): Promise<number>;
export function getSessionUser(token: string | undefined): Promise<LocalUser | null>;
export function revokeSession(token: string | undefined): Promise<void>;
export function resetPassword(username: string, password: string): Promise<void>;
