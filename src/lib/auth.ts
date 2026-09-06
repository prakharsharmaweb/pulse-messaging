import { cookies } from "next/headers";
import { env } from "./env";
import { getSessionUserFromCookieHeader, type SessionUser } from "./auth-core";

export * from "./auth-core";

/** Route-handler / server-component helper. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(env.AUTH_COOKIE)?.value;
  if (!token) return null;
  const header = `${env.AUTH_COOKIE}=${token}`;
  return getSessionUserFromCookieHeader(header);
}
