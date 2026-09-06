import { apiError, requireUser } from "@/lib/api";
import { getObject } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { isMember } from "@/server/conversations";

/**
 * Authenticated media delivery. A user can only fetch an image that belongs to
 * a conversation they are a member of.
 */
export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const key = params.key.join("/");
  const conversationId = params.key[0];

  if (!(await isMember(conversationId, auth.user.id))) {
    return apiError(403, "Not authorized to view this file.");
  }

  // ensure the file is actually referenced by a message in that conversation
  const referenced = await prisma.message.findFirst({
    where: { conversationId, metadata: { path: ["url"], string_contains: key } },
    select: { id: true },
  });
  if (!referenced) return apiError(404, "File not found.");

  const obj = await getObject(key);
  if (!obj) return apiError(404, "File not found.");

  const ext = key.split(".").pop()?.toLowerCase();
  const mime = ext === "png" ? "image/png" : "image/jpeg";

  return new Response(new Uint8Array(obj.buffer), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(obj.size),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
