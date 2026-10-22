import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "./account-store.mjs";

export const SESSION_COOKIE = "forest_session";

export const currentUser = cache(async () => {
  const jar = await cookies();
  return getSessionUser(jar.get(SESSION_COOKIE)?.value);
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/");
  return user;
}
