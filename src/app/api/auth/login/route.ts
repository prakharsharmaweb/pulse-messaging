import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, clientIp, json } from "@/lib/api";
import { createSessionToken, sessionCookieOptions, verifyPassword } from "@/lib/auth";
import { env } from "@/lib/env";
import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";

const schema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const rl = rateLimit(`auth:${clientIp(req)}`, RATE_LIMITS.auth.limit, RATE_LIMITS.auth.windowMs);
  if (!rl.ok) return apiError(429, "Too many attempts. Try again shortly.");

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "Invalid input.");

  const user = await prisma.user.findUnique({
    where: { username: parsed.data.username.toLowerCase() },
  });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return apiError(401, "Incorrect username or password.");
  }

  const token = await createSessionToken({ sub: user.id, username: user.username });
  cookies().set(env.AUTH_COOKIE, token, sessionCookieOptions());
  return json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
    },
  });
}
