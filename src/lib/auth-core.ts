import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { parse as parseCookie } from "cookie";
import { env } from "./env";
import { prisma } from "./prisma";

/**
 * Framework-agnostic auth primitives. Safe to import from the standalone
 * Socket.IO server (no `next/headers` dependency).
 */

const secret = new TextEncoder().encode(env.AUTH_SECRET);
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
};

export type SessionPayload = { sub: string; username: string };

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function createSessionToken(payload: SessionPayload) {
  return new SignJWT({ username: payload.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub) return null;
    return { sub: payload.sub, username: String(payload.username ?? "") };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function loadUser(id: string): Promise<SessionUser | null> {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, displayName: true, avatarColor: true },
  });
}

/** Socket.IO handshake helper — parses the raw Cookie header. */
export async function getSessionUserFromCookieHeader(
  cookieHeader: string | undefined
): Promise<SessionUser | null> {
  if (!cookieHeader) return null;
  const token = parseCookie(cookieHeader)[env.AUTH_COOKIE];
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  return loadUser(payload.sub);
}
