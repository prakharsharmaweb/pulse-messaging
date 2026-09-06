import type { MessageDTO, MessageKind, MessageMetadata, ReactionGroup } from "../types";

/** Wire contract for the Socket.IO connection. */

export type SendMessageInput = {
  conversationId: string;
  clientId: string; // idempotency key / optimistic temp id
  kind: MessageKind;
  body?: string;
  metadata?: MessageMetadata;
  replyToId?: string | null;
};

export type SendAck =
  | { ok: true; message: MessageDTO }
  | { ok: false; code: "RATE_LIMITED" | "PROFANITY" | "FORBIDDEN" | "INVALID" | "ERROR"; message: string; matched?: string[] };

/** Same shape as SendAck — edit re-runs profanity moderation. */
export type EditAck = SendAck;

export type DeleteScope = "me" | "everyone";

export type PresencePayload = { userId: string; online: boolean; lastSeen: string };

export type TypingPayload = { conversationId: string; userId: string; typing: boolean };

export type ReadPayload = { conversationId: string; userId: string; readAt: string; messageIds: string[] };

export type ReactionUpdate = {
  conversationId: string;
  messageId: string;
  reactions: ReactionGroup[];
};

export interface ServerToClientEvents {
  "message:new": (msg: MessageDTO) => void;
  "message:status": (p: { conversationId: string; messageIds: string[]; status: "DELIVERED" | "READ"; by: string }) => void;
  // edit + "delete for everyone" — the full updated DTO
  "message:update": (msg: MessageDTO) => void;
  // "delete for me" — sent only to the acting user's own room (all their tabs)
  "message:removed": (p: { conversationId: string; messageId: string }) => void;
  "reaction:update": (p: ReactionUpdate) => void;
  "presence:update": (p: PresencePayload) => void;
  "presence:snapshot": (p: { online: string[] }) => void;
  "typing:update": (p: TypingPayload) => void;
  "conversation:new": (conversationId: string) => void;
  "error:toast": (p: { message: string }) => void;
}

export interface ClientToServerEvents {
  "message:send": (input: SendMessageInput, ack: (res: SendAck) => void) => void;
  "message:read": (p: { conversationId: string }, ack?: (res: { ok: boolean }) => void) => void;
  "message:sync": (p: { conversationId: string; afterId: string | null }, ack: (res: { messages: MessageDTO[] }) => void) => void;
  "reaction:toggle": (p: { messageId: string; emoji: string }, ack: (res: { ok: boolean; message?: string }) => void) => void;
  "message:edit": (p: { messageId: string; body: string }, ack: (res: EditAck) => void) => void;
  "message:delete": (p: { messageId: string; scope: DeleteScope }, ack: (res: { ok: boolean; message?: string }) => void) => void;
  "typing:start": (p: { conversationId: string }) => void;
  "typing:stop": (p: { conversationId: string }) => void;
  "presence:ping": () => void;
}

export const userRoom = (userId: string) => `user:${userId}`;
export const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;
