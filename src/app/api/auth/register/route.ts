import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, clientIp, json } from "@/lib/api";
import { createSessionToken, hashPassword, sessionCookieOptions } from "@/lib/auth";
import { env } from "@/lib/env";
import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";

const schema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .regex(/^[a-z0-9_]+$/i, "Letters, numbers and underscores only."),
  displayName: z.string().trim().min(1).max(40),
  password: z.string().min(6).max(100),
});

const COLORS = ["#5b8def", "#e0698b", "#4bb1a6", "#c99b3f", "#8b6fd6", "#5aa469"];

export async function POST(req: Request) {
  const rl = rateLimit(`auth:${clientIp(req)}`, RATE_LIMITS.auth.limit, RATE_LIMITS.auth.windowMs);
  if (!rl.ok) return apiError(429, "Too many attempts. Try again shortly.");

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "Invalid input.");

  const { username, displayName, password } = parsed.data;
  const exists = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
  if (exists) return apiError(409, "That username is taken.");

  const user = await prisma.user.create({
    data: {
      username: username.toLowerCase(),
      displayName,
      passwordHash: await hashPassword(password),
      avatarColor: COLORS[Math.floor(Math.random() * COLORS.length)],
    },
    select: { id: true, username: true, displayName: true, avatarColor: true },
  });

  const token = await createSessionToken({ sub: user.id, username: user.username });
  cookies().set(env.AUTH_COOKIE, token, sessionCookieOptions());
  return json({ user });
}
