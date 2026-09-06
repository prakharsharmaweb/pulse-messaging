import type { Server as IOServer } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "./events";
import { conversationRoom, userRoom } from "./events";
import type { MessageDTO } from "../types";

export type TypedServer = IOServer<ClientToServerEvents, ServerToClientEvents>;

const g = globalThis as unknown as { __rtmIO?: TypedServer };

export function setIO(io: TypedServer) {
  g.__rtmIO = io;
}

export function getIO(): TypedServer | null {
  return g.__rtmIO ?? null;
}

/**
 * Fan a freshly-created message out to every participant. Called from both the
 * socket handler (text/gif/sticker) and the REST upload route (images), so
 * moderated images reach clients over the same real-time channel.
 */
export function broadcastMessage(msg: MessageDTO, participantIds: string[]) {
  const io = getIO();
  if (!io) return;
  io.to(conversationRoom(msg.conversationId)).emit("message:new", msg);
  // also notify participants not currently in the room (e.g. list view only)
  for (const uid of participantIds) {
    io.to(userRoom(uid)).emit("message:new", msg);
  }
}

export function notifyConversationCreated(conversationId: string, participantIds: string[]) {
  const io = getIO();
  if (!io) return;
  for (const uid of participantIds) {
    io.to(userRoom(uid)).emit("conversation:new", conversationId);
  }
}
