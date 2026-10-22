import { isCloud } from "./deployment.mjs";
export { SESSION_SECONDS } from "./accounts.mjs";
async function store() { return isCloud() ? import("./cloud/accounts.mjs") : import("./accounts.mjs"); }
export async function createAccount(input) { return (await store()).createAccount(input); }
export async function authenticate(username, password) { return (await store()).authenticate(username, password); }
export async function accountCount() { return (await store()).accountCount(); }
export async function getSessionUser(token) { return (await store()).getSessionUser(token); }
export async function revokeSession(token) { return (await store()).revokeSession(token); }
export async function resetPassword(username, password) { return (await store()).resetPassword(username, password); }
