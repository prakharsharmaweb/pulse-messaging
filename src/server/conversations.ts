import { prisma } from "@/lib/prisma";
import type { ConversationDTO } from "@/lib/types";
import { messageInclude, toConversationDTO, type ConversationRow } from "./serialize";

const memberUserSelect = {
  select: { id: true, username: true, displayName: true, avatarColor: true },
} as const;

/** Throws-free membership check used for authorization everywhere. */
export async function isMember(conversationId: string, userId: string): Promise<boolean> {
  const count = await prisma.conversationMember.count({
    where: { conversationId, userId },
  });
  return count > 0;
}

export async function getMemberIds(conversationId: string): Promise<string[]> {
  const rows = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

export async function listConversations(userId: string): Promise<ConversationDTO[]> {
  const rows = await prisma.conversation.findMany({
    where: { members: { some: { userId } } },
    orderBy: { updatedAt: "desc" },
    include: {
      members: { include: { user: memberUserSelect } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: messageInclude,
      },
    },
  });

  const memberships = await prisma.conversationMember.findMany({
    where: { userId, conversationId: { in: rows.map((r) => r.id) } },
    select: { conversationId: true, lastReadAt: true },
  });
  const lastReadMap = new Map(memberships.map((m) => [m.conversationId, m.lastReadAt]));

  const result: ConversationDTO[] = [];
  for (const row of rows) {
    const lastReadAt = lastReadMap.get(row.id) ?? new Date(0);
    const unreadCount = await prisma.message.count({
      where: {
        conversationId: row.id,
        senderId: { not: userId },
        createdAt: { gt: lastReadAt },
      },
    });
    result.push(toConversationDTO(row as ConversationRow, unreadCount, lastReadAt));
  }
  return result;
}

export async function getConversationForUser(
  conversationId: string,
  userId: string
): Promise<ConversationDTO | null> {
  if (!(await isMember(conversationId, userId))) return null;
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      members: { include: { user: memberUserSelect } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, include: messageInclude },
    },
  });
  if (!row) return null;
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  const lastReadAt = membership?.lastReadAt ?? new Date(0);
  const unreadCount = await prisma.message.count({
    where: {
      conversationId,
      senderId: { not: userId },
      createdAt: { gt: lastReadAt },
    },
  });
  return toConversationDTO(row as ConversationRow, unreadCount, lastReadAt);
}

/**
 * Creates a 1:1 conversation, or returns the existing one between the two users
 * (idempotent — a user double-clicking "message" never creates duplicates).
 */
export async function getOrCreateDirectConversation(
  userId: string,
  otherUserId: string
): Promise<string> {
  if (userId === otherUserId) throw new Error("Cannot start a conversation with yourself.");

  const other = await prisma.user.findUnique({ where: { id: otherUserId } });
  if (!other) throw new Error("User not found.");

  const existing = await prisma.conversation.findFirst({
    where: {
      isGroup: false,
      AND: [
        { members: { some: { userId } } },
        { members: { some: { userId: otherUserId } } },
      ],
    },
    select: { id: true, members: { select: { userId: true } } },
  });
  if (existing && existing.members.length === 2) return existing.id;

  const created = await prisma.conversation.create({
    data: {
      isGroup: false,
      members: { create: [{ userId }, { userId: otherUserId }] },
    },
  });
  return created.id;
}
