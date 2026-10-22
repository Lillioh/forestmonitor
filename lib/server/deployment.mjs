export function isCloud() { return process.env.FOREST_DEPLOYMENT === "cloud" || process.env.VERCEL === "1"; }
export function secureCookies() { return isCloud() || process.env.FOREST_COOKIE_SECURE === "true"; }
