import type { Message, MessageReaction, MessageRead, User } from "@prisma/client";
import type {
  ConversationDTO,
  MessageDTO,
  ParticipantDTO,
  ReactionGroup,
  ReplyPreview,
} from "@/lib/types";

type MessageWithRelations = Message & {
  reads?: MessageRead[];
  reactions?: MessageReaction[];
  replyTo?: (Message & { sender?: Pick<User, "id"> }) | null;
};

function previewFor(m: Pick<Message, "kind" | "body" | "deletedAt">): string {
  if (m.deletedAt) return "This message was deleted";
  switch (m.kind) {
    case "IMAGE":
      return "📷 Photo";
    case "GIF":
      return "GIF";
    case "STICKER":
      return "Sticker";
    default:
      return m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body;
  }
}

function groupReactions(reactions: MessageReaction[] = []): ReactionGroup[] {
  const map = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, userIds: [] };
    g.count += 1;
    g.userIds.push(r.userId);
    map.set(r.emoji, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

export function toMessageDTO(m: MessageWithRelations): MessageDTO {
  const deleted = m.deletedAt != null;

  const replyTo: ReplyPreview | null =
    !deleted && m.replyTo
      ? {
          id: m.replyTo.id,
          senderId: m.replyTo.senderId,
          kind: m.replyTo.kind,
          preview: previewFor(m.replyTo),
        }
      : null;

  return {
    id: m.id,
    clientId: m.clientId,
    conversationId: m.conversationId,
    senderId: m.senderId,
    kind: m.kind,
    body: deleted ? "" : m.body,
    metadata: deleted ? null : (m.metadata as MessageDTO["metadata"]) ?? null,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
    readBy: (m.reads ?? []).map((r) => r.userId),
    reactions: deleted ? [] : groupReactions(m.reactions),
    replyTo,
  };
}

export function toParticipantDTO(
  u: Pick<User, "id" | "username" | "displayName" | "avatarColor">
): ParticipantDTO {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarColor: u.avatarColor,
  };
}

export type ConversationRow = {
  id: string;
  isGroup: boolean;
  title: string | null;
  updatedAt: Date;
  members: { user: Pick<User, "id" | "username" | "displayName" | "avatarColor"> }[];
  messages: MessageWithRelations[];
};

export function toConversationDTO(
  row: ConversationRow,
  unreadCount: number,
  myLastReadAt: Date
): ConversationDTO {
  return {
    id: row.id,
    isGroup: row.isGroup,
    title: row.title,
    participants: row.members.map((m) => toParticipantDTO(m.user)),
    lastMessage: row.messages[0] ? toMessageDTO(row.messages[0]) : null,
    unreadCount,
    myLastReadAt: myLastReadAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Standard include for loading a message with everything the DTO needs. */
export const messageInclude = {
  reads: true,
  reactions: true,
  replyTo: true,
} as const;
