import { getSessionUser } from "@/lib/auth";
import { apiError, json } from "@/lib/api";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not authenticated.");
  return json({ user });
}
