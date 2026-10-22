import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revokeSession } from "@/lib/server/account-store.mjs";
import { secureCookies } from "@/lib/server/deployment.mjs";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { apiError, privateHeaders, readMutation } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await readMutation(request);
    const jar = await cookies();
    await revokeSession(jar.get(SESSION_COOKIE)?.value);
    const response = NextResponse.json({ ok: true }, { headers: privateHeaders });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 0,
      secure: secureCookies(),
    });
    return response;
  } catch (error) { return apiError(error); }
}
