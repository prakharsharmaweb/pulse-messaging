import { z } from "zod";
import { apiError, json, requireUser } from "@/lib/api";
import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
import { validateImage } from "@/lib/moderation/imageValidation";
import { classifyImage } from "@/lib/moderation/nsfw";
import { checkProfanity } from "@/lib/moderation/profanity";
import { putImage } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { createMessage, MessageError } from "@/server/messages";
import { getMemberIds, isMember } from "@/server/conversations";
import { broadcastMessage } from "@/lib/socket/io";

export const runtime = "nodejs";
export const maxDuration = 30;

const metaSchema = z.object({
  conversationId: z.string().min(1),
  clientId: z.string().min(1).max(64),
  caption: z.string().max(1000).optional(),
  replyToId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;

  const rl = rateLimit(`upload:${userId}`, RATE_LIMITS.upload.limit, RATE_LIMITS.upload.windowMs);
  if (!rl.ok) return apiError(429, "Upload limit reached. Try again in a minute.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(400, "Expected multipart/form-data.");
  }

  const parsed = metaSchema.safeParse({
    conversationId: form.get("conversationId"),
    clientId: form.get("clientId"),
    caption: form.get("caption") ?? undefined,
    replyToId: form.get("replyToId") ?? undefined,
  });
  if (!parsed.success) return apiError(400, "Invalid upload metadata.");
  const { conversationId, clientId, caption, replyToId } = parsed.data;

  // authorization — must belong to the conversation
  if (!(await isMember(conversationId, userId))) {
    return apiError(403, "You are not a member of this conversation.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return apiError(400, "No file provided.");
  const buffer = Buffer.from(await file.arrayBuffer());

  // 1. validate real bytes (never trust filename / client Content-Type)
  const valid = await validateImage(buffer, file.size);
  if (!valid.ok) return apiError(400, valid.reason);

  // 2. optional caption goes through the same profanity gate as text messages
  if (caption?.trim()) {
    const verdict = checkProfanity(caption);
    if (!verdict.clean) {
      return apiError(422, "Your caption was blocked for prohibited language.", {
        moderation: "profanity",
      });
    }
  }

  // 3. nudity / explicit-content detection (server-side, cannot be bypassed)
  let verdict;
  try {
    verdict = await classifyImage(buffer, valid.mime);
  } catch (err) {
    console.error("nsfw model error", err);
    // fail closed — if we cannot verify the image, we do not deliver it
    return apiError(503, "Image moderation is temporarily unavailable. Please try again shortly.");
  }

  await prisma.moderationLog.create({
    data: {
      userId,
      kind: "image",
      action: verdict.safe ? "allowed" : "blocked",
      reason: verdict.reason ?? `score=${verdict.score} < threshold=${verdict.threshold}`,
      detail: verdict.predictions,
    },
  });

  if (!verdict.safe) {
    return apiError(422, "This image was rejected by moderation because it appears to contain explicit content. It was not delivered.", {
      moderation: "nudity",
      score: verdict.score,
      threshold: verdict.threshold,
    });
  }

  // 4. store + create message + broadcast
  const { url } = await putImage(conversationId, buffer, valid.ext);
  try {
    const { message } = await createMessage({
      conversationId,
      senderId: userId,
      clientId,
      kind: "IMAGE",
      body: caption?.trim() ?? "",
      metadata: { url, mime: valid.mime, size: buffer.length },
      replyToId: replyToId ?? null,
    });
    broadcastMessage(message, await getMemberIds(conversationId));
    return json({ message });
  } catch (err) {
    if (err instanceof MessageError) return apiError(400, err.message);
    throw err;
  }
}
