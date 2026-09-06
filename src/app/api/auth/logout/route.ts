import { cookies } from "next/headers";
import { json } from "@/lib/api";
import { env } from "@/lib/env";

export async function POST() {
  cookies().delete(env.AUTH_COOKIE);
  return json({ ok: true });
}
