import type { Socket } from "socket.io";
import type { SessionUser } from "../auth-core";
import { getSessionUserFromCookieHeader } from "../auth-core";
import type { ClientToServerEvents, ServerToClientEvents } from "./events";
import { conversationRoom, userRoom } from "./events";
import { addSocket, getLastSeen, isOnline, onlineUserIds, removeSocket } from "./presence";
import { rateLimit, RATE_LIMITS } from "../rateLimit";
import { checkProfanity } from "../moderation/profanity";
import { prisma } from "../prisma";
import {
  createMessage,
  getMessagesAfter,
  markConversationRead,
  markDelivered,
  MessageError,
  toggleReaction,
} from "@/server/messages";
import { getMemberIds, isMember } from "@/server/conversations";
import type { TypedServer } from "./io";

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: SessionUser }>;

export function registerSocketHandlers(io: TypedServer) {
  // --- authentication on the handshake (server-side, cookie-based) ---
  io.use(async (socket, next) => {
    const user = await getSessionUserFromCookieHeader(socket.handshake.headers.cookie);
    if (!user) return next(new Error("UNAUTHORIZED"));
    (socket.data as { user: SessionUser }).user = user;
    next();
  });

  io.on("connection", (socket: TypedSocket) => {
    const user = socket.data.user;

    // --- register event handlers synchronously (never behind an await) ---

    // async connection setup: join rooms, presence, deliver receipts
    void (async () => {
      try {
        socket.join(userRoom(user.id));
        const memberships = await prisma.conversationMember.findMany({
          where: { userId: user.id },
          select: { conversationId: true },
        });
        for (const m of memberships) socket.join(conversationRoom(m.conversationId));

        const becameOnline = addSocket(user.id, socket.id);
        socket.emit("presence:snapshot", { online: onlineUserIds() });
        if (becameOnline) {
          socket.broadcast.emit("presence:update", {
            userId: user.id,
            online: true,
            lastSeen: new Date().toISOString(),
          });
        }

        for (const m of memberships) {
          const ids = await markDelivered(m.conversationId, user.id);
          if (ids.length) {
            io.to(conversationRoom(m.conversationId)).emit("message:status", {
              conversationId: m.conversationId,
              messageIds: ids,
              status: "DELIVERED",
              by: user.id,
            });
          }
        }
      } catch (err) {
        console.error("socket connection setup error", err);
      }
    })();

    // --- send a message (text / gif / sticker) ---
    socket.on("message:send", async (input, ack) => {
      try {
        const rl = rateLimit(`send:${user.id}`, RATE_LIMITS.send.limit, RATE_LIMITS.send.windowMs);
        if (!rl.ok) {
          return ack({ ok: false, code: "RATE_LIMITED", message: "You're sending messages too fast. Slow down a moment." });
        }
        if (!["TEXT", "GIF", "STICKER"].includes(input.kind)) {
          return ack({ ok: false, code: "INVALID", message: "Unsupported message type for this channel." });
        }
        if (!(await isMember(input.conversationId, user.id))) {
          return ack({ ok: false, code: "FORBIDDEN", message: "You are not part of this conversation." });
        }

        // server-side profanity moderation — applies to the text body and to
        // GIF/sticker search titles carried in metadata.
        const textToScan = [input.body ?? "", input.metadata?.title ?? ""].join(" ").trim();
        if (textToScan) {
          const verdict = checkProfanity(textToScan);
          if (!verdict.clean) {
            await prisma.moderationLog.create({
              data: {
                userId: user.id,
                kind: "profanity",
                action: "blocked",
                reason: `matched: ${verdict.matched.join(", ")}`,
                detail: { conversationId: input.conversationId },
              },
            });
            return ack({
              ok: false,
              code: "PROFANITY",
              message: "Your message was blocked for prohibited language. Please rephrase and try again.",
              matched: verdict.matched,
            });
          }
        }

        const { message } = await createMessage({
          conversationId: input.conversationId,
          senderId: user.id,
          clientId: input.clientId,
          kind: input.kind,
          body: input.body,
          metadata: input.metadata,
          replyToId: input.replyToId ?? null,
        });

        const participantIds = await getMemberIds(input.conversationId);
        io.to(conversationRoom(input.conversationId)).emit("message:new", message);
        for (const uid of participantIds) {
          if (uid !== user.id) io.to(userRoom(uid)).emit("message:new", message);
        }
        ack({ ok: true, message });
      } catch (err) {
        if (err instanceof MessageError) {
          return ack({ ok: false, code: err.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID", message: err.message });
        }
        console.error("message:send error", err);
        ack({ ok: false, code: "ERROR", message: "Something went wrong sending your message." });
      }
    });

    // --- reactions ---
    socket.on("reaction:toggle", async ({ messageId, emoji }, ack) => {
      try {
        const rl = rateLimit(`react:${user.id}`, RATE_LIMITS.reaction.limit, RATE_LIMITS.reaction.windowMs);
        if (!rl.ok) return ack({ ok: false, message: "Slow down a moment." });
        const { conversationId, messageId: mid, reactions } = await toggleReaction(
          messageId,
          user.id,
          emoji
        );
        io.to(conversationRoom(conversationId)).emit("reaction:update", {
          conversationId,
          messageId: mid,
          reactions,
        });
        ack({ ok: true });
      } catch (err) {
        if (err instanceof MessageError) return ack({ ok: false, message: err.message });
        console.error("reaction:toggle error", err);
        ack({ ok: false, message: "Could not add reaction." });
      }
    });

    // --- reconnect reconciliation ---
    socket.on("message:sync", async ({ conversationId, afterId }, ack) => {
      try {
        const messages = await getMessagesAfter(conversationId, user.id, afterId);
        ack({ messages });
      } catch {
        ack({ messages: [] });
      }
    });

    // --- read receipts ---
    socket.on("message:read", async ({ conversationId }, ack) => {
      try {
        const { messageIds, readAt } = await markConversationRead(conversationId, user.id);
        if (messageIds.length) {
          io.to(conversationRoom(conversationId)).emit("message:status", {
            conversationId,
            messageIds,
            status: "READ",
            by: user.id,
          });
        }
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });

    // --- typing indicators ---
    const emitTyping = (conversationId: string, typing: boolean) => {
      socket.to(conversationRoom(conversationId)).emit("typing:update", {
        conversationId,
        userId: user.id,
        typing,
      });
    };
    socket.on("typing:start", ({ conversationId }) => emitTyping(conversationId, true));
    socket.on("typing:stop", ({ conversationId }) => emitTyping(conversationId, false));

    socket.on("presence:ping", () => {
      socket.emit("presence:snapshot", { online: onlineUserIds() });
    });

    socket.on("disconnect", () => {
      const becameOffline = removeSocket(user.id, socket.id);
      if (becameOffline) {
        socket.broadcast.emit("presence:update", {
          userId: user.id,
          online: false,
          lastSeen: getLastSeen(user.id),
        });
      }
    });
  });
}

export { isOnline };
