/** Shared DTOs used by REST routes, the Socket.IO layer and the client. */

export type MessageKind = "TEXT" | "IMAGE" | "GIF" | "STICKER";
export type MessageStatus = "SENT" | "DELIVERED" | "READ";

export type MessageMetadata = {
  url?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  title?: string;
  mime?: string;
  size?: number;
  packId?: string;
  stickerId?: string;
};

export type ReactionGroup = {
  emoji: string;
  count: number;
  userIds: string[];
};

export type ReplyPreview = {
  id: string;
  senderId: string;
  kind: MessageKind;
  preview: string;
};

export type MessageDTO = {
  id: string;
  clientId: string;
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  body: string;
  metadata: MessageMetadata | null;
  status: MessageStatus;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  readBy: string[];
  reactions: ReactionGroup[];
  replyTo: ReplyPreview | null;
};

export type ParticipantDTO = {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
};

export type ConversationDTO = {
  id: string;
  isGroup: boolean;
  title: string | null;
  participants: ParticipantDTO[];
  lastMessage: MessageDTO | null;
  unreadCount: number;
  myLastReadAt: string;
  updatedAt: string;
};

export type MessagePage = {
  messages: MessageDTO[];
  nextCursor: string | null;
  hasMore: boolean;
};
