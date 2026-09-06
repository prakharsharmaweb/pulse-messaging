import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  MessageDTO,
  MessageKind,
  MessageMetadata,
  MessagePage,
  ReactionGroup,
} from "@/lib/types";
import { messageInclude, toMessageDTO } from "./serialize";
import { isMember } from "./conversations";

/** Excludes messages the given user has "deleted for me". */
const notHiddenFor = (userId: string) => ({ hiddenFor: { none: { userId } } });

const PAGE_SIZE = 30;

export class MessageError extends Error {
  constructor(public code: "FORBIDDEN" | "INVALID" | "NOT_FOUND", message: string) {
    super(message);
  }
}

type CreateInput = {
  conversationId: string;
  senderId: string;
  clientId: string;
  kind: MessageKind;
  body?: string;
  metadata?: MessageMetadata;
  replyToId?: string | null;
};

const REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "🎉"];

/**
 * Idempotent message create. The unique (conversationId, clientId) constraint
 * means a retry / reconnect resend returns the already-stored row instead of
 * inserting a duplicate.
 */
export async function createMessage(input: CreateInput): Promise<{ message: MessageDTO; created: boolean }> {
  if (!(await isMember(input.conversationId, input.senderId))) {
    throw new MessageError("FORBIDDEN", "You are not a member of this conversation.");
  }

  const body = (input.body ?? "").trim();
  if (input.kind === "TEXT" && !body) {
    throw new MessageError("INVALID", "Message cannot be empty.");
  }
  if (input.kind === "TEXT" && body.length > 4000) {
    throw new MessageError("INVALID", "Message is too long.");
  }
  if ((input.kind === "GIF" || input.kind === "STICKER" || input.kind === "IMAGE") && !input.metadata?.url) {
    throw new MessageError("INVALID", "Missing media reference.");
  }

  // a reply target must exist and live in the same conversation
  if (input.replyToId) {
    const parent = await prisma.message.findUnique({
      where: { id: input.replyToId },
      select: { conversationId: true },
    });
    if (!parent || parent.conversationId !== input.conversationId) {
      throw new MessageError("INVALID", "The message you're replying to no longer exists.");
    }
  }

  try {
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId: input.conversationId,
          senderId: input.senderId,
          clientId: input.clientId,
          kind: input.kind,
          body,
          metadata: (input.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          status: "SENT",
          replyToId: input.replyToId ?? null,
        },
        include: messageInclude,
      });
      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      });
      return created;
    });
    return { message: toMessageDTO(message), created: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.message.findUnique({
        where: {
          conversationId_clientId: {
            conversationId: input.conversationId,
            clientId: input.clientId,
          },
        },
        include: messageInclude,
      });
      if (existing) return { message: toMessageDTO(existing), created: false };
    }
    throw err;
  }
}

/**
 * Cursor-based pagination. Loads the newest `PAGE_SIZE` messages, then older
 * pages as the client scrolls up. Cursor is the message id; ordering is on the
 * composite index (conversationId, createdAt, id).
 */
export async function getMessages(
  conversationId: string,
  userId: string,
  cursor?: string | null
): Promise<MessagePage> {
  if (!(await isMember(conversationId, userId))) {
    throw new MessageError("FORBIDDEN", "You are not a member of this conversation.");
  }

  const rows = await prisma.message.findMany({
    where: { conversationId, ...notHiddenFor(userId) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: messageInclude,
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return {
    // return in ascending (chronological) order for rendering
    messages: page.reverse().map(toMessageDTO),
    nextCursor: hasMore ? page[0].id : null,
    hasMore,
  };
}

/** Messages created after a given id — used to reconcile after a reconnect. */
export async function getMessagesAfter(
  conversationId: string,
  userId: string,
  afterId: string | null
): Promise<MessageDTO[]> {
  if (!(await isMember(conversationId, userId))) {
    throw new MessageError("FORBIDDEN", "Not a member.");
  }
  let after: Date | null = null;
  if (afterId) {
    const anchor = await prisma.message.findUnique({ where: { id: afterId }, select: { createdAt: true } });
    after = anchor?.createdAt ?? null;
  }
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      ...notHiddenFor(userId),
      ...(after ? { createdAt: { gt: after } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    include: messageInclude,
  });
  return rows.map(toMessageDTO);
}

/**
 * Marks every unread message from other people as read for `userId`.
 * Returns the affected message ids (for a real-time receipt to the senders).
 */
export async function markConversationRead(
  conversationId: string,
  userId: string
): Promise<{ messageIds: string[]; readAt: Date }> {
  if (!(await isMember(conversationId, userId))) {
    throw new MessageError("FORBIDDEN", "Not a member.");
  }
  const readAt = new Date();
  const unread = await prisma.message.findMany({
    where: {
      conversationId,
      senderId: { not: userId },
      reads: { none: { userId } },
    },
    select: { id: true },
  });

  if (unread.length > 0) {
    await prisma.$transaction([
      prisma.messageRead.createMany({
        data: unread.map((m) => ({ messageId: m.id, userId, readAt })),
        skipDuplicates: true,
      }),
      prisma.message.updateMany({
        where: { id: { in: unread.map((m) => m.id) } },
        data: { status: "READ" },
      }),
    ]);
  }

  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { lastReadAt: readAt },
  });

  return { messageIds: unread.map((m) => m.id), readAt };
}

export const ALLOWED_REACTIONS = REACTION_EMOJI;

/**
 * Toggles a reaction: adds it if absent, removes it if the user already reacted
 * with that emoji. Idempotent per the `(messageId, userId, emoji)` unique
 * constraint. Returns the regrouped reactions plus the conversation id so the
 * caller can fan the update out to the room.
 */
export async function toggleReaction(
  messageId: string,
  userId: string,
  emoji: string
): Promise<{ conversationId: string; messageId: string; reactions: ReactionGroup[] }> {
  if (!REACTION_EMOJI.includes(emoji)) {
    throw new MessageError("INVALID", "Unsupported reaction.");
  }
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { conversationId: true },
  });
  if (!message) throw new MessageError("NOT_FOUND", "Message not found.");
  if (!(await isMember(message.conversationId, userId))) {
    throw new MessageError("FORBIDDEN", "You are not a member of this conversation.");
  }

  const existing = await prisma.messageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId, emoji } },
  });
  if (existing) {
    await prisma.messageReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.messageReaction.create({ data: { messageId, userId, emoji } });
  }

  const all = await prisma.messageReaction.findMany({ where: { messageId } });
  const map = new Map<string, ReactionGroup>();
  for (const r of all) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, userIds: [] };
    g.count += 1;
    g.userIds.push(r.userId);
    map.set(r.emoji, g);
  }
  const reactions = [...map.values()].sort(
    (a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji)
  );
  return { conversationId: message.conversationId, messageId, reactions };
}

/**
 * Edits the text of a message. Sender-only, TEXT-only. The updated body is
 * re-run through profanity moderation by the caller before this is invoked.
 */
export async function editMessage(
  messageId: string,
  userId: string,
  rawBody: string
): Promise<{ message: MessageDTO; conversationId: string }> {
  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    select: { senderId: true, conversationId: true, kind: true, deletedAt: true },
  });
  if (!existing) throw new MessageError("NOT_FOUND", "Message not found.");
  if (existing.senderId !== userId) {
    throw new MessageError("FORBIDDEN", "You can only edit your own messages.");
  }
  if (existing.deletedAt) throw new MessageError("INVALID", "This message was deleted.");
  if (existing.kind !== "TEXT") {
    throw new MessageError("INVALID", "Only text messages can be edited.");
  }

  const body = rawBody.trim();
  if (!body) throw new MessageError("INVALID", "Message cannot be empty.");
  if (body.length > 4000) throw new MessageError("INVALID", "Message is too long.");

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { body, editedAt: new Date() },
    include: messageInclude,
  });
  return { message: toMessageDTO(updated), conversationId: existing.conversationId };
}

/**
 * "Delete for everyone" — soft delete by the sender. The row stays (so other
 * participants' clients can reconcile), but body/metadata/reactions are cleared.
 * Idempotent.
 */
export async function deleteMessageForEveryone(
  messageId: string,
  userId: string
): Promise<{ message: MessageDTO; conversationId: string }> {
  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    select: { senderId: true, conversationId: true, deletedAt: true },
  });
  if (!existing) throw new MessageError("NOT_FOUND", "Message not found.");
  if (existing.senderId !== userId) {
    throw new MessageError("FORBIDDEN", "You can only delete your own messages for everyone.");
  }

  // idempotent — already deleted, return current state
  if (existing.deletedAt) {
    const current = await prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: messageInclude,
    });
    return { message: toMessageDTO(current), conversationId: existing.conversationId };
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.messageReaction.deleteMany({ where: { messageId } });
    return tx.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedById: userId, body: "", metadata: Prisma.JsonNull },
      include: messageInclude,
    });
  });
  return { message: toMessageDTO(updated), conversationId: existing.conversationId };
}

/** "Delete for me" — per-user hide. Idempotent via the unique constraint. */
export async function deleteMessageForMe(
  messageId: string,
  userId: string
): Promise<{ conversationId: string }> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { conversationId: true },
  });
  if (!message) throw new MessageError("NOT_FOUND", "Message not found.");
  if (!(await isMember(message.conversationId, userId))) {
    throw new MessageError("FORBIDDEN", "You are not a member of this conversation.");
  }
  await prisma.messageHidden.upsert({
    where: { messageId_userId: { messageId, userId } },
    create: { messageId, userId },
    update: {},
  });
  return { conversationId: message.conversationId };
}

/** Bulk mark delivered when a recipient's socket receives messages. */
export async function markDelivered(conversationId: string, recipientId: string): Promise<string[]> {
  const pending = await prisma.message.findMany({
    where: { conversationId, senderId: { not: recipientId }, status: "SENT" },
    select: { id: true },
  });
  if (pending.length === 0) return [];
  await prisma.message.updateMany({
    where: { id: { in: pending.map((m) => m.id) } },
    data: { status: "DELIVERED" },
  });
  return pending.map((m) => m.id);
}
