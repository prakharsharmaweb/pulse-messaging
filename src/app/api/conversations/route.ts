import { z } from "zod";
import { apiError, clientIp, json, requireUser } from "@/lib/api";
import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
import {
  getConversationForUser,
  getOrCreateDirectConversation,
  listConversations,
} from "@/server/conversations";
import { notifyConversationCreated } from "@/lib/socket/io";
import { getMemberIds } from "@/server/conversations";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const conversations = await listConversations(auth.user.id);
  return json({ conversations });
}

const createSchema = z.object({ userId: z.string().min(1) });

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const rl = rateLimit(
    `conv:${auth.user.id}`,
    RATE_LIMITS.conversationCreate.limit,
    RATE_LIMITS.conversationCreate.windowMs
  );
  if (!rl.ok) return apiError(429, "Too many new conversations. Slow down.");

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, "Invalid input.");

  try {
    const id = await getOrCreateDirectConversation(auth.user.id, parsed.data.userId);
    const conversation = await getConversationForUser(id, auth.user.id);
    notifyConversationCreated(id, await getMemberIds(id));
    return json({ conversation });
  } catch (err) {
    return apiError(400, err instanceof Error ? err.message : "Could not create conversation.");
  }
}
