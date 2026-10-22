import { NextResponse } from "next/server";
import { authenticate, SESSION_SECONDS } from "@/lib/server/account-store.mjs";
import { secureCookies } from "@/lib/server/deployment.mjs";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { apiError, privateHeaders, readMutation } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readMutation(request);
    const result = await authenticate(body.username, body.password);
    if (!result.user || !result.token) {
      return NextResponse.json({ error: result.error }, {
        status: result.status,
        headers: { ...privateHeaders, ...(result.status === 429 ? { "Retry-After": "900" } : {}) },
      });
    }
    const response = NextResponse.json({ user: result.user }, { headers: privateHeaders });
    response.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_SECONDS,
      secure: secureCookies(),
    });
    return response;
  } catch (error) { return apiError(error); }
}
