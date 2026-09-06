"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_config = require("dotenv/config");
var import_node_http = require("node:http");
var import_next = __toESM(require("next"));
var import_socket = require("socket.io");

// src/lib/env.ts
var import_zod = require("zod");
var schema = import_zod.z.object({
  DATABASE_URL: import_zod.z.string().min(1),
  AUTH_SECRET: import_zod.z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  AUTH_COOKIE: import_zod.z.string().default("rtm_session"),
  PORT: import_zod.z.coerce.number().default(3e3),
  HOSTNAME: import_zod.z.string().default("localhost"),
  APP_ORIGIN: import_zod.z.string().url().default("http://localhost:3000"),
  GIPHY_API_KEY: import_zod.z.string().min(1),
  STORAGE_DIR: import_zod.z.string().default("./storage"),
  MAX_UPLOAD_BYTES: import_zod.z.coerce.number().default(8388608),
  NSFW_MODEL_DIR: import_zod.z.string().default("./public/models/nsfw"),
  NSFW_THRESHOLD: import_zod.z.coerce.number().default(0.45)
});
var env = schema.parse(process.env);

// src/lib/auth-core.ts
var import_jose = require("jose");
var import_bcryptjs = __toESM(require("bcryptjs"));
var import_cookie = require("cookie");

// src/lib/prisma.ts
var import_client = require("@prisma/client");
var globalForPrisma = globalThis;
var prisma = globalForPrisma.prisma ?? new import_client.PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
});
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// src/lib/auth-core.ts
var secret = new TextEncoder().encode(env.AUTH_SECRET);
var SESSION_MAX_AGE = 60 * 60 * 24 * 7;
async function verifySessionToken(token) {
  try {
    const { payload } = await (0, import_jose.jwtVerify)(token, secret);
    if (!payload.sub) return null;
    return { sub: payload.sub, username: String(payload.username ?? "") };
  } catch {
    return null;
  }
}
async function loadUser(id) {
  return prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, displayName: true, avatarColor: true }
  });
}
async function getSessionUserFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const token = (0, import_cookie.parse)(cookieHeader)[env.AUTH_COOKIE];
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  return loadUser(payload.sub);
}

// src/lib/socket/events.ts
var userRoom = (userId) => `user:${userId}`;
var conversationRoom = (conversationId) => `conversation:${conversationId}`;

// src/lib/socket/presence.ts
var sockets = /* @__PURE__ */ new Map();
var lastSeen = /* @__PURE__ */ new Map();
function addSocket(userId, socketId) {
  const set = sockets.get(userId) ?? /* @__PURE__ */ new Set();
  const wasOffline = set.size === 0;
  set.add(socketId);
  sockets.set(userId, set);
  return wasOffline;
}
function removeSocket(userId, socketId) {
  const set = sockets.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    sockets.delete(userId);
    lastSeen.set(userId, (/* @__PURE__ */ new Date()).toISOString());
    return true;
  }
  return false;
}
function onlineUserIds() {
  return [...sockets.keys()];
}
function getLastSeen(userId) {
  return lastSeen.get(userId) ?? (/* @__PURE__ */ new Date()).toISOString();
}

// src/lib/rateLimit.ts
var buckets = /* @__PURE__ */ new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (existing.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }
  existing.count += 1;
  return { ok: true, remaining: limit - existing.count, retryAfterMs: 0 };
}
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 6e4).unref?.();
var RATE_LIMITS = {
  send: { limit: 30, windowMs: 1e4 },
  upload: { limit: 10, windowMs: 6e4 },
  auth: { limit: 10, windowMs: 6e4 },
  giphy: { limit: 60, windowMs: 6e4 },
  conversationCreate: { limit: 20, windowMs: 6e4 },
  reaction: { limit: 40, windowMs: 1e4 },
  messageEdit: { limit: 20, windowMs: 6e4 },
  messageDelete: { limit: 30, windowMs: 6e4 }
};

// src/lib/moderation/normalize.ts
var COMBINING_MARKS = /[̀-ͯ]/g;
var LEET_MAP = {
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  "$": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  "+": "t",
  "(": "c"
};
var HOMOGLYPHS = {
  "\u0430": "a",
  // Cyrillic а
  "\u0435": "e",
  // е
  "\u043E": "o",
  // о
  "\u0440": "p",
  // р
  "\u0441": "c",
  // с
  "\u0445": "x",
  // х
  "\u0443": "y",
  // у
  "\u0456": "i",
  // і
  "\u0455": "s"
  // ѕ
};
function subst(ch) {
  return HOMOGLYPHS[ch] ?? LEET_MAP[ch] ?? ch;
}
function normalizeToken(raw) {
  let s = raw.toLowerCase().normalize("NFKD").replace(COMBINING_MARKS, "");
  s = s.split("").map(subst).join("");
  s = s.replace(/[^a-z]/g, "");
  s = s.replace(/(.)\1{2,}/g, "$1");
  return s;
}
function collapseMessage(text) {
  return text.toLowerCase().normalize("NFKD").replace(COMBINING_MARKS, "").split("").map(subst).join("").replace(/[^a-z]/g, "").replace(/(.)\1{2,}/g, "$1");
}
function tokenize(text) {
  return text.split(/\s+/).filter(Boolean);
}

// src/lib/moderation/profanity.ts
var BLOCKLIST = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dick",
  "piss",
  "cunt",
  "slut",
  "whore",
  "nigger",
  "faggot",
  "retard",
  "motherfucker",
  "cocksucker",
  "wanker",
  "bollocks",
  "twat",
  "prick"
];
var ALLOWLIST = /* @__PURE__ */ new Set([
  "class",
  "classic",
  "assignment",
  "assess",
  "assassin",
  "assist",
  "assumption",
  "pass",
  "passage",
  "mass",
  "grass",
  "brass",
  "glass",
  "compass",
  "embassy",
  "scunthorpe",
  "dickens",
  "shitake",
  // rare but harmless
  "cockpit",
  "cocktail",
  "shuttlecock",
  "analysis",
  "analyst",
  "canal"
]);
function checkProfanity(text) {
  const matched = /* @__PURE__ */ new Set();
  for (const token of tokenize(text)) {
    const norm = normalizeToken(token);
    if (!norm || ALLOWLIST.has(norm)) continue;
    for (const bad of BLOCKLIST) {
      if (norm === bad) matched.add(bad);
    }
  }
  const collapsed = collapseMessage(text);
  if (collapsed.length <= 200) {
    for (const bad of BLOCKLIST) {
      if (!collapsed.includes(bad)) continue;
      const fromAllowed = [...ALLOWLIST].some(
        (w) => w.includes(bad) && collapsed.includes(w)
      );
      if (!fromAllowed) matched.add(bad);
    }
  }
  if (matched.size === 0) return { clean: true };
  return { clean: false, matched: [...matched] };
}

// src/server/messages.ts
var import_client2 = require("@prisma/client");

// src/server/serialize.ts
function previewFor(m) {
  if (m.deletedAt) return "This message was deleted";
  switch (m.kind) {
    case "IMAGE":
      return "\u{1F4F7} Photo";
    case "GIF":
      return "GIF";
    case "STICKER":
      return "Sticker";
    default:
      return m.body.length > 120 ? `${m.body.slice(0, 120)}\u2026` : m.body;
  }
}
function groupReactions(reactions = []) {
  const map = /* @__PURE__ */ new Map();
  for (const r of reactions) {
    const g2 = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, userIds: [] };
    g2.count += 1;
    g2.userIds.push(r.userId);
    map.set(r.emoji, g2);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}
function toMessageDTO(m) {
  const deleted = m.deletedAt != null;
  const replyTo = !deleted && m.replyTo ? {
    id: m.replyTo.id,
    senderId: m.replyTo.senderId,
    kind: m.replyTo.kind,
    preview: previewFor(m.replyTo)
  } : null;
  return {
    id: m.id,
    clientId: m.clientId,
    conversationId: m.conversationId,
    senderId: m.senderId,
    kind: m.kind,
    body: deleted ? "" : m.body,
    metadata: deleted ? null : m.metadata ?? null,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
    readBy: (m.reads ?? []).map((r) => r.userId),
    reactions: deleted ? [] : groupReactions(m.reactions),
    replyTo
  };
}
var messageInclude = {
  reads: true,
  reactions: true,
  replyTo: true
};

// src/server/conversations.ts
async function isMember(conversationId, userId) {
  const count = await prisma.conversationMember.count({
    where: { conversationId, userId }
  });
  return count > 0;
}
async function getMemberIds(conversationId) {
  const rows = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true }
  });
  return rows.map((r) => r.userId);
}

// src/server/messages.ts
var notHiddenFor = (userId) => ({ hiddenFor: { none: { userId } } });
var MessageError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var REACTION_EMOJI = ["\u{1F44D}", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}", "\u{1F525}", "\u{1F389}"];
async function createMessage(input) {
  if (!await isMember(input.conversationId, input.senderId)) {
    throw new MessageError("FORBIDDEN", "You are not a member of this conversation.");
  }
  const body = (input.body ?? "").trim();
  if (input.kind === "TEXT" && !body) {
    throw new MessageError("INVALID", "Message cannot be empty.");
  }
  if (input.kind === "TEXT" && body.length > 4e3) {
    throw new MessageError("INVALID", "Message is too long.");
  }
  if ((input.kind === "GIF" || input.kind === "STICKER" || input.kind === "IMAGE") && !input.metadata?.url) {
    throw new MessageError("INVALID", "Missing media reference.");
  }
  if (input.replyToId) {
    const parent = await prisma.message.findUnique({
      where: { id: input.replyToId },
      select: { conversationId: true }
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
          metadata: input.metadata ?? import_client2.Prisma.JsonNull,
          status: "SENT",
          replyToId: input.replyToId ?? null
        },
        include: messageInclude
      });
      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: /* @__PURE__ */ new Date() }
      });
      return created;
    });
    return { message: toMessageDTO(message), created: true };
  } catch (err) {
    if (err instanceof import_client2.Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.message.findUnique({
        where: {
          conversationId_clientId: {
            conversationId: input.conversationId,
            clientId: input.clientId
          }
        },
        include: messageInclude
      });
      if (existing) return { message: toMessageDTO(existing), created: false };
    }
    throw err;
  }
}
async function getMessagesAfter(conversationId, userId, afterId) {
  if (!await isMember(conversationId, userId)) {
    throw new MessageError("FORBIDDEN", "Not a member.");
  }
  let after = null;
  if (afterId) {
    const anchor = await prisma.message.findUnique({ where: { id: afterId }, select: { createdAt: true } });
    after = anchor?.createdAt ?? null;
  }
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      ...notHiddenFor(userId),
      ...after ? { createdAt: { gt: after } } : {}
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    include: messageInclude
  });
  return rows.map(toMessageDTO);
}
async function markConversationRead(conversationId, userId) {
  if (!await isMember(conversationId, userId)) {
    throw new MessageError("FORBIDDEN", "Not a member.");
  }
  const readAt = /* @__PURE__ */ new Date();
  const unread = await prisma.message.findMany({
    where: {
      conversationId,
      senderId: { not: userId },
      reads: { none: { userId } }
    },
    select: { id: true }
  });
  if (unread.length > 0) {
    await prisma.$transaction([
      prisma.messageRead.createMany({
        data: unread.map((m) => ({ messageId: m.id, userId, readAt })),
        skipDuplicates: true
      }),
      prisma.message.updateMany({
        where: { id: { in: unread.map((m) => m.id) } },
        data: { status: "READ" }
      })
    ]);
  }
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { lastReadAt: readAt }
  });
  return { messageIds: unread.map((m) => m.id), readAt };
}
async function toggleReaction(messageId, userId, emoji) {
  if (!REACTION_EMOJI.includes(emoji)) {
    throw new MessageError("INVALID", "Unsupported reaction.");
  }
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { conversationId: true }
  });
  if (!message) throw new MessageError("NOT_FOUND", "Message not found.");
  if (!await isMember(message.conversationId, userId)) {
    throw new MessageError("FORBIDDEN", "You are not a member of this conversation.");
  }
  const existing = await prisma.messageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId, emoji } }
  });
  if (existing) {
    await prisma.messageReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.messageReaction.create({ data: { messageId, userId, emoji } });
  }
  const all = await prisma.messageReaction.findMany({ where: { messageId } });
  const map = /* @__PURE__ */ new Map();
  for (const r of all) {
    const g2 = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, userIds: [] };
    g2.count += 1;
    g2.userIds.push(r.userId);
    map.set(r.emoji, g2);
  }
  const reactions = [...map.values()].sort(
    (a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji)
  );
  return { conversationId: message.conversationId, messageId, reactions };
}
async function editMessage(messageId, userId, rawBody) {
  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    select: { senderId: true, conversationId: true, kind: true, deletedAt: true }
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
  if (body.length > 4e3) throw new MessageError("INVALID", "Message is too long.");
  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { body, editedAt: /* @__PURE__ */ new Date() },
    include: messageInclude
  });
  return { message: toMessageDTO(updated), conversationId: existing.conversationId };
}
async function deleteMessageForEveryone(messageId, userId) {
  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    select: { senderId: true, conversationId: true, deletedAt: true }
  });
  if (!existing) throw new MessageError("NOT_FOUND", "Message not found.");
  if (existing.senderId !== userId) {
    throw new MessageError("FORBIDDEN", "You can only delete your own messages for everyone.");
  }
  if (existing.deletedAt) {
    const current = await prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: messageInclude
    });
    return { message: toMessageDTO(current), conversationId: existing.conversationId };
  }
  const updated = await prisma.$transaction(async (tx) => {
    await tx.messageReaction.deleteMany({ where: { messageId } });
    return tx.message.update({
      where: { id: messageId },
      data: { deletedAt: /* @__PURE__ */ new Date(), deletedById: userId, body: "", metadata: import_client2.Prisma.JsonNull },
      include: messageInclude
    });
  });
  return { message: toMessageDTO(updated), conversationId: existing.conversationId };
}
async function deleteMessageForMe(messageId, userId) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { conversationId: true }
  });
  if (!message) throw new MessageError("NOT_FOUND", "Message not found.");
  if (!await isMember(message.conversationId, userId)) {
    throw new MessageError("FORBIDDEN", "You are not a member of this conversation.");
  }
  await prisma.messageHidden.upsert({
    where: { messageId_userId: { messageId, userId } },
    create: { messageId, userId },
    update: {}
  });
  return { conversationId: message.conversationId };
}
async function markDelivered(conversationId, recipientId) {
  const pending = await prisma.message.findMany({
    where: { conversationId, senderId: { not: recipientId }, status: "SENT" },
    select: { id: true }
  });
  if (pending.length === 0) return [];
  await prisma.message.updateMany({
    where: { id: { in: pending.map((m) => m.id) } },
    data: { status: "DELIVERED" }
  });
  return pending.map((m) => m.id);
}

// src/lib/socket/handlers.ts
function registerSocketHandlers(io) {
  io.use(async (socket, next2) => {
    const user = await getSessionUserFromCookieHeader(socket.handshake.headers.cookie);
    if (!user) return next2(new Error("UNAUTHORIZED"));
    socket.data.user = user;
    next2();
  });
  io.on("connection", (socket) => {
    const user = socket.data.user;
    void (async () => {
      try {
        socket.join(userRoom(user.id));
        const memberships = await prisma.conversationMember.findMany({
          where: { userId: user.id },
          select: { conversationId: true }
        });
        for (const m of memberships) socket.join(conversationRoom(m.conversationId));
        const becameOnline = addSocket(user.id, socket.id);
        socket.emit("presence:snapshot", { online: onlineUserIds() });
        if (becameOnline) {
          socket.broadcast.emit("presence:update", {
            userId: user.id,
            online: true,
            lastSeen: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        for (const m of memberships) {
          const ids = await markDelivered(m.conversationId, user.id);
          if (ids.length) {
            io.to(conversationRoom(m.conversationId)).emit("message:status", {
              conversationId: m.conversationId,
              messageIds: ids,
              status: "DELIVERED",
              by: user.id
            });
          }
        }
      } catch (err) {
        console.error("socket connection setup error", err);
      }
    })();
    socket.on("message:send", async (input, ack) => {
      try {
        const rl = rateLimit(`send:${user.id}`, RATE_LIMITS.send.limit, RATE_LIMITS.send.windowMs);
        if (!rl.ok) {
          return ack({ ok: false, code: "RATE_LIMITED", message: "You're sending messages too fast. Slow down a moment." });
        }
        if (!["TEXT", "GIF", "STICKER"].includes(input.kind)) {
          return ack({ ok: false, code: "INVALID", message: "Unsupported message type for this channel." });
        }
        if (!await isMember(input.conversationId, user.id)) {
          return ack({ ok: false, code: "FORBIDDEN", message: "You are not part of this conversation." });
        }
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
                detail: { conversationId: input.conversationId }
              }
            });
            return ack({
              ok: false,
              code: "PROFANITY",
              message: "Your message was blocked for prohibited language. Please rephrase and try again.",
              matched: verdict.matched
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
          replyToId: input.replyToId ?? null
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
          reactions
        });
        ack({ ok: true });
      } catch (err) {
        if (err instanceof MessageError) return ack({ ok: false, message: err.message });
        console.error("reaction:toggle error", err);
        ack({ ok: false, message: "Could not add reaction." });
      }
    });
    socket.on("message:edit", async ({ messageId, body }, ack) => {
      try {
        const rl = rateLimit(`edit:${user.id}`, RATE_LIMITS.messageEdit.limit, RATE_LIMITS.messageEdit.windowMs);
        if (!rl.ok) {
          return ack({ ok: false, code: "RATE_LIMITED", message: "You're editing too fast. Slow down a moment." });
        }
        const verdict = checkProfanity(body ?? "");
        if (!verdict.clean) {
          await prisma.moderationLog.create({
            data: {
              userId: user.id,
              kind: "profanity",
              action: "blocked",
              reason: `matched: ${verdict.matched.join(", ")}`,
              detail: { messageId, edit: true }
            }
          });
          return ack({
            ok: false,
            code: "PROFANITY",
            message: "Your edit was blocked for prohibited language. Please rephrase and try again.",
            matched: verdict.matched
          });
        }
        const { message, conversationId } = await editMessage(messageId, user.id, body);
        io.to(conversationRoom(conversationId)).emit("message:update", message);
        ack({ ok: true, message });
      } catch (err) {
        if (err instanceof MessageError) {
          return ack({ ok: false, code: err.code === "FORBIDDEN" ? "FORBIDDEN" : "INVALID", message: err.message });
        }
        console.error("message:edit error", err);
        ack({ ok: false, code: "ERROR", message: "Could not edit the message." });
      }
    });
    socket.on("message:delete", async ({ messageId, scope }, ack) => {
      try {
        const rl = rateLimit(`del:${user.id}`, RATE_LIMITS.messageDelete.limit, RATE_LIMITS.messageDelete.windowMs);
        if (!rl.ok) return ack({ ok: false, message: "You're deleting too fast. Slow down a moment." });
        if (scope === "everyone") {
          const { message, conversationId } = await deleteMessageForEveryone(messageId, user.id);
          io.to(conversationRoom(conversationId)).emit("message:update", message);
        } else {
          const { conversationId } = await deleteMessageForMe(messageId, user.id);
          io.to(userRoom(user.id)).emit("message:removed", { conversationId, messageId });
        }
        ack({ ok: true });
      } catch (err) {
        if (err instanceof MessageError) return ack({ ok: false, message: err.message });
        console.error("message:delete error", err);
        ack({ ok: false, message: "Could not delete the message." });
      }
    });
    socket.on("message:sync", async ({ conversationId, afterId }, ack) => {
      try {
        const messages = await getMessagesAfter(conversationId, user.id, afterId);
        ack({ messages });
      } catch {
        ack({ messages: [] });
      }
    });
    socket.on("message:read", async ({ conversationId }, ack) => {
      try {
        const { messageIds, readAt } = await markConversationRead(conversationId, user.id);
        if (messageIds.length) {
          io.to(conversationRoom(conversationId)).emit("message:status", {
            conversationId,
            messageIds,
            status: "READ",
            by: user.id
          });
        }
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });
    const emitTyping = (conversationId, typing) => {
      socket.to(conversationRoom(conversationId)).emit("typing:update", {
        conversationId,
        userId: user.id,
        typing
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
          lastSeen: getLastSeen(user.id)
        });
      }
    });
  });
}

// src/lib/socket/io.ts
var g = globalThis;
function setIO(io) {
  g.__rtmIO = io;
}

// server.ts
var dev = process.env.NODE_ENV !== "production";
var app = (0, import_next.default)({ dev, hostname: env.HOSTNAME, port: env.PORT });
var handle = app.getRequestHandler();
async function main() {
  await app.prepare();
  const server = (0, import_node_http.createServer)((req, res) => {
    handle(req, res);
  });
  const io = new import_socket.Server(server, {
    path: "/socket.io",
    cors: { origin: env.APP_ORIGIN, credentials: true },
    // survive brief network blips without dropping the session
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1e3,
      skipMiddlewares: false
    }
  });
  setIO(io);
  registerSocketHandlers(io);
  server.listen(env.PORT, () => {
    console.log(`
  \u25B8 Realtime Messaging ready on ${env.APP_ORIGIN}
`);
  });
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc2VydmVyLnRzIiwgIi4uL3NyYy9saWIvZW52LnRzIiwgIi4uL3NyYy9saWIvYXV0aC1jb3JlLnRzIiwgIi4uL3NyYy9saWIvcHJpc21hLnRzIiwgIi4uL3NyYy9saWIvc29ja2V0L2V2ZW50cy50cyIsICIuLi9zcmMvbGliL3NvY2tldC9wcmVzZW5jZS50cyIsICIuLi9zcmMvbGliL3JhdGVMaW1pdC50cyIsICIuLi9zcmMvbGliL21vZGVyYXRpb24vbm9ybWFsaXplLnRzIiwgIi4uL3NyYy9saWIvbW9kZXJhdGlvbi9wcm9mYW5pdHkudHMiLCAiLi4vc3JjL3NlcnZlci9tZXNzYWdlcy50cyIsICIuLi9zcmMvc2VydmVyL3NlcmlhbGl6ZS50cyIsICIuLi9zcmMvc2VydmVyL2NvbnZlcnNhdGlvbnMudHMiLCAiLi4vc3JjL2xpYi9zb2NrZXQvaGFuZGxlcnMudHMiLCAiLi4vc3JjL2xpYi9zb2NrZXQvaW8udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCBcImRvdGVudi9jb25maWdcIjtcbmltcG9ydCB7IGNyZWF0ZVNlcnZlciB9IGZyb20gXCJub2RlOmh0dHBcIjtcbmltcG9ydCBuZXh0IGZyb20gXCJuZXh0XCI7XG5pbXBvcnQgeyBTZXJ2ZXIgYXMgSU9TZXJ2ZXIgfSBmcm9tIFwic29ja2V0LmlvXCI7XG5pbXBvcnQgeyBlbnYgfSBmcm9tIFwiLi9zcmMvbGliL2VudlwiO1xuaW1wb3J0IHsgcmVnaXN0ZXJTb2NrZXRIYW5kbGVycyB9IGZyb20gXCIuL3NyYy9saWIvc29ja2V0L2hhbmRsZXJzXCI7XG5pbXBvcnQgeyBzZXRJTywgdHlwZSBUeXBlZFNlcnZlciB9IGZyb20gXCIuL3NyYy9saWIvc29ja2V0L2lvXCI7XG5cbmNvbnN0IGRldiA9IHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSBcInByb2R1Y3Rpb25cIjtcbmNvbnN0IGFwcCA9IG5leHQoeyBkZXYsIGhvc3RuYW1lOiBlbnYuSE9TVE5BTUUsIHBvcnQ6IGVudi5QT1JUIH0pO1xuY29uc3QgaGFuZGxlID0gYXBwLmdldFJlcXVlc3RIYW5kbGVyKCk7XG5cbmFzeW5jIGZ1bmN0aW9uIG1haW4oKSB7XG4gIGF3YWl0IGFwcC5wcmVwYXJlKCk7XG5cbiAgY29uc3Qgc2VydmVyID0gY3JlYXRlU2VydmVyKChyZXEsIHJlcykgPT4ge1xuICAgIGhhbmRsZShyZXEsIHJlcyk7XG4gIH0pO1xuXG4gIGNvbnN0IGlvOiBUeXBlZFNlcnZlciA9IG5ldyBJT1NlcnZlcihzZXJ2ZXIsIHtcbiAgICBwYXRoOiBcIi9zb2NrZXQuaW9cIixcbiAgICBjb3JzOiB7IG9yaWdpbjogZW52LkFQUF9PUklHSU4sIGNyZWRlbnRpYWxzOiB0cnVlIH0sXG4gICAgLy8gc3Vydml2ZSBicmllZiBuZXR3b3JrIGJsaXBzIHdpdGhvdXQgZHJvcHBpbmcgdGhlIHNlc3Npb25cbiAgICBjb25uZWN0aW9uU3RhdGVSZWNvdmVyeToge1xuICAgICAgbWF4RGlzY29ubmVjdGlvbkR1cmF0aW9uOiAyICogNjAgKiAxMDAwLFxuICAgICAgc2tpcE1pZGRsZXdhcmVzOiBmYWxzZSxcbiAgICB9LFxuICB9KTtcblxuICBzZXRJTyhpbyk7XG4gIHJlZ2lzdGVyU29ja2V0SGFuZGxlcnMoaW8pO1xuXG4gIHNlcnZlci5saXN0ZW4oZW52LlBPUlQsICgpID0+IHtcbiAgICBjb25zb2xlLmxvZyhgXFxuICBcdTI1QjggUmVhbHRpbWUgTWVzc2FnaW5nIHJlYWR5IG9uICR7ZW52LkFQUF9PUklHSU59XFxuYCk7XG4gIH0pO1xufVxuXG5tYWluKCkuY2F0Y2goKGVycikgPT4ge1xuICBjb25zb2xlLmVycm9yKGVycik7XG4gIHByb2Nlc3MuZXhpdCgxKTtcbn0pO1xuIiwgIi8qKiBDZW50cmFsaXNlZCwgdmFsaWRhdGVkIGVudmlyb25tZW50IGFjY2Vzcy4gRmFpbHMgZmFzdCBvbiBtaXNjb25maWd1cmF0aW9uLiAqL1xuaW1wb3J0IHsgeiB9IGZyb20gXCJ6b2RcIjtcblxuY29uc3Qgc2NoZW1hID0gei5vYmplY3Qoe1xuICBEQVRBQkFTRV9VUkw6IHouc3RyaW5nKCkubWluKDEpLFxuICBBVVRIX1NFQ1JFVDogei5zdHJpbmcoKS5taW4oMzIsIFwiQVVUSF9TRUNSRVQgbXVzdCBiZSBhdCBsZWFzdCAzMiBjaGFyYWN0ZXJzXCIpLFxuICBBVVRIX0NPT0tJRTogei5zdHJpbmcoKS5kZWZhdWx0KFwicnRtX3Nlc3Npb25cIiksXG4gIFBPUlQ6IHouY29lcmNlLm51bWJlcigpLmRlZmF1bHQoMzAwMCksXG4gIEhPU1ROQU1FOiB6LnN0cmluZygpLmRlZmF1bHQoXCJsb2NhbGhvc3RcIiksXG4gIEFQUF9PUklHSU46IHouc3RyaW5nKCkudXJsKCkuZGVmYXVsdChcImh0dHA6Ly9sb2NhbGhvc3Q6MzAwMFwiKSxcbiAgR0lQSFlfQVBJX0tFWTogei5zdHJpbmcoKS5taW4oMSksXG4gIFNUT1JBR0VfRElSOiB6LnN0cmluZygpLmRlZmF1bHQoXCIuL3N0b3JhZ2VcIiksXG4gIE1BWF9VUExPQURfQllURVM6IHouY29lcmNlLm51bWJlcigpLmRlZmF1bHQoOF8zODhfNjA4KSxcbiAgTlNGV19NT0RFTF9ESVI6IHouc3RyaW5nKCkuZGVmYXVsdChcIi4vcHVibGljL21vZGVscy9uc2Z3XCIpLFxuICBOU0ZXX1RIUkVTSE9MRDogei5jb2VyY2UubnVtYmVyKCkuZGVmYXVsdCgwLjQ1KSxcbn0pO1xuXG5leHBvcnQgY29uc3QgZW52ID0gc2NoZW1hLnBhcnNlKHByb2Nlc3MuZW52KTtcbiIsICJpbXBvcnQgeyBTaWduSldULCBqd3RWZXJpZnkgfSBmcm9tIFwiam9zZVwiO1xuaW1wb3J0IGJjcnlwdCBmcm9tIFwiYmNyeXB0anNcIjtcbmltcG9ydCB7IHBhcnNlIGFzIHBhcnNlQ29va2llIH0gZnJvbSBcImNvb2tpZVwiO1xuaW1wb3J0IHsgZW52IH0gZnJvbSBcIi4vZW52XCI7XG5pbXBvcnQgeyBwcmlzbWEgfSBmcm9tIFwiLi9wcmlzbWFcIjtcblxuLyoqXG4gKiBGcmFtZXdvcmstYWdub3N0aWMgYXV0aCBwcmltaXRpdmVzLiBTYWZlIHRvIGltcG9ydCBmcm9tIHRoZSBzdGFuZGFsb25lXG4gKiBTb2NrZXQuSU8gc2VydmVyIChubyBgbmV4dC9oZWFkZXJzYCBkZXBlbmRlbmN5KS5cbiAqL1xuXG5jb25zdCBzZWNyZXQgPSBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoZW52LkFVVEhfU0VDUkVUKTtcbmV4cG9ydCBjb25zdCBTRVNTSU9OX01BWF9BR0UgPSA2MCAqIDYwICogMjQgKiA3OyAvLyA3IGRheXNcblxuZXhwb3J0IHR5cGUgU2Vzc2lvblVzZXIgPSB7XG4gIGlkOiBzdHJpbmc7XG4gIHVzZXJuYW1lOiBzdHJpbmc7XG4gIGRpc3BsYXlOYW1lOiBzdHJpbmc7XG4gIGF2YXRhckNvbG9yOiBzdHJpbmc7XG59O1xuXG5leHBvcnQgdHlwZSBTZXNzaW9uUGF5bG9hZCA9IHsgc3ViOiBzdHJpbmc7IHVzZXJuYW1lOiBzdHJpbmcgfTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhc2hQYXNzd29yZChwbGFpbjogc3RyaW5nKSB7XG4gIHJldHVybiBiY3J5cHQuaGFzaChwbGFpbiwgMTApO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5UGFzc3dvcmQocGxhaW46IHN0cmluZywgaGFzaDogc3RyaW5nKSB7XG4gIHJldHVybiBiY3J5cHQuY29tcGFyZShwbGFpbiwgaGFzaCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVTZXNzaW9uVG9rZW4ocGF5bG9hZDogU2Vzc2lvblBheWxvYWQpIHtcbiAgcmV0dXJuIG5ldyBTaWduSldUKHsgdXNlcm5hbWU6IHBheWxvYWQudXNlcm5hbWUgfSlcbiAgICAuc2V0UHJvdGVjdGVkSGVhZGVyKHsgYWxnOiBcIkhTMjU2XCIgfSlcbiAgICAuc2V0U3ViamVjdChwYXlsb2FkLnN1YilcbiAgICAuc2V0SXNzdWVkQXQoKVxuICAgIC5zZXRFeHBpcmF0aW9uVGltZShgJHtTRVNTSU9OX01BWF9BR0V9c2ApXG4gICAgLnNpZ24oc2VjcmV0KTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeVNlc3Npb25Ub2tlbih0b2tlbjogc3RyaW5nKTogUHJvbWlzZTxTZXNzaW9uUGF5bG9hZCB8IG51bGw+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCB7IHBheWxvYWQgfSA9IGF3YWl0IGp3dFZlcmlmeSh0b2tlbiwgc2VjcmV0KTtcbiAgICBpZiAoIXBheWxvYWQuc3ViKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4geyBzdWI6IHBheWxvYWQuc3ViLCB1c2VybmFtZTogU3RyaW5nKHBheWxvYWQudXNlcm5hbWUgPz8gXCJcIikgfTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25Db29raWVPcHRpb25zKG1heEFnZSA9IFNFU1NJT05fTUFYX0FHRSkge1xuICByZXR1cm4ge1xuICAgIGh0dHBPbmx5OiB0cnVlLFxuICAgIHNhbWVTaXRlOiBcImxheFwiIGFzIGNvbnN0LFxuICAgIHNlY3VyZTogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09IFwicHJvZHVjdGlvblwiLFxuICAgIHBhdGg6IFwiL1wiLFxuICAgIG1heEFnZSxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRVc2VyKGlkOiBzdHJpbmcpOiBQcm9taXNlPFNlc3Npb25Vc2VyIHwgbnVsbD4ge1xuICByZXR1cm4gcHJpc21hLnVzZXIuZmluZFVuaXF1ZSh7XG4gICAgd2hlcmU6IHsgaWQgfSxcbiAgICBzZWxlY3Q6IHsgaWQ6IHRydWUsIHVzZXJuYW1lOiB0cnVlLCBkaXNwbGF5TmFtZTogdHJ1ZSwgYXZhdGFyQ29sb3I6IHRydWUgfSxcbiAgfSk7XG59XG5cbi8qKiBTb2NrZXQuSU8gaGFuZHNoYWtlIGhlbHBlciBcdTIwMTQgcGFyc2VzIHRoZSByYXcgQ29va2llIGhlYWRlci4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRTZXNzaW9uVXNlckZyb21Db29raWVIZWFkZXIoXG4gIGNvb2tpZUhlYWRlcjogc3RyaW5nIHwgdW5kZWZpbmVkXG4pOiBQcm9taXNlPFNlc3Npb25Vc2VyIHwgbnVsbD4ge1xuICBpZiAoIWNvb2tpZUhlYWRlcikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHRva2VuID0gcGFyc2VDb29raWUoY29va2llSGVhZGVyKVtlbnYuQVVUSF9DT09LSUVdO1xuICBpZiAoIXRva2VuKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcGF5bG9hZCA9IGF3YWl0IHZlcmlmeVNlc3Npb25Ub2tlbih0b2tlbik7XG4gIGlmICghcGF5bG9hZCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBsb2FkVXNlcihwYXlsb2FkLnN1Yik7XG59XG4iLCAiaW1wb3J0IHsgUHJpc21hQ2xpZW50IH0gZnJvbSBcIkBwcmlzbWEvY2xpZW50XCI7XG5cbmNvbnN0IGdsb2JhbEZvclByaXNtYSA9IGdsb2JhbFRoaXMgYXMgdW5rbm93biBhcyB7IHByaXNtYT86IFByaXNtYUNsaWVudCB9O1xuXG5leHBvcnQgY29uc3QgcHJpc21hID1cbiAgZ2xvYmFsRm9yUHJpc21hLnByaXNtYSA/P1xuICBuZXcgUHJpc21hQ2xpZW50KHtcbiAgICBsb2c6IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSBcImRldmVsb3BtZW50XCIgPyBbXCJ3YXJuXCIsIFwiZXJyb3JcIl0gOiBbXCJlcnJvclwiXSxcbiAgfSk7XG5cbmlmIChwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gXCJwcm9kdWN0aW9uXCIpIGdsb2JhbEZvclByaXNtYS5wcmlzbWEgPSBwcmlzbWE7XG4iLCAiaW1wb3J0IHR5cGUgeyBNZXNzYWdlRFRPLCBNZXNzYWdlS2luZCwgTWVzc2FnZU1ldGFkYXRhLCBSZWFjdGlvbkdyb3VwIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbi8qKiBXaXJlIGNvbnRyYWN0IGZvciB0aGUgU29ja2V0LklPIGNvbm5lY3Rpb24uICovXG5cbmV4cG9ydCB0eXBlIFNlbmRNZXNzYWdlSW5wdXQgPSB7XG4gIGNvbnZlcnNhdGlvbklkOiBzdHJpbmc7XG4gIGNsaWVudElkOiBzdHJpbmc7IC8vIGlkZW1wb3RlbmN5IGtleSAvIG9wdGltaXN0aWMgdGVtcCBpZFxuICBraW5kOiBNZXNzYWdlS2luZDtcbiAgYm9keT86IHN0cmluZztcbiAgbWV0YWRhdGE/OiBNZXNzYWdlTWV0YWRhdGE7XG4gIHJlcGx5VG9JZD86IHN0cmluZyB8IG51bGw7XG59O1xuXG5leHBvcnQgdHlwZSBTZW5kQWNrID1cbiAgfCB7IG9rOiB0cnVlOyBtZXNzYWdlOiBNZXNzYWdlRFRPIH1cbiAgfCB7IG9rOiBmYWxzZTsgY29kZTogXCJSQVRFX0xJTUlURURcIiB8IFwiUFJPRkFOSVRZXCIgfCBcIkZPUkJJRERFTlwiIHwgXCJJTlZBTElEXCIgfCBcIkVSUk9SXCI7IG1lc3NhZ2U6IHN0cmluZzsgbWF0Y2hlZD86IHN0cmluZ1tdIH07XG5cbi8qKiBTYW1lIHNoYXBlIGFzIFNlbmRBY2sgXHUyMDE0IGVkaXQgcmUtcnVucyBwcm9mYW5pdHkgbW9kZXJhdGlvbi4gKi9cbmV4cG9ydCB0eXBlIEVkaXRBY2sgPSBTZW5kQWNrO1xuXG5leHBvcnQgdHlwZSBEZWxldGVTY29wZSA9IFwibWVcIiB8IFwiZXZlcnlvbmVcIjtcblxuZXhwb3J0IHR5cGUgUHJlc2VuY2VQYXlsb2FkID0geyB1c2VySWQ6IHN0cmluZzsgb25saW5lOiBib29sZWFuOyBsYXN0U2Vlbjogc3RyaW5nIH07XG5cbmV4cG9ydCB0eXBlIFR5cGluZ1BheWxvYWQgPSB7IGNvbnZlcnNhdGlvbklkOiBzdHJpbmc7IHVzZXJJZDogc3RyaW5nOyB0eXBpbmc6IGJvb2xlYW4gfTtcblxuZXhwb3J0IHR5cGUgUmVhZFBheWxvYWQgPSB7IGNvbnZlcnNhdGlvbklkOiBzdHJpbmc7IHVzZXJJZDogc3RyaW5nOyByZWFkQXQ6IHN0cmluZzsgbWVzc2FnZUlkczogc3RyaW5nW10gfTtcblxuZXhwb3J0IHR5cGUgUmVhY3Rpb25VcGRhdGUgPSB7XG4gIGNvbnZlcnNhdGlvbklkOiBzdHJpbmc7XG4gIG1lc3NhZ2VJZDogc3RyaW5nO1xuICByZWFjdGlvbnM6IFJlYWN0aW9uR3JvdXBbXTtcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VydmVyVG9DbGllbnRFdmVudHMge1xuICBcIm1lc3NhZ2U6bmV3XCI6IChtc2c6IE1lc3NhZ2VEVE8pID0+IHZvaWQ7XG4gIFwibWVzc2FnZTpzdGF0dXNcIjogKHA6IHsgY29udmVyc2F0aW9uSWQ6IHN0cmluZzsgbWVzc2FnZUlkczogc3RyaW5nW107IHN0YXR1czogXCJERUxJVkVSRURcIiB8IFwiUkVBRFwiOyBieTogc3RyaW5nIH0pID0+IHZvaWQ7XG4gIC8vIGVkaXQgKyBcImRlbGV0ZSBmb3IgZXZlcnlvbmVcIiBcdTIwMTQgdGhlIGZ1bGwgdXBkYXRlZCBEVE9cbiAgXCJtZXNzYWdlOnVwZGF0ZVwiOiAobXNnOiBNZXNzYWdlRFRPKSA9PiB2b2lkO1xuICAvLyBcImRlbGV0ZSBmb3IgbWVcIiBcdTIwMTQgc2VudCBvbmx5IHRvIHRoZSBhY3RpbmcgdXNlcidzIG93biByb29tIChhbGwgdGhlaXIgdGFicylcbiAgXCJtZXNzYWdlOnJlbW92ZWRcIjogKHA6IHsgY29udmVyc2F0aW9uSWQ6IHN0cmluZzsgbWVzc2FnZUlkOiBzdHJpbmcgfSkgPT4gdm9pZDtcbiAgXCJyZWFjdGlvbjp1cGRhdGVcIjogKHA6IFJlYWN0aW9uVXBkYXRlKSA9PiB2b2lkO1xuICBcInByZXNlbmNlOnVwZGF0ZVwiOiAocDogUHJlc2VuY2VQYXlsb2FkKSA9PiB2b2lkO1xuICBcInByZXNlbmNlOnNuYXBzaG90XCI6IChwOiB7IG9ubGluZTogc3RyaW5nW10gfSkgPT4gdm9pZDtcbiAgXCJ0eXBpbmc6dXBkYXRlXCI6IChwOiBUeXBpbmdQYXlsb2FkKSA9PiB2b2lkO1xuICBcImNvbnZlcnNhdGlvbjpuZXdcIjogKGNvbnZlcnNhdGlvbklkOiBzdHJpbmcpID0+IHZvaWQ7XG4gIFwiZXJyb3I6dG9hc3RcIjogKHA6IHsgbWVzc2FnZTogc3RyaW5nIH0pID0+IHZvaWQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2xpZW50VG9TZXJ2ZXJFdmVudHMge1xuICBcIm1lc3NhZ2U6c2VuZFwiOiAoaW5wdXQ6IFNlbmRNZXNzYWdlSW5wdXQsIGFjazogKHJlczogU2VuZEFjaykgPT4gdm9pZCkgPT4gdm9pZDtcbiAgXCJtZXNzYWdlOnJlYWRcIjogKHA6IHsgY29udmVyc2F0aW9uSWQ6IHN0cmluZyB9LCBhY2s/OiAocmVzOiB7IG9rOiBib29sZWFuIH0pID0+IHZvaWQpID0+IHZvaWQ7XG4gIFwibWVzc2FnZTpzeW5jXCI6IChwOiB7IGNvbnZlcnNhdGlvbklkOiBzdHJpbmc7IGFmdGVySWQ6IHN0cmluZyB8IG51bGwgfSwgYWNrOiAocmVzOiB7IG1lc3NhZ2VzOiBNZXNzYWdlRFRPW10gfSkgPT4gdm9pZCkgPT4gdm9pZDtcbiAgXCJyZWFjdGlvbjp0b2dnbGVcIjogKHA6IHsgbWVzc2FnZUlkOiBzdHJpbmc7IGVtb2ppOiBzdHJpbmcgfSwgYWNrOiAocmVzOiB7IG9rOiBib29sZWFuOyBtZXNzYWdlPzogc3RyaW5nIH0pID0+IHZvaWQpID0+IHZvaWQ7XG4gIFwibWVzc2FnZTplZGl0XCI6IChwOiB7IG1lc3NhZ2VJZDogc3RyaW5nOyBib2R5OiBzdHJpbmcgfSwgYWNrOiAocmVzOiBFZGl0QWNrKSA9PiB2b2lkKSA9PiB2b2lkO1xuICBcIm1lc3NhZ2U6ZGVsZXRlXCI6IChwOiB7IG1lc3NhZ2VJZDogc3RyaW5nOyBzY29wZTogRGVsZXRlU2NvcGUgfSwgYWNrOiAocmVzOiB7IG9rOiBib29sZWFuOyBtZXNzYWdlPzogc3RyaW5nIH0pID0+IHZvaWQpID0+IHZvaWQ7XG4gIFwidHlwaW5nOnN0YXJ0XCI6IChwOiB7IGNvbnZlcnNhdGlvbklkOiBzdHJpbmcgfSkgPT4gdm9pZDtcbiAgXCJ0eXBpbmc6c3RvcFwiOiAocDogeyBjb252ZXJzYXRpb25JZDogc3RyaW5nIH0pID0+IHZvaWQ7XG4gIFwicHJlc2VuY2U6cGluZ1wiOiAoKSA9PiB2b2lkO1xufVxuXG5leHBvcnQgY29uc3QgdXNlclJvb20gPSAodXNlcklkOiBzdHJpbmcpID0+IGB1c2VyOiR7dXNlcklkfWA7XG5leHBvcnQgY29uc3QgY29udmVyc2F0aW9uUm9vbSA9IChjb252ZXJzYXRpb25JZDogc3RyaW5nKSA9PiBgY29udmVyc2F0aW9uOiR7Y29udmVyc2F0aW9uSWR9YDtcbiIsICIvKipcbiAqIEluLXByb2Nlc3MgcHJlc2VuY2UgdHJhY2tpbmcuIHVzZXJJZCAtPiBzZXQgb2YgbGl2ZSBzb2NrZXQgaWRzLlxuICogTXVsdGktdGFiIHNhZmU6IGEgdXNlciBpcyBcIm9ubGluZVwiIHdoaWxlIGF0IGxlYXN0IG9uZSBzb2NrZXQgaXMgY29ubmVjdGVkLlxuICovXG5jb25zdCBzb2NrZXRzID0gbmV3IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+PigpO1xuY29uc3QgbGFzdFNlZW4gPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuXG5leHBvcnQgZnVuY3Rpb24gYWRkU29ja2V0KHVzZXJJZDogc3RyaW5nLCBzb2NrZXRJZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGNvbnN0IHNldCA9IHNvY2tldHMuZ2V0KHVzZXJJZCkgPz8gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IHdhc09mZmxpbmUgPSBzZXQuc2l6ZSA9PT0gMDtcbiAgc2V0LmFkZChzb2NrZXRJZCk7XG4gIHNvY2tldHMuc2V0KHVzZXJJZCwgc2V0KTtcbiAgcmV0dXJuIHdhc09mZmxpbmU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVTb2NrZXQodXNlcklkOiBzdHJpbmcsIHNvY2tldElkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgY29uc3Qgc2V0ID0gc29ja2V0cy5nZXQodXNlcklkKTtcbiAgaWYgKCFzZXQpIHJldHVybiBmYWxzZTtcbiAgc2V0LmRlbGV0ZShzb2NrZXRJZCk7XG4gIGlmIChzZXQuc2l6ZSA9PT0gMCkge1xuICAgIHNvY2tldHMuZGVsZXRlKHVzZXJJZCk7XG4gICAgbGFzdFNlZW4uc2V0KHVzZXJJZCwgbmV3IERhdGUoKS50b0lTT1N0cmluZygpKTtcbiAgICByZXR1cm4gdHJ1ZTsgLy8gYmVjYW1lIG9mZmxpbmVcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc09ubGluZSh1c2VySWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gKHNvY2tldHMuZ2V0KHVzZXJJZCk/LnNpemUgPz8gMCkgPiAwO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gb25saW5lVXNlcklkcygpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBbLi4uc29ja2V0cy5rZXlzKCldO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGFzdFNlZW4odXNlcklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbGFzdFNlZW4uZ2V0KHVzZXJJZCkgPz8gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xufVxuIiwgIi8qKlxuICogSW4tbWVtb3J5IHNsaWRpbmctd2luZG93IHJhdGUgbGltaXRlci5cbiAqXG4gKiBTdWZmaWNpZW50IGZvciBhIHNpbmdsZS1ub2RlIGRlcGxveW1lbnQgKHRoaXMgYXNzaWdubWVudCkuIEZvciBhIGhvcml6b250YWxseVxuICogc2NhbGVkIGRlcGxveW1lbnQsIHN3YXAgdGhlIE1hcCBmb3IgUmVkaXMgKElOQ1IgKyBFWFBJUkUpIFx1MjAxNCB0aGUgY2FsbCBzaXRlcyBhbmRcbiAqIHRoZSBgUmF0ZUxpbWl0UmVzdWx0YCBjb250cmFjdCBzdGF5IGlkZW50aWNhbC5cbiAqL1xudHlwZSBCdWNrZXQgPSB7IGNvdW50OiBudW1iZXI7IHJlc2V0QXQ6IG51bWJlciB9O1xuXG5jb25zdCBidWNrZXRzID0gbmV3IE1hcDxzdHJpbmcsIEJ1Y2tldD4oKTtcblxuZXhwb3J0IHR5cGUgUmF0ZUxpbWl0UmVzdWx0ID0ge1xuICBvazogYm9vbGVhbjtcbiAgcmVtYWluaW5nOiBudW1iZXI7XG4gIHJldHJ5QWZ0ZXJNczogbnVtYmVyO1xufTtcblxuZXhwb3J0IGZ1bmN0aW9uIHJhdGVMaW1pdChrZXk6IHN0cmluZywgbGltaXQ6IG51bWJlciwgd2luZG93TXM6IG51bWJlcik6IFJhdGVMaW1pdFJlc3VsdCB7XG4gIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gIGNvbnN0IGV4aXN0aW5nID0gYnVja2V0cy5nZXQoa2V5KTtcblxuICBpZiAoIWV4aXN0aW5nIHx8IGV4aXN0aW5nLnJlc2V0QXQgPD0gbm93KSB7XG4gICAgYnVja2V0cy5zZXQoa2V5LCB7IGNvdW50OiAxLCByZXNldEF0OiBub3cgKyB3aW5kb3dNcyB9KTtcbiAgICByZXR1cm4geyBvazogdHJ1ZSwgcmVtYWluaW5nOiBsaW1pdCAtIDEsIHJldHJ5QWZ0ZXJNczogMCB9O1xuICB9XG5cbiAgaWYgKGV4aXN0aW5nLmNvdW50ID49IGxpbWl0KSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZW1haW5pbmc6IDAsIHJldHJ5QWZ0ZXJNczogZXhpc3RpbmcucmVzZXRBdCAtIG5vdyB9O1xuICB9XG5cbiAgZXhpc3RpbmcuY291bnQgKz0gMTtcbiAgcmV0dXJuIHsgb2s6IHRydWUsIHJlbWFpbmluZzogbGltaXQgLSBleGlzdGluZy5jb3VudCwgcmV0cnlBZnRlck1zOiAwIH07XG59XG5cbi8vIE9wcG9ydHVuaXN0aWMgY2xlYW51cCBzbyB0aGUgTWFwIGNhbm5vdCBncm93IHVuYm91bmRlZC5cbnNldEludGVydmFsKCgpID0+IHtcbiAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgZm9yIChjb25zdCBba2V5LCBidWNrZXRdIG9mIGJ1Y2tldHMpIHtcbiAgICBpZiAoYnVja2V0LnJlc2V0QXQgPD0gbm93KSBidWNrZXRzLmRlbGV0ZShrZXkpO1xuICB9XG59LCA2MF8wMDApLnVucmVmPy4oKTtcblxuZXhwb3J0IGNvbnN0IFJBVEVfTElNSVRTID0ge1xuICBzZW5kOiB7IGxpbWl0OiAzMCwgd2luZG93TXM6IDEwXzAwMCB9LFxuICB1cGxvYWQ6IHsgbGltaXQ6IDEwLCB3aW5kb3dNczogNjBfMDAwIH0sXG4gIGF1dGg6IHsgbGltaXQ6IDEwLCB3aW5kb3dNczogNjBfMDAwIH0sXG4gIGdpcGh5OiB7IGxpbWl0OiA2MCwgd2luZG93TXM6IDYwXzAwMCB9LFxuICBjb252ZXJzYXRpb25DcmVhdGU6IHsgbGltaXQ6IDIwLCB3aW5kb3dNczogNjBfMDAwIH0sXG4gIHJlYWN0aW9uOiB7IGxpbWl0OiA0MCwgd2luZG93TXM6IDEwXzAwMCB9LFxuICBtZXNzYWdlRWRpdDogeyBsaW1pdDogMjAsIHdpbmRvd01zOiA2MF8wMDAgfSxcbiAgbWVzc2FnZURlbGV0ZTogeyBsaW1pdDogMzAsIHdpbmRvd01zOiA2MF8wMDAgfSxcbn0gYXMgY29uc3Q7XG4iLCAiLyoqXG4gKiBUZXh0IG5vcm1hbGlzYXRpb24gZm9yIHByb2Zhbml0eSBtYXRjaGluZy5cbiAqXG4gKiBEZWZlYXRzIHRoZSBjb21tb24sIFwic3RyYWlnaHRmb3J3YXJkXCIgZXZhc2lvbiB0ZWNobmlxdWVzIGNhbGxlZCBvdXQgaW4gdGhlXG4gKiBicmllZjogY2FzaW5nLCBwYWRkaW5nIHdoaXRlc3BhY2UvcHVuY3R1YXRpb24gYmV0d2VlbiBsZXR0ZXJzLCByZXBlYXRlZFxuICogbGV0dGVycywgYW5kIGxlZXRzcGVhayAvIGhvbW9nbHlwaCBjaGFyYWN0ZXIgc3Vic3RpdHV0aW9uLlxuICovXG5cbmNvbnN0IENPTUJJTklOR19NQVJLUyA9IC9bXHUwMzAwLVx1MDM2Rl0vZztcblxuY29uc3QgTEVFVF9NQVA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gIFwiMFwiOiBcIm9cIixcbiAgXCIxXCI6IFwiaVwiLFxuICBcIiFcIjogXCJpXCIsXG4gIFwifFwiOiBcImlcIixcbiAgXCIzXCI6IFwiZVwiLFxuICBcIjRcIjogXCJhXCIsXG4gIFwiQFwiOiBcImFcIixcbiAgXCI1XCI6IFwic1wiLFxuICBcIiRcIjogXCJzXCIsXG4gIFwiN1wiOiBcInRcIixcbiAgXCI4XCI6IFwiYlwiLFxuICBcIjlcIjogXCJnXCIsXG4gIFwiK1wiOiBcInRcIixcbiAgXCIoXCI6IFwiY1wiLFxufTtcblxuY29uc3QgSE9NT0dMWVBIUzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgXCJcdTA0MzBcIjogXCJhXCIsIC8vIEN5cmlsbGljIFx1MDQzMFxuICBcIlx1MDQzNVwiOiBcImVcIiwgLy8gXHUwNDM1XG4gIFwiXHUwNDNFXCI6IFwib1wiLCAvLyBcdTA0M0VcbiAgXCJcdTA0NDBcIjogXCJwXCIsIC8vIFx1MDQ0MFxuICBcIlx1MDQ0MVwiOiBcImNcIiwgLy8gXHUwNDQxXG4gIFwiXHUwNDQ1XCI6IFwieFwiLCAvLyBcdTA0NDVcbiAgXCJcdTA0NDNcIjogXCJ5XCIsIC8vIFx1MDQ0M1xuICBcIlx1MDQ1NlwiOiBcImlcIiwgLy8gXHUwNDU2XG4gIFwiXHUwNDU1XCI6IFwic1wiLCAvLyBcdTA0NTVcbn07XG5cbmZ1bmN0aW9uIHN1YnN0KGNoOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gSE9NT0dMWVBIU1tjaF0gPz8gTEVFVF9NQVBbY2hdID8/IGNoO1xufVxuXG4vKiogQ29sbGFwc2UgYSB0b2tlbiB0byBpdHMgYmFyZSBhbHBoYWJldGljIHNrZWxldG9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVRva2VuKHJhdzogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IHMgPSByYXcudG9Mb3dlckNhc2UoKS5ub3JtYWxpemUoXCJORktEXCIpLnJlcGxhY2UoQ09NQklOSU5HX01BUktTLCBcIlwiKTtcbiAgcyA9IHMuc3BsaXQoXCJcIikubWFwKHN1YnN0KS5qb2luKFwiXCIpO1xuICBzID0gcy5yZXBsYWNlKC9bXmEtel0vZywgXCJcIik7XG4gIC8vIGNvbGxhcHNlIDMrIHJlcGVhdHMgdG8gYSBzaW5nbGUgY2hhciAoXCJmdXV1dWNrXCIgLT4gXCJmdWNrXCIpXG4gIHMgPSBzLnJlcGxhY2UoLyguKVxcMXsyLH0vZywgXCIkMVwiKTtcbiAgcmV0dXJuIHM7XG59XG5cbi8qKlxuICogRnVsbHkgY29sbGFwc2VkLCBsZXR0ZXJzLW9ubHkgcmVwcmVzZW50YXRpb24gb2YgdGhlIHdob2xlIG1lc3NhZ2Ugc28gdGhhdFxuICogc3BhY2VkLW91dCBwcm9mYW5pdHkgKFwiZiB1IGMga1wiLCBcInMtaC1pLXRcIikgaXMgc3RpbGwgY2F1Z2h0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29sbGFwc2VNZXNzYWdlKHRleHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB0ZXh0XG4gICAgLnRvTG93ZXJDYXNlKClcbiAgICAubm9ybWFsaXplKFwiTkZLRFwiKVxuICAgIC5yZXBsYWNlKENPTUJJTklOR19NQVJLUywgXCJcIilcbiAgICAuc3BsaXQoXCJcIilcbiAgICAubWFwKHN1YnN0KVxuICAgIC5qb2luKFwiXCIpXG4gICAgLnJlcGxhY2UoL1teYS16XS9nLCBcIlwiKVxuICAgIC5yZXBsYWNlKC8oLilcXDF7Mix9L2csIFwiJDFcIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b2tlbml6ZSh0ZXh0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiB0ZXh0LnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pO1xufVxuIiwgIi8qKlxuICogU2VydmVyLXNpZGUgcHJvZmFuaXR5IG1vZGVyYXRpb24uXG4gKlxuICogUGlwZWxpbmU6XG4gKiAgIDEuIHRva2VuaXNlIHRoZSBtZXNzYWdlIGFuZCBub3JtYWxpc2UgZWFjaCB0b2tlbiAoY2FzaW5nLCBsZWV0LCByZXBlYXRzKS5cbiAqICAgMi4gZXhhY3QtbWF0Y2ggZWFjaCBub3JtYWxpc2VkIHRva2VuIGFnYWluc3QgdGhlIGJsb2NrbGlzdC5cbiAqICAgMy4gYnVpbGQgYSB3aG9sZS1tZXNzYWdlIGNvbGxhcHNlZCBza2VsZXRvbiBhbmQgc2NhbiBpdCBmb3IgYW55IGJsb2NrZWRcbiAqICAgICAgdGVybSBhcyBhIHN1YnN0cmluZyBcdTIwMTQgdGhpcyBjYXRjaGVzIHNwYWNlZC1vdXQgKFwiZiB1IGMga1wiKSBhbmQgZ2x1ZWRcbiAqICAgICAgKFwiZ29mdWNreW91cnNlbGZcIikgZXZhc2lvbi5cbiAqXG4gKiBBbGxvd2xpc3RlZCB0ZXJtcyAoZS5nLiBcImNsYXNzXCIsIFwiYXNzaWdubWVudFwiLCBcInNjdW50aG9ycGVcIikgYXJlIHByb3RlY3RlZFxuICogZnJvbSB0aGUgc3Vic3RyaW5nIHBhc3Mgc28gd2UgZG8gbm90IG92ZXItYmxvY2suXG4gKi9cbmltcG9ydCB7IGNvbGxhcHNlTWVzc2FnZSwgbm9ybWFsaXplVG9rZW4sIHRva2VuaXplIH0gZnJvbSBcIi4vbm9ybWFsaXplXCI7XG5cbi8vIENvcmUgRW5nbGlzaCBwcm9mYW5pdHkgcm9vdHMuIEtlcHQgZGVsaWJlcmF0ZWx5IHNtYWxsIGFuZCByZWFkYWJsZTsgZXh0ZW5kIGFzXG4vLyBwb2xpY3kgcmVxdWlyZXMuIE1hdGNoaW5nIGlzIGRvbmUgb24gdGhlICpub3JtYWxpc2VkKiBmb3JtIHNvIG9ubHkgdGhlXG4vLyBza2VsZXRvbiBuZWVkcyB0byBiZSBsaXN0ZWQuXG5jb25zdCBCTE9DS0xJU1QgPSBbXG4gIFwiZnVja1wiLFxuICBcInNoaXRcIixcbiAgXCJiaXRjaFwiLFxuICBcImFzc2hvbGVcIixcbiAgXCJiYXN0YXJkXCIsXG4gIFwiZGlja1wiLFxuICBcInBpc3NcIixcbiAgXCJjdW50XCIsXG4gIFwic2x1dFwiLFxuICBcIndob3JlXCIsXG4gIFwibmlnZ2VyXCIsXG4gIFwiZmFnZ290XCIsXG4gIFwicmV0YXJkXCIsXG4gIFwibW90aGVyZnVja2VyXCIsXG4gIFwiY29ja3N1Y2tlclwiLFxuICBcIndhbmtlclwiLFxuICBcImJvbGxvY2tzXCIsXG4gIFwidHdhdFwiLFxuICBcInByaWNrXCIsXG5dO1xuXG4vLyBXb3JkcyB0aGF0IGxlZ2l0aW1hdGVseSBjb250YWluIGEgYmxvY2tlZCBzdWJzdHJpbmcuXG5jb25zdCBBTExPV0xJU1QgPSBuZXcgU2V0KFtcbiAgXCJjbGFzc1wiLFxuICBcImNsYXNzaWNcIixcbiAgXCJhc3NpZ25tZW50XCIsXG4gIFwiYXNzZXNzXCIsXG4gIFwiYXNzYXNzaW5cIixcbiAgXCJhc3Npc3RcIixcbiAgXCJhc3N1bXB0aW9uXCIsXG4gIFwicGFzc1wiLFxuICBcInBhc3NhZ2VcIixcbiAgXCJtYXNzXCIsXG4gIFwiZ3Jhc3NcIixcbiAgXCJicmFzc1wiLFxuICBcImdsYXNzXCIsXG4gIFwiY29tcGFzc1wiLFxuICBcImVtYmFzc3lcIixcbiAgXCJzY3VudGhvcnBlXCIsXG4gIFwiZGlja2Vuc1wiLFxuICBcInNoaXRha2VcIiwgLy8gcmFyZSBidXQgaGFybWxlc3NcbiAgXCJjb2NrcGl0XCIsXG4gIFwiY29ja3RhaWxcIixcbiAgXCJzaHV0dGxlY29ja1wiLFxuICBcImFuYWx5c2lzXCIsXG4gIFwiYW5hbHlzdFwiLFxuICBcImNhbmFsXCIsXG5dKTtcblxuZXhwb3J0IHR5cGUgUHJvZmFuaXR5UmVzdWx0ID1cbiAgfCB7IGNsZWFuOiB0cnVlIH1cbiAgfCB7IGNsZWFuOiBmYWxzZTsgbWF0Y2hlZDogc3RyaW5nW10gfTtcblxuZXhwb3J0IGZ1bmN0aW9uIGNoZWNrUHJvZmFuaXR5KHRleHQ6IHN0cmluZyk6IFByb2Zhbml0eVJlc3VsdCB7XG4gIGNvbnN0IG1hdGNoZWQgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAvLyBQYXNzIDEgXHUyMDE0IHBlci10b2tlbiBleGFjdCBtYXRjaCBvbiB0aGUgbm9ybWFsaXNlZCBza2VsZXRvbi5cbiAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbml6ZSh0ZXh0KSkge1xuICAgIGNvbnN0IG5vcm0gPSBub3JtYWxpemVUb2tlbih0b2tlbik7XG4gICAgaWYgKCFub3JtIHx8IEFMTE9XTElTVC5oYXMobm9ybSkpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgYmFkIG9mIEJMT0NLTElTVCkge1xuICAgICAgaWYgKG5vcm0gPT09IGJhZCkgbWF0Y2hlZC5hZGQoYmFkKTtcbiAgICB9XG4gIH1cblxuICAvLyBQYXNzIDIgXHUyMDE0IHdob2xlLW1lc3NhZ2UgY29sbGFwc2VkIHNrZWxldG9uLCBzdWJzdHJpbmcgc2Nhbi5cbiAgY29uc3QgY29sbGFwc2VkID0gY29sbGFwc2VNZXNzYWdlKHRleHQpO1xuICBpZiAoY29sbGFwc2VkLmxlbmd0aCA8PSAyMDApIHtcbiAgICBmb3IgKGNvbnN0IGJhZCBvZiBCTE9DS0xJU1QpIHtcbiAgICAgIGlmICghY29sbGFwc2VkLmluY2x1ZGVzKGJhZCkpIGNvbnRpbnVlO1xuICAgICAgLy8gZ3VhcmQgYWdhaW5zdCBhbGxvd2xpc3RlZCB3b3JkcyBwcm9kdWNpbmcgdGhlIHN1YnN0cmluZ1xuICAgICAgY29uc3QgZnJvbUFsbG93ZWQgPSBbLi4uQUxMT1dMSVNUXS5zb21lKFxuICAgICAgICAodykgPT4gdy5pbmNsdWRlcyhiYWQpICYmIGNvbGxhcHNlZC5pbmNsdWRlcyh3KVxuICAgICAgKTtcbiAgICAgIGlmICghZnJvbUFsbG93ZWQpIG1hdGNoZWQuYWRkKGJhZCk7XG4gICAgfVxuICB9XG5cbiAgaWYgKG1hdGNoZWQuc2l6ZSA9PT0gMCkgcmV0dXJuIHsgY2xlYW46IHRydWUgfTtcbiAgcmV0dXJuIHsgY2xlYW46IGZhbHNlLCBtYXRjaGVkOiBbLi4ubWF0Y2hlZF0gfTtcbn1cbiIsICJpbXBvcnQgeyBQcmlzbWEgfSBmcm9tIFwiQHByaXNtYS9jbGllbnRcIjtcbmltcG9ydCB7IHByaXNtYSB9IGZyb20gXCJAL2xpYi9wcmlzbWFcIjtcbmltcG9ydCB0eXBlIHtcbiAgTWVzc2FnZURUTyxcbiAgTWVzc2FnZUtpbmQsXG4gIE1lc3NhZ2VNZXRhZGF0YSxcbiAgTWVzc2FnZVBhZ2UsXG4gIFJlYWN0aW9uR3JvdXAsXG59IGZyb20gXCJAL2xpYi90eXBlc1wiO1xuaW1wb3J0IHsgbWVzc2FnZUluY2x1ZGUsIHRvTWVzc2FnZURUTyB9IGZyb20gXCIuL3NlcmlhbGl6ZVwiO1xuaW1wb3J0IHsgaXNNZW1iZXIgfSBmcm9tIFwiLi9jb252ZXJzYXRpb25zXCI7XG5cbi8qKiBFeGNsdWRlcyBtZXNzYWdlcyB0aGUgZ2l2ZW4gdXNlciBoYXMgXCJkZWxldGVkIGZvciBtZVwiLiAqL1xuY29uc3Qgbm90SGlkZGVuRm9yID0gKHVzZXJJZDogc3RyaW5nKSA9PiAoeyBoaWRkZW5Gb3I6IHsgbm9uZTogeyB1c2VySWQgfSB9IH0pO1xuXG5jb25zdCBQQUdFX1NJWkUgPSAzMDtcblxuZXhwb3J0IGNsYXNzIE1lc3NhZ2VFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IocHVibGljIGNvZGU6IFwiRk9SQklEREVOXCIgfCBcIklOVkFMSURcIiB8IFwiTk9UX0ZPVU5EXCIsIG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICB9XG59XG5cbnR5cGUgQ3JlYXRlSW5wdXQgPSB7XG4gIGNvbnZlcnNhdGlvbklkOiBzdHJpbmc7XG4gIHNlbmRlcklkOiBzdHJpbmc7XG4gIGNsaWVudElkOiBzdHJpbmc7XG4gIGtpbmQ6IE1lc3NhZ2VLaW5kO1xuICBib2R5Pzogc3RyaW5nO1xuICBtZXRhZGF0YT86IE1lc3NhZ2VNZXRhZGF0YTtcbiAgcmVwbHlUb0lkPzogc3RyaW5nIHwgbnVsbDtcbn07XG5cbmNvbnN0IFJFQUNUSU9OX0VNT0pJID0gW1wiXHVEODNEXHVEQzREXCIsIFwiXHUyNzY0XHVGRTBGXCIsIFwiXHVEODNEXHVERTAyXCIsIFwiXHVEODNEXHVERTJFXCIsIFwiXHVEODNEXHVERTIyXCIsIFwiXHVEODNEXHVERTRGXCIsIFwiXHVEODNEXHVERDI1XCIsIFwiXHVEODNDXHVERjg5XCJdO1xuXG4vKipcbiAqIElkZW1wb3RlbnQgbWVzc2FnZSBjcmVhdGUuIFRoZSB1bmlxdWUgKGNvbnZlcnNhdGlvbklkLCBjbGllbnRJZCkgY29uc3RyYWludFxuICogbWVhbnMgYSByZXRyeSAvIHJlY29ubmVjdCByZXNlbmQgcmV0dXJucyB0aGUgYWxyZWFkeS1zdG9yZWQgcm93IGluc3RlYWQgb2ZcbiAqIGluc2VydGluZyBhIGR1cGxpY2F0ZS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZU1lc3NhZ2UoaW5wdXQ6IENyZWF0ZUlucHV0KTogUHJvbWlzZTx7IG1lc3NhZ2U6IE1lc3NhZ2VEVE87IGNyZWF0ZWQ6IGJvb2xlYW4gfT4ge1xuICBpZiAoIShhd2FpdCBpc01lbWJlcihpbnB1dC5jb252ZXJzYXRpb25JZCwgaW5wdXQuc2VuZGVySWQpKSkge1xuICAgIHRocm93IG5ldyBNZXNzYWdlRXJyb3IoXCJGT1JCSURERU5cIiwgXCJZb3UgYXJlIG5vdCBhIG1lbWJlciBvZiB0aGlzIGNvbnZlcnNhdGlvbi5cIik7XG4gIH1cblxuICBjb25zdCBib2R5ID0gKGlucHV0LmJvZHkgPz8gXCJcIikudHJpbSgpO1xuICBpZiAoaW5wdXQua2luZCA9PT0gXCJURVhUXCIgJiYgIWJvZHkpIHtcbiAgICB0aHJvdyBuZXcgTWVzc2FnZUVycm9yKFwiSU5WQUxJRFwiLCBcIk1lc3NhZ2UgY2Fubm90IGJlIGVtcHR5LlwiKTtcbiAgfVxuICBpZiAoaW5wdXQua2luZCA9PT0gXCJURVhUXCIgJiYgYm9keS5sZW5ndGggPiA0MDAwKSB7XG4gICAgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIklOVkFMSURcIiwgXCJNZXNzYWdlIGlzIHRvbyBsb25nLlwiKTtcbiAgfVxuICBpZiAoKGlucHV0LmtpbmQgPT09IFwiR0lGXCIgfHwgaW5wdXQua2luZCA9PT0gXCJTVElDS0VSXCIgfHwgaW5wdXQua2luZCA9PT0gXCJJTUFHRVwiKSAmJiAhaW5wdXQubWV0YWRhdGE/LnVybCkge1xuICAgIHRocm93IG5ldyBNZXNzYWdlRXJyb3IoXCJJTlZBTElEXCIsIFwiTWlzc2luZyBtZWRpYSByZWZlcmVuY2UuXCIpO1xuICB9XG5cbiAgLy8gYSByZXBseSB0YXJnZXQgbXVzdCBleGlzdCBhbmQgbGl2ZSBpbiB0aGUgc2FtZSBjb252ZXJzYXRpb25cbiAgaWYgKGlucHV0LnJlcGx5VG9JZCkge1xuICAgIGNvbnN0IHBhcmVudCA9IGF3YWl0IHByaXNtYS5tZXNzYWdlLmZpbmRVbmlxdWUoe1xuICAgICAgd2hlcmU6IHsgaWQ6IGlucHV0LnJlcGx5VG9JZCB9LFxuICAgICAgc2VsZWN0OiB7IGNvbnZlcnNhdGlvbklkOiB0cnVlIH0sXG4gICAgfSk7XG4gICAgaWYgKCFwYXJlbnQgfHwgcGFyZW50LmNvbnZlcnNhdGlvbklkICE9PSBpbnB1dC5jb252ZXJzYXRpb25JZCkge1xuICAgICAgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIklOVkFMSURcIiwgXCJUaGUgbWVzc2FnZSB5b3UncmUgcmVwbHlpbmcgdG8gbm8gbG9uZ2VyIGV4aXN0cy5cIik7XG4gICAgfVxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBtZXNzYWdlID0gYXdhaXQgcHJpc21hLiR0cmFuc2FjdGlvbihhc3luYyAodHgpID0+IHtcbiAgICAgIGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCB0eC5tZXNzYWdlLmNyZWF0ZSh7XG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBjb252ZXJzYXRpb25JZDogaW5wdXQuY29udmVyc2F0aW9uSWQsXG4gICAgICAgICAgc2VuZGVySWQ6IGlucHV0LnNlbmRlcklkLFxuICAgICAgICAgIGNsaWVudElkOiBpbnB1dC5jbGllbnRJZCxcbiAgICAgICAgICBraW5kOiBpbnB1dC5raW5kLFxuICAgICAgICAgIGJvZHksXG4gICAgICAgICAgbWV0YWRhdGE6IChpbnB1dC5tZXRhZGF0YSA/PyBQcmlzbWEuSnNvbk51bGwpIGFzIFByaXNtYS5JbnB1dEpzb25WYWx1ZSxcbiAgICAgICAgICBzdGF0dXM6IFwiU0VOVFwiLFxuICAgICAgICAgIHJlcGx5VG9JZDogaW5wdXQucmVwbHlUb0lkID8/IG51bGwsXG4gICAgICAgIH0sXG4gICAgICAgIGluY2x1ZGU6IG1lc3NhZ2VJbmNsdWRlLFxuICAgICAgfSk7XG4gICAgICBhd2FpdCB0eC5jb252ZXJzYXRpb24udXBkYXRlKHtcbiAgICAgICAgd2hlcmU6IHsgaWQ6IGlucHV0LmNvbnZlcnNhdGlvbklkIH0sXG4gICAgICAgIGRhdGE6IHsgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpIH0sXG4gICAgICB9KTtcbiAgICAgIHJldHVybiBjcmVhdGVkO1xuICAgIH0pO1xuICAgIHJldHVybiB7IG1lc3NhZ2U6IHRvTWVzc2FnZURUTyhtZXNzYWdlKSwgY3JlYXRlZDogdHJ1ZSB9O1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBpZiAoZXJyIGluc3RhbmNlb2YgUHJpc21hLlByaXNtYUNsaWVudEtub3duUmVxdWVzdEVycm9yICYmIGVyci5jb2RlID09PSBcIlAyMDAyXCIpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcHJpc21hLm1lc3NhZ2UuZmluZFVuaXF1ZSh7XG4gICAgICAgIHdoZXJlOiB7XG4gICAgICAgICAgY29udmVyc2F0aW9uSWRfY2xpZW50SWQ6IHtcbiAgICAgICAgICAgIGNvbnZlcnNhdGlvbklkOiBpbnB1dC5jb252ZXJzYXRpb25JZCxcbiAgICAgICAgICAgIGNsaWVudElkOiBpbnB1dC5jbGllbnRJZCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBpbmNsdWRlOiBtZXNzYWdlSW5jbHVkZSxcbiAgICAgIH0pO1xuICAgICAgaWYgKGV4aXN0aW5nKSByZXR1cm4geyBtZXNzYWdlOiB0b01lc3NhZ2VEVE8oZXhpc3RpbmcpLCBjcmVhdGVkOiBmYWxzZSB9O1xuICAgIH1cbiAgICB0aHJvdyBlcnI7XG4gIH1cbn1cblxuLyoqXG4gKiBDdXJzb3ItYmFzZWQgcGFnaW5hdGlvbi4gTG9hZHMgdGhlIG5ld2VzdCBgUEFHRV9TSVpFYCBtZXNzYWdlcywgdGhlbiBvbGRlclxuICogcGFnZXMgYXMgdGhlIGNsaWVudCBzY3JvbGxzIHVwLiBDdXJzb3IgaXMgdGhlIG1lc3NhZ2UgaWQ7IG9yZGVyaW5nIGlzIG9uIHRoZVxuICogY29tcG9zaXRlIGluZGV4IChjb252ZXJzYXRpb25JZCwgY3JlYXRlZEF0LCBpZCkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRNZXNzYWdlcyhcbiAgY29udmVyc2F0aW9uSWQ6IHN0cmluZyxcbiAgdXNlcklkOiBzdHJpbmcsXG4gIGN1cnNvcj86IHN0cmluZyB8IG51bGxcbik6IFByb21pc2U8TWVzc2FnZVBhZ2U+IHtcbiAgaWYgKCEoYXdhaXQgaXNNZW1iZXIoY29udmVyc2F0aW9uSWQsIHVzZXJJZCkpKSB7XG4gICAgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIkZPUkJJRERFTlwiLCBcIllvdSBhcmUgbm90IGEgbWVtYmVyIG9mIHRoaXMgY29udmVyc2F0aW9uLlwiKTtcbiAgfVxuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCBwcmlzbWEubWVzc2FnZS5maW5kTWFueSh7XG4gICAgd2hlcmU6IHsgY29udmVyc2F0aW9uSWQsIC4uLm5vdEhpZGRlbkZvcih1c2VySWQpIH0sXG4gICAgb3JkZXJCeTogW3sgY3JlYXRlZEF0OiBcImRlc2NcIiB9LCB7IGlkOiBcImRlc2NcIiB9XSxcbiAgICB0YWtlOiBQQUdFX1NJWkUgKyAxLFxuICAgIC4uLihjdXJzb3IgPyB7IGN1cnNvcjogeyBpZDogY3Vyc29yIH0sIHNraXA6IDEgfSA6IHt9KSxcbiAgICBpbmNsdWRlOiBtZXNzYWdlSW5jbHVkZSxcbiAgfSk7XG5cbiAgY29uc3QgaGFzTW9yZSA9IHJvd3MubGVuZ3RoID4gUEFHRV9TSVpFO1xuICBjb25zdCBwYWdlID0gaGFzTW9yZSA/IHJvd3Muc2xpY2UoMCwgUEFHRV9TSVpFKSA6IHJvd3M7XG5cbiAgcmV0dXJuIHtcbiAgICAvLyByZXR1cm4gaW4gYXNjZW5kaW5nIChjaHJvbm9sb2dpY2FsKSBvcmRlciBmb3IgcmVuZGVyaW5nXG4gICAgbWVzc2FnZXM6IHBhZ2UucmV2ZXJzZSgpLm1hcCh0b01lc3NhZ2VEVE8pLFxuICAgIG5leHRDdXJzb3I6IGhhc01vcmUgPyBwYWdlWzBdLmlkIDogbnVsbCxcbiAgICBoYXNNb3JlLFxuICB9O1xufVxuXG4vKiogTWVzc2FnZXMgY3JlYXRlZCBhZnRlciBhIGdpdmVuIGlkIFx1MjAxNCB1c2VkIHRvIHJlY29uY2lsZSBhZnRlciBhIHJlY29ubmVjdC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRNZXNzYWdlc0FmdGVyKFxuICBjb252ZXJzYXRpb25JZDogc3RyaW5nLFxuICB1c2VySWQ6IHN0cmluZyxcbiAgYWZ0ZXJJZDogc3RyaW5nIHwgbnVsbFxuKTogUHJvbWlzZTxNZXNzYWdlRFRPW10+IHtcbiAgaWYgKCEoYXdhaXQgaXNNZW1iZXIoY29udmVyc2F0aW9uSWQsIHVzZXJJZCkpKSB7XG4gICAgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIkZPUkJJRERFTlwiLCBcIk5vdCBhIG1lbWJlci5cIik7XG4gIH1cbiAgbGV0IGFmdGVyOiBEYXRlIHwgbnVsbCA9IG51bGw7XG4gIGlmIChhZnRlcklkKSB7XG4gICAgY29uc3QgYW5jaG9yID0gYXdhaXQgcHJpc21hLm1lc3NhZ2UuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGlkOiBhZnRlcklkIH0sIHNlbGVjdDogeyBjcmVhdGVkQXQ6IHRydWUgfSB9KTtcbiAgICBhZnRlciA9IGFuY2hvcj8uY3JlYXRlZEF0ID8/IG51bGw7XG4gIH1cbiAgY29uc3Qgcm93cyA9IGF3YWl0IHByaXNtYS5tZXNzYWdlLmZpbmRNYW55KHtcbiAgICB3aGVyZToge1xuICAgICAgY29udmVyc2F0aW9uSWQsXG4gICAgICAuLi5ub3RIaWRkZW5Gb3IodXNlcklkKSxcbiAgICAgIC4uLihhZnRlciA/IHsgY3JlYXRlZEF0OiB7IGd0OiBhZnRlciB9IH0gOiB7fSksXG4gICAgfSxcbiAgICBvcmRlckJ5OiBbeyBjcmVhdGVkQXQ6IFwiYXNjXCIgfSwgeyBpZDogXCJhc2NcIiB9XSxcbiAgICB0YWtlOiAyMDAsXG4gICAgaW5jbHVkZTogbWVzc2FnZUluY2x1ZGUsXG4gIH0pO1xuICByZXR1cm4gcm93cy5tYXAodG9NZXNzYWdlRFRPKTtcbn1cblxuLyoqXG4gKiBNYXJrcyBldmVyeSB1bnJlYWQgbWVzc2FnZSBmcm9tIG90aGVyIHBlb3BsZSBhcyByZWFkIGZvciBgdXNlcklkYC5cbiAqIFJldHVybnMgdGhlIGFmZmVjdGVkIG1lc3NhZ2UgaWRzIChmb3IgYSByZWFsLXRpbWUgcmVjZWlwdCB0byB0aGUgc2VuZGVycykuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYXJrQ29udmVyc2F0aW9uUmVhZChcbiAgY29udmVyc2F0aW9uSWQ6IHN0cmluZyxcbiAgdXNlcklkOiBzdHJpbmdcbik6IFByb21pc2U8eyBtZXNzYWdlSWRzOiBzdHJpbmdbXTsgcmVhZEF0OiBEYXRlIH0+IHtcbiAgaWYgKCEoYXdhaXQgaXNNZW1iZXIoY29udmVyc2F0aW9uSWQsIHVzZXJJZCkpKSB7XG4gICAgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIkZPUkJJRERFTlwiLCBcIk5vdCBhIG1lbWJlci5cIik7XG4gIH1cbiAgY29uc3QgcmVhZEF0ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgdW5yZWFkID0gYXdhaXQgcHJpc21hLm1lc3NhZ2UuZmluZE1hbnkoe1xuICAgIHdoZXJlOiB7XG4gICAgICBjb252ZXJzYXRpb25JZCxcbiAgICAgIHNlbmRlcklkOiB7IG5vdDogdXNlcklkIH0sXG4gICAgICByZWFkczogeyBub25lOiB7IHVzZXJJZCB9IH0sXG4gICAgfSxcbiAgICBzZWxlY3Q6IHsgaWQ6IHRydWUgfSxcbiAgfSk7XG5cbiAgaWYgKHVucmVhZC5sZW5ndGggPiAwKSB7XG4gICAgYXdhaXQgcHJpc21hLiR0cmFuc2FjdGlvbihbXG4gICAgICBwcmlzbWEubWVzc2FnZVJlYWQuY3JlYXRlTWFueSh7XG4gICAgICAgIGRhdGE6IHVucmVhZC5tYXAoKG0pID0+ICh7IG1lc3NhZ2VJZDogbS5pZCwgdXNlcklkLCByZWFkQXQgfSkpLFxuICAgICAgICBza2lwRHVwbGljYXRlczogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICAgcHJpc21hLm1lc3NhZ2UudXBkYXRlTWFueSh7XG4gICAgICAgIHdoZXJlOiB7IGlkOiB7IGluOiB1bnJlYWQubWFwKChtKSA9PiBtLmlkKSB9IH0sXG4gICAgICAgIGRhdGE6IHsgc3RhdHVzOiBcIlJFQURcIiB9LFxuICAgICAgfSksXG4gICAgXSk7XG4gIH1cblxuICBhd2FpdCBwcmlzbWEuY29udmVyc2F0aW9uTWVtYmVyLnVwZGF0ZSh7XG4gICAgd2hlcmU6IHsgY29udmVyc2F0aW9uSWRfdXNlcklkOiB7IGNvbnZlcnNhdGlvbklkLCB1c2VySWQgfSB9LFxuICAgIGRhdGE6IHsgbGFzdFJlYWRBdDogcmVhZEF0IH0sXG4gIH0pO1xuXG4gIHJldHVybiB7IG1lc3NhZ2VJZHM6IHVucmVhZC5tYXAoKG0pID0+IG0uaWQpLCByZWFkQXQgfTtcbn1cblxuZXhwb3J0IGNvbnN0IEFMTE9XRURfUkVBQ1RJT05TID0gUkVBQ1RJT05fRU1PSkk7XG5cbi8qKlxuICogVG9nZ2xlcyBhIHJlYWN0aW9uOiBhZGRzIGl0IGlmIGFic2VudCwgcmVtb3ZlcyBpdCBpZiB0aGUgdXNlciBhbHJlYWR5IHJlYWN0ZWRcbiAqIHdpdGggdGhhdCBlbW9qaS4gSWRlbXBvdGVudCBwZXIgdGhlIGAobWVzc2FnZUlkLCB1c2VySWQsIGVtb2ppKWAgdW5pcXVlXG4gKiBjb25zdHJhaW50LiBSZXR1cm5zIHRoZSByZWdyb3VwZWQgcmVhY3Rpb25zIHBsdXMgdGhlIGNvbnZlcnNhdGlvbiBpZCBzbyB0aGVcbiAqIGNhbGxlciBjYW4gZmFuIHRoZSB1cGRhdGUgb3V0IHRvIHRoZSByb29tLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdG9nZ2xlUmVhY3Rpb24oXG4gIG1lc3NhZ2VJZDogc3RyaW5nLFxuICB1c2VySWQ6IHN0cmluZyxcbiAgZW1vamk6IHN0cmluZ1xuKTogUHJvbWlzZTx7IGNvbnZlcnNhdGlvbklkOiBzdHJpbmc7IG1lc3NhZ2VJZDogc3RyaW5nOyByZWFjdGlvbnM6IFJlYWN0aW9uR3JvdXBbXSB9PiB7XG4gIGlmICghUkVBQ1RJT05fRU1PSkkuaW5jbHVkZXMoZW1vamkpKSB7XG4gICAgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIklOVkFMSURcIiwgXCJVbnN1cHBvcnRlZCByZWFjdGlvbi5cIik7XG4gIH1cbiAgY29uc3QgbWVzc2FnZSA9IGF3YWl0IHByaXNtYS5tZXNzYWdlLmZpbmRVbmlxdWUoe1xuICAgIHdoZXJlOiB7IGlkOiBtZXNzYWdlSWQgfSxcbiAgICBzZWxlY3Q6IHsgY29udmVyc2F0aW9uSWQ6IHRydWUgfSxcbiAgfSk7XG4gIGlmICghbWVzc2FnZSkgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIk5PVF9GT1VORFwiLCBcIk1lc3NhZ2Ugbm90IGZvdW5kLlwiKTtcbiAgaWYgKCEoYXdhaXQgaXNNZW1iZXIobWVzc2FnZS5jb252ZXJzYXRpb25JZCwgdXNlcklkKSkpIHtcbiAgICB0aHJvdyBuZXcgTWVzc2FnZUVycm9yKFwiRk9SQklEREVOXCIsIFwiWW91IGFyZSBub3QgYSBtZW1iZXIgb2YgdGhpcyBjb252ZXJzYXRpb24uXCIpO1xuICB9XG5cbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBwcmlzbWEubWVzc2FnZVJlYWN0aW9uLmZpbmRVbmlxdWUoe1xuICAgIHdoZXJlOiB7IG1lc3NhZ2VJZF91c2VySWRfZW1vamk6IHsgbWVzc2FnZUlkLCB1c2VySWQsIGVtb2ppIH0gfSxcbiAgfSk7XG4gIGlmIChleGlzdGluZykge1xuICAgIGF3YWl0IHByaXNtYS5tZXNzYWdlUmVhY3Rpb24uZGVsZXRlKHsgd2hlcmU6IHsgaWQ6IGV4aXN0aW5nLmlkIH0gfSk7XG4gIH0gZWxzZSB7XG4gICAgYXdhaXQgcHJpc21hLm1lc3NhZ2VSZWFjdGlvbi5jcmVhdGUoeyBkYXRhOiB7IG1lc3NhZ2VJZCwgdXNlcklkLCBlbW9qaSB9IH0pO1xuICB9XG5cbiAgY29uc3QgYWxsID0gYXdhaXQgcHJpc21hLm1lc3NhZ2VSZWFjdGlvbi5maW5kTWFueSh7IHdoZXJlOiB7IG1lc3NhZ2VJZCB9IH0pO1xuICBjb25zdCBtYXAgPSBuZXcgTWFwPHN0cmluZywgUmVhY3Rpb25Hcm91cD4oKTtcbiAgZm9yIChjb25zdCByIG9mIGFsbCkge1xuICAgIGNvbnN0IGcgPSBtYXAuZ2V0KHIuZW1vamkpID8/IHsgZW1vamk6IHIuZW1vamksIGNvdW50OiAwLCB1c2VySWRzOiBbXSB9O1xuICAgIGcuY291bnQgKz0gMTtcbiAgICBnLnVzZXJJZHMucHVzaChyLnVzZXJJZCk7XG4gICAgbWFwLnNldChyLmVtb2ppLCBnKTtcbiAgfVxuICBjb25zdCByZWFjdGlvbnMgPSBbLi4ubWFwLnZhbHVlcygpXS5zb3J0KFxuICAgIChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudCB8fCBhLmVtb2ppLmxvY2FsZUNvbXBhcmUoYi5lbW9qaSlcbiAgKTtcbiAgcmV0dXJuIHsgY29udmVyc2F0aW9uSWQ6IG1lc3NhZ2UuY29udmVyc2F0aW9uSWQsIG1lc3NhZ2VJZCwgcmVhY3Rpb25zIH07XG59XG5cbi8qKlxuICogRWRpdHMgdGhlIHRleHQgb2YgYSBtZXNzYWdlLiBTZW5kZXItb25seSwgVEVYVC1vbmx5LiBUaGUgdXBkYXRlZCBib2R5IGlzXG4gKiByZS1ydW4gdGhyb3VnaCBwcm9mYW5pdHkgbW9kZXJhdGlvbiBieSB0aGUgY2FsbGVyIGJlZm9yZSB0aGlzIGlzIGludm9rZWQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlZGl0TWVzc2FnZShcbiAgbWVzc2FnZUlkOiBzdHJpbmcsXG4gIHVzZXJJZDogc3RyaW5nLFxuICByYXdCb2R5OiBzdHJpbmdcbik6IFByb21pc2U8eyBtZXNzYWdlOiBNZXNzYWdlRFRPOyBjb252ZXJzYXRpb25JZDogc3RyaW5nIH0+IHtcbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBwcmlzbWEubWVzc2FnZS5maW5kVW5pcXVlKHtcbiAgICB3aGVyZTogeyBpZDogbWVzc2FnZUlkIH0sXG4gICAgc2VsZWN0OiB7IHNlbmRlcklkOiB0cnVlLCBjb252ZXJzYXRpb25JZDogdHJ1ZSwga2luZDogdHJ1ZSwgZGVsZXRlZEF0OiB0cnVlIH0sXG4gIH0pO1xuICBpZiAoIWV4aXN0aW5nKSB0aHJvdyBuZXcgTWVzc2FnZUVycm9yKFwiTk9UX0ZPVU5EXCIsIFwiTWVzc2FnZSBub3QgZm91bmQuXCIpO1xuICBpZiAoZXhpc3Rpbmcuc2VuZGVySWQgIT09IHVzZXJJZCkge1xuICAgIHRocm93IG5ldyBNZXNzYWdlRXJyb3IoXCJGT1JCSURERU5cIiwgXCJZb3UgY2FuIG9ubHkgZWRpdCB5b3VyIG93biBtZXNzYWdlcy5cIik7XG4gIH1cbiAgaWYgKGV4aXN0aW5nLmRlbGV0ZWRBdCkgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIklOVkFMSURcIiwgXCJUaGlzIG1lc3NhZ2Ugd2FzIGRlbGV0ZWQuXCIpO1xuICBpZiAoZXhpc3Rpbmcua2luZCAhPT0gXCJURVhUXCIpIHtcbiAgICB0aHJvdyBuZXcgTWVzc2FnZUVycm9yKFwiSU5WQUxJRFwiLCBcIk9ubHkgdGV4dCBtZXNzYWdlcyBjYW4gYmUgZWRpdGVkLlwiKTtcbiAgfVxuXG4gIGNvbnN0IGJvZHkgPSByYXdCb2R5LnRyaW0oKTtcbiAgaWYgKCFib2R5KSB0aHJvdyBuZXcgTWVzc2FnZUVycm9yKFwiSU5WQUxJRFwiLCBcIk1lc3NhZ2UgY2Fubm90IGJlIGVtcHR5LlwiKTtcbiAgaWYgKGJvZHkubGVuZ3RoID4gNDAwMCkgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIklOVkFMSURcIiwgXCJNZXNzYWdlIGlzIHRvbyBsb25nLlwiKTtcblxuICBjb25zdCB1cGRhdGVkID0gYXdhaXQgcHJpc21hLm1lc3NhZ2UudXBkYXRlKHtcbiAgICB3aGVyZTogeyBpZDogbWVzc2FnZUlkIH0sXG4gICAgZGF0YTogeyBib2R5LCBlZGl0ZWRBdDogbmV3IERhdGUoKSB9LFxuICAgIGluY2x1ZGU6IG1lc3NhZ2VJbmNsdWRlLFxuICB9KTtcbiAgcmV0dXJuIHsgbWVzc2FnZTogdG9NZXNzYWdlRFRPKHVwZGF0ZWQpLCBjb252ZXJzYXRpb25JZDogZXhpc3RpbmcuY29udmVyc2F0aW9uSWQgfTtcbn1cblxuLyoqXG4gKiBcIkRlbGV0ZSBmb3IgZXZlcnlvbmVcIiBcdTIwMTQgc29mdCBkZWxldGUgYnkgdGhlIHNlbmRlci4gVGhlIHJvdyBzdGF5cyAoc28gb3RoZXJcbiAqIHBhcnRpY2lwYW50cycgY2xpZW50cyBjYW4gcmVjb25jaWxlKSwgYnV0IGJvZHkvbWV0YWRhdGEvcmVhY3Rpb25zIGFyZSBjbGVhcmVkLlxuICogSWRlbXBvdGVudC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlbGV0ZU1lc3NhZ2VGb3JFdmVyeW9uZShcbiAgbWVzc2FnZUlkOiBzdHJpbmcsXG4gIHVzZXJJZDogc3RyaW5nXG4pOiBQcm9taXNlPHsgbWVzc2FnZTogTWVzc2FnZURUTzsgY29udmVyc2F0aW9uSWQ6IHN0cmluZyB9PiB7XG4gIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcHJpc21hLm1lc3NhZ2UuZmluZFVuaXF1ZSh7XG4gICAgd2hlcmU6IHsgaWQ6IG1lc3NhZ2VJZCB9LFxuICAgIHNlbGVjdDogeyBzZW5kZXJJZDogdHJ1ZSwgY29udmVyc2F0aW9uSWQ6IHRydWUsIGRlbGV0ZWRBdDogdHJ1ZSB9LFxuICB9KTtcbiAgaWYgKCFleGlzdGluZykgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIk5PVF9GT1VORFwiLCBcIk1lc3NhZ2Ugbm90IGZvdW5kLlwiKTtcbiAgaWYgKGV4aXN0aW5nLnNlbmRlcklkICE9PSB1c2VySWQpIHtcbiAgICB0aHJvdyBuZXcgTWVzc2FnZUVycm9yKFwiRk9SQklEREVOXCIsIFwiWW91IGNhbiBvbmx5IGRlbGV0ZSB5b3VyIG93biBtZXNzYWdlcyBmb3IgZXZlcnlvbmUuXCIpO1xuICB9XG5cbiAgLy8gaWRlbXBvdGVudCBcdTIwMTQgYWxyZWFkeSBkZWxldGVkLCByZXR1cm4gY3VycmVudCBzdGF0ZVxuICBpZiAoZXhpc3RpbmcuZGVsZXRlZEF0KSB7XG4gICAgY29uc3QgY3VycmVudCA9IGF3YWl0IHByaXNtYS5tZXNzYWdlLmZpbmRVbmlxdWVPclRocm93KHtcbiAgICAgIHdoZXJlOiB7IGlkOiBtZXNzYWdlSWQgfSxcbiAgICAgIGluY2x1ZGU6IG1lc3NhZ2VJbmNsdWRlLFxuICAgIH0pO1xuICAgIHJldHVybiB7IG1lc3NhZ2U6IHRvTWVzc2FnZURUTyhjdXJyZW50KSwgY29udmVyc2F0aW9uSWQ6IGV4aXN0aW5nLmNvbnZlcnNhdGlvbklkIH07XG4gIH1cblxuICBjb25zdCB1cGRhdGVkID0gYXdhaXQgcHJpc21hLiR0cmFuc2FjdGlvbihhc3luYyAodHgpID0+IHtcbiAgICBhd2FpdCB0eC5tZXNzYWdlUmVhY3Rpb24uZGVsZXRlTWFueSh7IHdoZXJlOiB7IG1lc3NhZ2VJZCB9IH0pO1xuICAgIHJldHVybiB0eC5tZXNzYWdlLnVwZGF0ZSh7XG4gICAgICB3aGVyZTogeyBpZDogbWVzc2FnZUlkIH0sXG4gICAgICBkYXRhOiB7IGRlbGV0ZWRBdDogbmV3IERhdGUoKSwgZGVsZXRlZEJ5SWQ6IHVzZXJJZCwgYm9keTogXCJcIiwgbWV0YWRhdGE6IFByaXNtYS5Kc29uTnVsbCB9LFxuICAgICAgaW5jbHVkZTogbWVzc2FnZUluY2x1ZGUsXG4gICAgfSk7XG4gIH0pO1xuICByZXR1cm4geyBtZXNzYWdlOiB0b01lc3NhZ2VEVE8odXBkYXRlZCksIGNvbnZlcnNhdGlvbklkOiBleGlzdGluZy5jb252ZXJzYXRpb25JZCB9O1xufVxuXG4vKiogXCJEZWxldGUgZm9yIG1lXCIgXHUyMDE0IHBlci11c2VyIGhpZGUuIElkZW1wb3RlbnQgdmlhIHRoZSB1bmlxdWUgY29uc3RyYWludC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWxldGVNZXNzYWdlRm9yTWUoXG4gIG1lc3NhZ2VJZDogc3RyaW5nLFxuICB1c2VySWQ6IHN0cmluZ1xuKTogUHJvbWlzZTx7IGNvbnZlcnNhdGlvbklkOiBzdHJpbmcgfT4ge1xuICBjb25zdCBtZXNzYWdlID0gYXdhaXQgcHJpc21hLm1lc3NhZ2UuZmluZFVuaXF1ZSh7XG4gICAgd2hlcmU6IHsgaWQ6IG1lc3NhZ2VJZCB9LFxuICAgIHNlbGVjdDogeyBjb252ZXJzYXRpb25JZDogdHJ1ZSB9LFxuICB9KTtcbiAgaWYgKCFtZXNzYWdlKSB0aHJvdyBuZXcgTWVzc2FnZUVycm9yKFwiTk9UX0ZPVU5EXCIsIFwiTWVzc2FnZSBub3QgZm91bmQuXCIpO1xuICBpZiAoIShhd2FpdCBpc01lbWJlcihtZXNzYWdlLmNvbnZlcnNhdGlvbklkLCB1c2VySWQpKSkge1xuICAgIHRocm93IG5ldyBNZXNzYWdlRXJyb3IoXCJGT1JCSURERU5cIiwgXCJZb3UgYXJlIG5vdCBhIG1lbWJlciBvZiB0aGlzIGNvbnZlcnNhdGlvbi5cIik7XG4gIH1cbiAgYXdhaXQgcHJpc21hLm1lc3NhZ2VIaWRkZW4udXBzZXJ0KHtcbiAgICB3aGVyZTogeyBtZXNzYWdlSWRfdXNlcklkOiB7IG1lc3NhZ2VJZCwgdXNlcklkIH0gfSxcbiAgICBjcmVhdGU6IHsgbWVzc2FnZUlkLCB1c2VySWQgfSxcbiAgICB1cGRhdGU6IHt9LFxuICB9KTtcbiAgcmV0dXJuIHsgY29udmVyc2F0aW9uSWQ6IG1lc3NhZ2UuY29udmVyc2F0aW9uSWQgfTtcbn1cblxuLyoqIEJ1bGsgbWFyayBkZWxpdmVyZWQgd2hlbiBhIHJlY2lwaWVudCdzIHNvY2tldCByZWNlaXZlcyBtZXNzYWdlcy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYXJrRGVsaXZlcmVkKGNvbnZlcnNhdGlvbklkOiBzdHJpbmcsIHJlY2lwaWVudElkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGNvbnN0IHBlbmRpbmcgPSBhd2FpdCBwcmlzbWEubWVzc2FnZS5maW5kTWFueSh7XG4gICAgd2hlcmU6IHsgY29udmVyc2F0aW9uSWQsIHNlbmRlcklkOiB7IG5vdDogcmVjaXBpZW50SWQgfSwgc3RhdHVzOiBcIlNFTlRcIiB9LFxuICAgIHNlbGVjdDogeyBpZDogdHJ1ZSB9LFxuICB9KTtcbiAgaWYgKHBlbmRpbmcubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGF3YWl0IHByaXNtYS5tZXNzYWdlLnVwZGF0ZU1hbnkoe1xuICAgIHdoZXJlOiB7IGlkOiB7IGluOiBwZW5kaW5nLm1hcCgobSkgPT4gbS5pZCkgfSB9LFxuICAgIGRhdGE6IHsgc3RhdHVzOiBcIkRFTElWRVJFRFwiIH0sXG4gIH0pO1xuICByZXR1cm4gcGVuZGluZy5tYXAoKG0pID0+IG0uaWQpO1xufVxuIiwgImltcG9ydCB0eXBlIHsgTWVzc2FnZSwgTWVzc2FnZVJlYWN0aW9uLCBNZXNzYWdlUmVhZCwgVXNlciB9IGZyb20gXCJAcHJpc21hL2NsaWVudFwiO1xuaW1wb3J0IHR5cGUge1xuICBDb252ZXJzYXRpb25EVE8sXG4gIE1lc3NhZ2VEVE8sXG4gIFBhcnRpY2lwYW50RFRPLFxuICBSZWFjdGlvbkdyb3VwLFxuICBSZXBseVByZXZpZXcsXG59IGZyb20gXCJAL2xpYi90eXBlc1wiO1xuXG50eXBlIE1lc3NhZ2VXaXRoUmVsYXRpb25zID0gTWVzc2FnZSAmIHtcbiAgcmVhZHM/OiBNZXNzYWdlUmVhZFtdO1xuICByZWFjdGlvbnM/OiBNZXNzYWdlUmVhY3Rpb25bXTtcbiAgcmVwbHlUbz86IChNZXNzYWdlICYgeyBzZW5kZXI/OiBQaWNrPFVzZXIsIFwiaWRcIj4gfSkgfCBudWxsO1xufTtcblxuZnVuY3Rpb24gcHJldmlld0ZvcihtOiBQaWNrPE1lc3NhZ2UsIFwia2luZFwiIHwgXCJib2R5XCIgfCBcImRlbGV0ZWRBdFwiPik6IHN0cmluZyB7XG4gIGlmIChtLmRlbGV0ZWRBdCkgcmV0dXJuIFwiVGhpcyBtZXNzYWdlIHdhcyBkZWxldGVkXCI7XG4gIHN3aXRjaCAobS5raW5kKSB7XG4gICAgY2FzZSBcIklNQUdFXCI6XG4gICAgICByZXR1cm4gXCJcdUQ4M0RcdURDRjcgUGhvdG9cIjtcbiAgICBjYXNlIFwiR0lGXCI6XG4gICAgICByZXR1cm4gXCJHSUZcIjtcbiAgICBjYXNlIFwiU1RJQ0tFUlwiOlxuICAgICAgcmV0dXJuIFwiU3RpY2tlclwiO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gbS5ib2R5Lmxlbmd0aCA+IDEyMCA/IGAke20uYm9keS5zbGljZSgwLCAxMjApfVx1MjAyNmAgOiBtLmJvZHk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZ3JvdXBSZWFjdGlvbnMocmVhY3Rpb25zOiBNZXNzYWdlUmVhY3Rpb25bXSA9IFtdKTogUmVhY3Rpb25Hcm91cFtdIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcDxzdHJpbmcsIFJlYWN0aW9uR3JvdXA+KCk7XG4gIGZvciAoY29uc3QgciBvZiByZWFjdGlvbnMpIHtcbiAgICBjb25zdCBnID0gbWFwLmdldChyLmVtb2ppKSA/PyB7IGVtb2ppOiByLmVtb2ppLCBjb3VudDogMCwgdXNlcklkczogW10gfTtcbiAgICBnLmNvdW50ICs9IDE7XG4gICAgZy51c2VySWRzLnB1c2goci51c2VySWQpO1xuICAgIG1hcC5zZXQoci5lbW9qaSwgZyk7XG4gIH1cbiAgcmV0dXJuIFsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50IHx8IGEuZW1vamkubG9jYWxlQ29tcGFyZShiLmVtb2ppKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b01lc3NhZ2VEVE8obTogTWVzc2FnZVdpdGhSZWxhdGlvbnMpOiBNZXNzYWdlRFRPIHtcbiAgY29uc3QgZGVsZXRlZCA9IG0uZGVsZXRlZEF0ICE9IG51bGw7XG5cbiAgY29uc3QgcmVwbHlUbzogUmVwbHlQcmV2aWV3IHwgbnVsbCA9XG4gICAgIWRlbGV0ZWQgJiYgbS5yZXBseVRvXG4gICAgICA/IHtcbiAgICAgICAgICBpZDogbS5yZXBseVRvLmlkLFxuICAgICAgICAgIHNlbmRlcklkOiBtLnJlcGx5VG8uc2VuZGVySWQsXG4gICAgICAgICAga2luZDogbS5yZXBseVRvLmtpbmQsXG4gICAgICAgICAgcHJldmlldzogcHJldmlld0ZvcihtLnJlcGx5VG8pLFxuICAgICAgICB9XG4gICAgICA6IG51bGw7XG5cbiAgcmV0dXJuIHtcbiAgICBpZDogbS5pZCxcbiAgICBjbGllbnRJZDogbS5jbGllbnRJZCxcbiAgICBjb252ZXJzYXRpb25JZDogbS5jb252ZXJzYXRpb25JZCxcbiAgICBzZW5kZXJJZDogbS5zZW5kZXJJZCxcbiAgICBraW5kOiBtLmtpbmQsXG4gICAgYm9keTogZGVsZXRlZCA/IFwiXCIgOiBtLmJvZHksXG4gICAgbWV0YWRhdGE6IGRlbGV0ZWQgPyBudWxsIDogKG0ubWV0YWRhdGEgYXMgTWVzc2FnZURUT1tcIm1ldGFkYXRhXCJdKSA/PyBudWxsLFxuICAgIHN0YXR1czogbS5zdGF0dXMsXG4gICAgY3JlYXRlZEF0OiBtLmNyZWF0ZWRBdC50b0lTT1N0cmluZygpLFxuICAgIGVkaXRlZEF0OiBtLmVkaXRlZEF0ID8gbS5lZGl0ZWRBdC50b0lTT1N0cmluZygpIDogbnVsbCxcbiAgICBkZWxldGVkQXQ6IG0uZGVsZXRlZEF0ID8gbS5kZWxldGVkQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgcmVhZEJ5OiAobS5yZWFkcyA/PyBbXSkubWFwKChyKSA9PiByLnVzZXJJZCksXG4gICAgcmVhY3Rpb25zOiBkZWxldGVkID8gW10gOiBncm91cFJlYWN0aW9ucyhtLnJlYWN0aW9ucyksXG4gICAgcmVwbHlUbyxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvUGFydGljaXBhbnREVE8oXG4gIHU6IFBpY2s8VXNlciwgXCJpZFwiIHwgXCJ1c2VybmFtZVwiIHwgXCJkaXNwbGF5TmFtZVwiIHwgXCJhdmF0YXJDb2xvclwiPlxuKTogUGFydGljaXBhbnREVE8ge1xuICByZXR1cm4ge1xuICAgIGlkOiB1LmlkLFxuICAgIHVzZXJuYW1lOiB1LnVzZXJuYW1lLFxuICAgIGRpc3BsYXlOYW1lOiB1LmRpc3BsYXlOYW1lLFxuICAgIGF2YXRhckNvbG9yOiB1LmF2YXRhckNvbG9yLFxuICB9O1xufVxuXG5leHBvcnQgdHlwZSBDb252ZXJzYXRpb25Sb3cgPSB7XG4gIGlkOiBzdHJpbmc7XG4gIGlzR3JvdXA6IGJvb2xlYW47XG4gIHRpdGxlOiBzdHJpbmcgfCBudWxsO1xuICB1cGRhdGVkQXQ6IERhdGU7XG4gIG1lbWJlcnM6IHsgdXNlcjogUGljazxVc2VyLCBcImlkXCIgfCBcInVzZXJuYW1lXCIgfCBcImRpc3BsYXlOYW1lXCIgfCBcImF2YXRhckNvbG9yXCI+IH1bXTtcbiAgbWVzc2FnZXM6IE1lc3NhZ2VXaXRoUmVsYXRpb25zW107XG59O1xuXG5leHBvcnQgZnVuY3Rpb24gdG9Db252ZXJzYXRpb25EVE8oXG4gIHJvdzogQ29udmVyc2F0aW9uUm93LFxuICB1bnJlYWRDb3VudDogbnVtYmVyLFxuICBteUxhc3RSZWFkQXQ6IERhdGVcbik6IENvbnZlcnNhdGlvbkRUTyB7XG4gIHJldHVybiB7XG4gICAgaWQ6IHJvdy5pZCxcbiAgICBpc0dyb3VwOiByb3cuaXNHcm91cCxcbiAgICB0aXRsZTogcm93LnRpdGxlLFxuICAgIHBhcnRpY2lwYW50czogcm93Lm1lbWJlcnMubWFwKChtKSA9PiB0b1BhcnRpY2lwYW50RFRPKG0udXNlcikpLFxuICAgIGxhc3RNZXNzYWdlOiByb3cubWVzc2FnZXNbMF0gPyB0b01lc3NhZ2VEVE8ocm93Lm1lc3NhZ2VzWzBdKSA6IG51bGwsXG4gICAgdW5yZWFkQ291bnQsXG4gICAgbXlMYXN0UmVhZEF0OiBteUxhc3RSZWFkQXQudG9JU09TdHJpbmcoKSxcbiAgICB1cGRhdGVkQXQ6IHJvdy51cGRhdGVkQXQudG9JU09TdHJpbmcoKSxcbiAgfTtcbn1cblxuLyoqIFN0YW5kYXJkIGluY2x1ZGUgZm9yIGxvYWRpbmcgYSBtZXNzYWdlIHdpdGggZXZlcnl0aGluZyB0aGUgRFRPIG5lZWRzLiAqL1xuZXhwb3J0IGNvbnN0IG1lc3NhZ2VJbmNsdWRlID0ge1xuICByZWFkczogdHJ1ZSxcbiAgcmVhY3Rpb25zOiB0cnVlLFxuICByZXBseVRvOiB0cnVlLFxufSBhcyBjb25zdDtcbiIsICJpbXBvcnQgeyBwcmlzbWEgfSBmcm9tIFwiQC9saWIvcHJpc21hXCI7XG5pbXBvcnQgdHlwZSB7IENvbnZlcnNhdGlvbkRUTyB9IGZyb20gXCJAL2xpYi90eXBlc1wiO1xuaW1wb3J0IHsgbWVzc2FnZUluY2x1ZGUsIHRvQ29udmVyc2F0aW9uRFRPLCB0eXBlIENvbnZlcnNhdGlvblJvdyB9IGZyb20gXCIuL3NlcmlhbGl6ZVwiO1xuXG5jb25zdCBtZW1iZXJVc2VyU2VsZWN0ID0ge1xuICBzZWxlY3Q6IHsgaWQ6IHRydWUsIHVzZXJuYW1lOiB0cnVlLCBkaXNwbGF5TmFtZTogdHJ1ZSwgYXZhdGFyQ29sb3I6IHRydWUgfSxcbn0gYXMgY29uc3Q7XG5cbi8qKiBUaHJvd3MtZnJlZSBtZW1iZXJzaGlwIGNoZWNrIHVzZWQgZm9yIGF1dGhvcml6YXRpb24gZXZlcnl3aGVyZS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBpc01lbWJlcihjb252ZXJzYXRpb25JZDogc3RyaW5nLCB1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBjb25zdCBjb3VudCA9IGF3YWl0IHByaXNtYS5jb252ZXJzYXRpb25NZW1iZXIuY291bnQoe1xuICAgIHdoZXJlOiB7IGNvbnZlcnNhdGlvbklkLCB1c2VySWQgfSxcbiAgfSk7XG4gIHJldHVybiBjb3VudCA+IDA7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRNZW1iZXJJZHMoY29udmVyc2F0aW9uSWQ6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgY29uc3Qgcm93cyA9IGF3YWl0IHByaXNtYS5jb252ZXJzYXRpb25NZW1iZXIuZmluZE1hbnkoe1xuICAgIHdoZXJlOiB7IGNvbnZlcnNhdGlvbklkIH0sXG4gICAgc2VsZWN0OiB7IHVzZXJJZDogdHJ1ZSB9LFxuICB9KTtcbiAgcmV0dXJuIHJvd3MubWFwKChyKSA9PiByLnVzZXJJZCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsaXN0Q29udmVyc2F0aW9ucyh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8Q29udmVyc2F0aW9uRFRPW10+IHtcbiAgY29uc3Qgcm93cyA9IGF3YWl0IHByaXNtYS5jb252ZXJzYXRpb24uZmluZE1hbnkoe1xuICAgIHdoZXJlOiB7IG1lbWJlcnM6IHsgc29tZTogeyB1c2VySWQgfSB9IH0sXG4gICAgb3JkZXJCeTogeyB1cGRhdGVkQXQ6IFwiZGVzY1wiIH0sXG4gICAgaW5jbHVkZToge1xuICAgICAgbWVtYmVyczogeyBpbmNsdWRlOiB7IHVzZXI6IG1lbWJlclVzZXJTZWxlY3QgfSB9LFxuICAgICAgbWVzc2FnZXM6IHtcbiAgICAgICAgd2hlcmU6IHsgaGlkZGVuRm9yOiB7IG5vbmU6IHsgdXNlcklkIH0gfSB9LFxuICAgICAgICBvcmRlckJ5OiB7IGNyZWF0ZWRBdDogXCJkZXNjXCIgfSxcbiAgICAgICAgdGFrZTogMSxcbiAgICAgICAgaW5jbHVkZTogbWVzc2FnZUluY2x1ZGUsXG4gICAgICB9LFxuICAgIH0sXG4gIH0pO1xuXG4gIGNvbnN0IG1lbWJlcnNoaXBzID0gYXdhaXQgcHJpc21hLmNvbnZlcnNhdGlvbk1lbWJlci5maW5kTWFueSh7XG4gICAgd2hlcmU6IHsgdXNlcklkLCBjb252ZXJzYXRpb25JZDogeyBpbjogcm93cy5tYXAoKHIpID0+IHIuaWQpIH0gfSxcbiAgICBzZWxlY3Q6IHsgY29udmVyc2F0aW9uSWQ6IHRydWUsIGxhc3RSZWFkQXQ6IHRydWUgfSxcbiAgfSk7XG4gIGNvbnN0IGxhc3RSZWFkTWFwID0gbmV3IE1hcChtZW1iZXJzaGlwcy5tYXAoKG0pID0+IFttLmNvbnZlcnNhdGlvbklkLCBtLmxhc3RSZWFkQXRdKSk7XG5cbiAgY29uc3QgcmVzdWx0OiBDb252ZXJzYXRpb25EVE9bXSA9IFtdO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgY29uc3QgbGFzdFJlYWRBdCA9IGxhc3RSZWFkTWFwLmdldChyb3cuaWQpID8/IG5ldyBEYXRlKDApO1xuICAgIGNvbnN0IHVucmVhZENvdW50ID0gYXdhaXQgcHJpc21hLm1lc3NhZ2UuY291bnQoe1xuICAgICAgd2hlcmU6IHtcbiAgICAgICAgY29udmVyc2F0aW9uSWQ6IHJvdy5pZCxcbiAgICAgICAgc2VuZGVySWQ6IHsgbm90OiB1c2VySWQgfSxcbiAgICAgICAgY3JlYXRlZEF0OiB7IGd0OiBsYXN0UmVhZEF0IH0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHJlc3VsdC5wdXNoKHRvQ29udmVyc2F0aW9uRFRPKHJvdyBhcyBDb252ZXJzYXRpb25Sb3csIHVucmVhZENvdW50LCBsYXN0UmVhZEF0KSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldENvbnZlcnNhdGlvbkZvclVzZXIoXG4gIGNvbnZlcnNhdGlvbklkOiBzdHJpbmcsXG4gIHVzZXJJZDogc3RyaW5nXG4pOiBQcm9taXNlPENvbnZlcnNhdGlvbkRUTyB8IG51bGw+IHtcbiAgaWYgKCEoYXdhaXQgaXNNZW1iZXIoY29udmVyc2F0aW9uSWQsIHVzZXJJZCkpKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgcm93ID0gYXdhaXQgcHJpc21hLmNvbnZlcnNhdGlvbi5maW5kVW5pcXVlKHtcbiAgICB3aGVyZTogeyBpZDogY29udmVyc2F0aW9uSWQgfSxcbiAgICBpbmNsdWRlOiB7XG4gICAgICBtZW1iZXJzOiB7IGluY2x1ZGU6IHsgdXNlcjogbWVtYmVyVXNlclNlbGVjdCB9IH0sXG4gICAgICBtZXNzYWdlczoge1xuICAgICAgICB3aGVyZTogeyBoaWRkZW5Gb3I6IHsgbm9uZTogeyB1c2VySWQgfSB9IH0sXG4gICAgICAgIG9yZGVyQnk6IHsgY3JlYXRlZEF0OiBcImRlc2NcIiB9LFxuICAgICAgICB0YWtlOiAxLFxuICAgICAgICBpbmNsdWRlOiBtZXNzYWdlSW5jbHVkZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSk7XG4gIGlmICghcm93KSByZXR1cm4gbnVsbDtcbiAgY29uc3QgbWVtYmVyc2hpcCA9IGF3YWl0IHByaXNtYS5jb252ZXJzYXRpb25NZW1iZXIuZmluZFVuaXF1ZSh7XG4gICAgd2hlcmU6IHsgY29udmVyc2F0aW9uSWRfdXNlcklkOiB7IGNvbnZlcnNhdGlvbklkLCB1c2VySWQgfSB9LFxuICB9KTtcbiAgY29uc3QgbGFzdFJlYWRBdCA9IG1lbWJlcnNoaXA/Lmxhc3RSZWFkQXQgPz8gbmV3IERhdGUoMCk7XG4gIGNvbnN0IHVucmVhZENvdW50ID0gYXdhaXQgcHJpc21hLm1lc3NhZ2UuY291bnQoe1xuICAgIHdoZXJlOiB7XG4gICAgICBjb252ZXJzYXRpb25JZCxcbiAgICAgIHNlbmRlcklkOiB7IG5vdDogdXNlcklkIH0sXG4gICAgICBjcmVhdGVkQXQ6IHsgZ3Q6IGxhc3RSZWFkQXQgfSxcbiAgICB9LFxuICB9KTtcbiAgcmV0dXJuIHRvQ29udmVyc2F0aW9uRFRPKHJvdyBhcyBDb252ZXJzYXRpb25Sb3csIHVucmVhZENvdW50LCBsYXN0UmVhZEF0KTtcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgMToxIGNvbnZlcnNhdGlvbiwgb3IgcmV0dXJucyB0aGUgZXhpc3Rpbmcgb25lIGJldHdlZW4gdGhlIHR3byB1c2Vyc1xuICogKGlkZW1wb3RlbnQgXHUyMDE0IGEgdXNlciBkb3VibGUtY2xpY2tpbmcgXCJtZXNzYWdlXCIgbmV2ZXIgY3JlYXRlcyBkdXBsaWNhdGVzKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldE9yQ3JlYXRlRGlyZWN0Q29udmVyc2F0aW9uKFxuICB1c2VySWQ6IHN0cmluZyxcbiAgb3RoZXJVc2VySWQ6IHN0cmluZ1xuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgaWYgKHVzZXJJZCA9PT0gb3RoZXJVc2VySWQpIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzdGFydCBhIGNvbnZlcnNhdGlvbiB3aXRoIHlvdXJzZWxmLlwiKTtcblxuICBjb25zdCBvdGhlciA9IGF3YWl0IHByaXNtYS51c2VyLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZDogb3RoZXJVc2VySWQgfSB9KTtcbiAgaWYgKCFvdGhlcikgdGhyb3cgbmV3IEVycm9yKFwiVXNlciBub3QgZm91bmQuXCIpO1xuXG4gIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcHJpc21hLmNvbnZlcnNhdGlvbi5maW5kRmlyc3Qoe1xuICAgIHdoZXJlOiB7XG4gICAgICBpc0dyb3VwOiBmYWxzZSxcbiAgICAgIEFORDogW1xuICAgICAgICB7IG1lbWJlcnM6IHsgc29tZTogeyB1c2VySWQgfSB9IH0sXG4gICAgICAgIHsgbWVtYmVyczogeyBzb21lOiB7IHVzZXJJZDogb3RoZXJVc2VySWQgfSB9IH0sXG4gICAgICBdLFxuICAgIH0sXG4gICAgc2VsZWN0OiB7IGlkOiB0cnVlLCBtZW1iZXJzOiB7IHNlbGVjdDogeyB1c2VySWQ6IHRydWUgfSB9IH0sXG4gIH0pO1xuICBpZiAoZXhpc3RpbmcgJiYgZXhpc3RpbmcubWVtYmVycy5sZW5ndGggPT09IDIpIHJldHVybiBleGlzdGluZy5pZDtcblxuICBjb25zdCBjcmVhdGVkID0gYXdhaXQgcHJpc21hLmNvbnZlcnNhdGlvbi5jcmVhdGUoe1xuICAgIGRhdGE6IHtcbiAgICAgIGlzR3JvdXA6IGZhbHNlLFxuICAgICAgbWVtYmVyczogeyBjcmVhdGU6IFt7IHVzZXJJZCB9LCB7IHVzZXJJZDogb3RoZXJVc2VySWQgfV0gfSxcbiAgICB9LFxuICB9KTtcbiAgcmV0dXJuIGNyZWF0ZWQuaWQ7XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBTb2NrZXQgfSBmcm9tIFwic29ja2V0LmlvXCI7XG5pbXBvcnQgdHlwZSB7IFNlc3Npb25Vc2VyIH0gZnJvbSBcIi4uL2F1dGgtY29yZVwiO1xuaW1wb3J0IHsgZ2V0U2Vzc2lvblVzZXJGcm9tQ29va2llSGVhZGVyIH0gZnJvbSBcIi4uL2F1dGgtY29yZVwiO1xuaW1wb3J0IHR5cGUgeyBDbGllbnRUb1NlcnZlckV2ZW50cywgU2VydmVyVG9DbGllbnRFdmVudHMgfSBmcm9tIFwiLi9ldmVudHNcIjtcbmltcG9ydCB7IGNvbnZlcnNhdGlvblJvb20sIHVzZXJSb29tIH0gZnJvbSBcIi4vZXZlbnRzXCI7XG5pbXBvcnQgeyBhZGRTb2NrZXQsIGdldExhc3RTZWVuLCBpc09ubGluZSwgb25saW5lVXNlcklkcywgcmVtb3ZlU29ja2V0IH0gZnJvbSBcIi4vcHJlc2VuY2VcIjtcbmltcG9ydCB7IHJhdGVMaW1pdCwgUkFURV9MSU1JVFMgfSBmcm9tIFwiLi4vcmF0ZUxpbWl0XCI7XG5pbXBvcnQgeyBjaGVja1Byb2Zhbml0eSB9IGZyb20gXCIuLi9tb2RlcmF0aW9uL3Byb2Zhbml0eVwiO1xuaW1wb3J0IHsgcHJpc21hIH0gZnJvbSBcIi4uL3ByaXNtYVwiO1xuaW1wb3J0IHtcbiAgY3JlYXRlTWVzc2FnZSxcbiAgZGVsZXRlTWVzc2FnZUZvckV2ZXJ5b25lLFxuICBkZWxldGVNZXNzYWdlRm9yTWUsXG4gIGVkaXRNZXNzYWdlLFxuICBnZXRNZXNzYWdlc0FmdGVyLFxuICBtYXJrQ29udmVyc2F0aW9uUmVhZCxcbiAgbWFya0RlbGl2ZXJlZCxcbiAgTWVzc2FnZUVycm9yLFxuICB0b2dnbGVSZWFjdGlvbixcbn0gZnJvbSBcIkAvc2VydmVyL21lc3NhZ2VzXCI7XG5pbXBvcnQgeyBnZXRNZW1iZXJJZHMsIGlzTWVtYmVyIH0gZnJvbSBcIkAvc2VydmVyL2NvbnZlcnNhdGlvbnNcIjtcbmltcG9ydCB0eXBlIHsgVHlwZWRTZXJ2ZXIgfSBmcm9tIFwiLi9pb1wiO1xuXG50eXBlIFR5cGVkU29ja2V0ID0gU29ja2V0PENsaWVudFRvU2VydmVyRXZlbnRzLCBTZXJ2ZXJUb0NsaWVudEV2ZW50cywgUmVjb3JkPHN0cmluZywgbmV2ZXI+LCB7IHVzZXI6IFNlc3Npb25Vc2VyIH0+O1xuXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJTb2NrZXRIYW5kbGVycyhpbzogVHlwZWRTZXJ2ZXIpIHtcbiAgLy8gLS0tIGF1dGhlbnRpY2F0aW9uIG9uIHRoZSBoYW5kc2hha2UgKHNlcnZlci1zaWRlLCBjb29raWUtYmFzZWQpIC0tLVxuICBpby51c2UoYXN5bmMgKHNvY2tldCwgbmV4dCkgPT4ge1xuICAgIGNvbnN0IHVzZXIgPSBhd2FpdCBnZXRTZXNzaW9uVXNlckZyb21Db29raWVIZWFkZXIoc29ja2V0LmhhbmRzaGFrZS5oZWFkZXJzLmNvb2tpZSk7XG4gICAgaWYgKCF1c2VyKSByZXR1cm4gbmV4dChuZXcgRXJyb3IoXCJVTkFVVEhPUklaRURcIikpO1xuICAgIChzb2NrZXQuZGF0YSBhcyB7IHVzZXI6IFNlc3Npb25Vc2VyIH0pLnVzZXIgPSB1c2VyO1xuICAgIG5leHQoKTtcbiAgfSk7XG5cbiAgaW8ub24oXCJjb25uZWN0aW9uXCIsIChzb2NrZXQ6IFR5cGVkU29ja2V0KSA9PiB7XG4gICAgY29uc3QgdXNlciA9IHNvY2tldC5kYXRhLnVzZXI7XG5cbiAgICAvLyAtLS0gcmVnaXN0ZXIgZXZlbnQgaGFuZGxlcnMgc3luY2hyb25vdXNseSAobmV2ZXIgYmVoaW5kIGFuIGF3YWl0KSAtLS1cblxuICAgIC8vIGFzeW5jIGNvbm5lY3Rpb24gc2V0dXA6IGpvaW4gcm9vbXMsIHByZXNlbmNlLCBkZWxpdmVyIHJlY2VpcHRzXG4gICAgdm9pZCAoYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgc29ja2V0LmpvaW4odXNlclJvb20odXNlci5pZCkpO1xuICAgICAgICBjb25zdCBtZW1iZXJzaGlwcyA9IGF3YWl0IHByaXNtYS5jb252ZXJzYXRpb25NZW1iZXIuZmluZE1hbnkoe1xuICAgICAgICAgIHdoZXJlOiB7IHVzZXJJZDogdXNlci5pZCB9LFxuICAgICAgICAgIHNlbGVjdDogeyBjb252ZXJzYXRpb25JZDogdHJ1ZSB9LFxuICAgICAgICB9KTtcbiAgICAgICAgZm9yIChjb25zdCBtIG9mIG1lbWJlcnNoaXBzKSBzb2NrZXQuam9pbihjb252ZXJzYXRpb25Sb29tKG0uY29udmVyc2F0aW9uSWQpKTtcblxuICAgICAgICBjb25zdCBiZWNhbWVPbmxpbmUgPSBhZGRTb2NrZXQodXNlci5pZCwgc29ja2V0LmlkKTtcbiAgICAgICAgc29ja2V0LmVtaXQoXCJwcmVzZW5jZTpzbmFwc2hvdFwiLCB7IG9ubGluZTogb25saW5lVXNlcklkcygpIH0pO1xuICAgICAgICBpZiAoYmVjYW1lT25saW5lKSB7XG4gICAgICAgICAgc29ja2V0LmJyb2FkY2FzdC5lbWl0KFwicHJlc2VuY2U6dXBkYXRlXCIsIHtcbiAgICAgICAgICAgIHVzZXJJZDogdXNlci5pZCxcbiAgICAgICAgICAgIG9ubGluZTogdHJ1ZSxcbiAgICAgICAgICAgIGxhc3RTZWVuOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IG0gb2YgbWVtYmVyc2hpcHMpIHtcbiAgICAgICAgICBjb25zdCBpZHMgPSBhd2FpdCBtYXJrRGVsaXZlcmVkKG0uY29udmVyc2F0aW9uSWQsIHVzZXIuaWQpO1xuICAgICAgICAgIGlmIChpZHMubGVuZ3RoKSB7XG4gICAgICAgICAgICBpby50byhjb252ZXJzYXRpb25Sb29tKG0uY29udmVyc2F0aW9uSWQpKS5lbWl0KFwibWVzc2FnZTpzdGF0dXNcIiwge1xuICAgICAgICAgICAgICBjb252ZXJzYXRpb25JZDogbS5jb252ZXJzYXRpb25JZCxcbiAgICAgICAgICAgICAgbWVzc2FnZUlkczogaWRzLFxuICAgICAgICAgICAgICBzdGF0dXM6IFwiREVMSVZFUkVEXCIsXG4gICAgICAgICAgICAgIGJ5OiB1c2VyLmlkLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcInNvY2tldCBjb25uZWN0aW9uIHNldHVwIGVycm9yXCIsIGVycik7XG4gICAgICB9XG4gICAgfSkoKTtcblxuICAgIC8vIC0tLSBzZW5kIGEgbWVzc2FnZSAodGV4dCAvIGdpZiAvIHN0aWNrZXIpIC0tLVxuICAgIHNvY2tldC5vbihcIm1lc3NhZ2U6c2VuZFwiLCBhc3luYyAoaW5wdXQsIGFjaykgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmwgPSByYXRlTGltaXQoYHNlbmQ6JHt1c2VyLmlkfWAsIFJBVEVfTElNSVRTLnNlbmQubGltaXQsIFJBVEVfTElNSVRTLnNlbmQud2luZG93TXMpO1xuICAgICAgICBpZiAoIXJsLm9rKSB7XG4gICAgICAgICAgcmV0dXJuIGFjayh7IG9rOiBmYWxzZSwgY29kZTogXCJSQVRFX0xJTUlURURcIiwgbWVzc2FnZTogXCJZb3UncmUgc2VuZGluZyBtZXNzYWdlcyB0b28gZmFzdC4gU2xvdyBkb3duIGEgbW9tZW50LlwiIH0pO1xuICAgICAgICB9XG4gICAgICAgIGlmICghW1wiVEVYVFwiLCBcIkdJRlwiLCBcIlNUSUNLRVJcIl0uaW5jbHVkZXMoaW5wdXQua2luZCkpIHtcbiAgICAgICAgICByZXR1cm4gYWNrKHsgb2s6IGZhbHNlLCBjb2RlOiBcIklOVkFMSURcIiwgbWVzc2FnZTogXCJVbnN1cHBvcnRlZCBtZXNzYWdlIHR5cGUgZm9yIHRoaXMgY2hhbm5lbC5cIiB9KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIShhd2FpdCBpc01lbWJlcihpbnB1dC5jb252ZXJzYXRpb25JZCwgdXNlci5pZCkpKSB7XG4gICAgICAgICAgcmV0dXJuIGFjayh7IG9rOiBmYWxzZSwgY29kZTogXCJGT1JCSURERU5cIiwgbWVzc2FnZTogXCJZb3UgYXJlIG5vdCBwYXJ0IG9mIHRoaXMgY29udmVyc2F0aW9uLlwiIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gc2VydmVyLXNpZGUgcHJvZmFuaXR5IG1vZGVyYXRpb24gXHUyMDE0IGFwcGxpZXMgdG8gdGhlIHRleHQgYm9keSBhbmQgdG9cbiAgICAgICAgLy8gR0lGL3N0aWNrZXIgc2VhcmNoIHRpdGxlcyBjYXJyaWVkIGluIG1ldGFkYXRhLlxuICAgICAgICBjb25zdCB0ZXh0VG9TY2FuID0gW2lucHV0LmJvZHkgPz8gXCJcIiwgaW5wdXQubWV0YWRhdGE/LnRpdGxlID8/IFwiXCJdLmpvaW4oXCIgXCIpLnRyaW0oKTtcbiAgICAgICAgaWYgKHRleHRUb1NjYW4pIHtcbiAgICAgICAgICBjb25zdCB2ZXJkaWN0ID0gY2hlY2tQcm9mYW5pdHkodGV4dFRvU2Nhbik7XG4gICAgICAgICAgaWYgKCF2ZXJkaWN0LmNsZWFuKSB7XG4gICAgICAgICAgICBhd2FpdCBwcmlzbWEubW9kZXJhdGlvbkxvZy5jcmVhdGUoe1xuICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgdXNlcklkOiB1c2VyLmlkLFxuICAgICAgICAgICAgICAgIGtpbmQ6IFwicHJvZmFuaXR5XCIsXG4gICAgICAgICAgICAgICAgYWN0aW9uOiBcImJsb2NrZWRcIixcbiAgICAgICAgICAgICAgICByZWFzb246IGBtYXRjaGVkOiAke3ZlcmRpY3QubWF0Y2hlZC5qb2luKFwiLCBcIil9YCxcbiAgICAgICAgICAgICAgICBkZXRhaWw6IHsgY29udmVyc2F0aW9uSWQ6IGlucHV0LmNvbnZlcnNhdGlvbklkIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBhY2soe1xuICAgICAgICAgICAgICBvazogZmFsc2UsXG4gICAgICAgICAgICAgIGNvZGU6IFwiUFJPRkFOSVRZXCIsXG4gICAgICAgICAgICAgIG1lc3NhZ2U6IFwiWW91ciBtZXNzYWdlIHdhcyBibG9ja2VkIGZvciBwcm9oaWJpdGVkIGxhbmd1YWdlLiBQbGVhc2UgcmVwaHJhc2UgYW5kIHRyeSBhZ2Fpbi5cIixcbiAgICAgICAgICAgICAgbWF0Y2hlZDogdmVyZGljdC5tYXRjaGVkLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgeyBtZXNzYWdlIH0gPSBhd2FpdCBjcmVhdGVNZXNzYWdlKHtcbiAgICAgICAgICBjb252ZXJzYXRpb25JZDogaW5wdXQuY29udmVyc2F0aW9uSWQsXG4gICAgICAgICAgc2VuZGVySWQ6IHVzZXIuaWQsXG4gICAgICAgICAgY2xpZW50SWQ6IGlucHV0LmNsaWVudElkLFxuICAgICAgICAgIGtpbmQ6IGlucHV0LmtpbmQsXG4gICAgICAgICAgYm9keTogaW5wdXQuYm9keSxcbiAgICAgICAgICBtZXRhZGF0YTogaW5wdXQubWV0YWRhdGEsXG4gICAgICAgICAgcmVwbHlUb0lkOiBpbnB1dC5yZXBseVRvSWQgPz8gbnVsbCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcGFydGljaXBhbnRJZHMgPSBhd2FpdCBnZXRNZW1iZXJJZHMoaW5wdXQuY29udmVyc2F0aW9uSWQpO1xuICAgICAgICBpby50byhjb252ZXJzYXRpb25Sb29tKGlucHV0LmNvbnZlcnNhdGlvbklkKSkuZW1pdChcIm1lc3NhZ2U6bmV3XCIsIG1lc3NhZ2UpO1xuICAgICAgICBmb3IgKGNvbnN0IHVpZCBvZiBwYXJ0aWNpcGFudElkcykge1xuICAgICAgICAgIGlmICh1aWQgIT09IHVzZXIuaWQpIGlvLnRvKHVzZXJSb29tKHVpZCkpLmVtaXQoXCJtZXNzYWdlOm5ld1wiLCBtZXNzYWdlKTtcbiAgICAgICAgfVxuICAgICAgICBhY2soeyBvazogdHJ1ZSwgbWVzc2FnZSB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBpZiAoZXJyIGluc3RhbmNlb2YgTWVzc2FnZUVycm9yKSB7XG4gICAgICAgICAgcmV0dXJuIGFjayh7IG9rOiBmYWxzZSwgY29kZTogZXJyLmNvZGUgPT09IFwiRk9SQklEREVOXCIgPyBcIkZPUkJJRERFTlwiIDogXCJJTlZBTElEXCIsIG1lc3NhZ2U6IGVyci5tZXNzYWdlIH0pO1xuICAgICAgICB9XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJtZXNzYWdlOnNlbmQgZXJyb3JcIiwgZXJyKTtcbiAgICAgICAgYWNrKHsgb2s6IGZhbHNlLCBjb2RlOiBcIkVSUk9SXCIsIG1lc3NhZ2U6IFwiU29tZXRoaW5nIHdlbnQgd3Jvbmcgc2VuZGluZyB5b3VyIG1lc3NhZ2UuXCIgfSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyAtLS0gcmVhY3Rpb25zIC0tLVxuICAgIHNvY2tldC5vbihcInJlYWN0aW9uOnRvZ2dsZVwiLCBhc3luYyAoeyBtZXNzYWdlSWQsIGVtb2ppIH0sIGFjaykgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmwgPSByYXRlTGltaXQoYHJlYWN0OiR7dXNlci5pZH1gLCBSQVRFX0xJTUlUUy5yZWFjdGlvbi5saW1pdCwgUkFURV9MSU1JVFMucmVhY3Rpb24ud2luZG93TXMpO1xuICAgICAgICBpZiAoIXJsLm9rKSByZXR1cm4gYWNrKHsgb2s6IGZhbHNlLCBtZXNzYWdlOiBcIlNsb3cgZG93biBhIG1vbWVudC5cIiB9KTtcbiAgICAgICAgY29uc3QgeyBjb252ZXJzYXRpb25JZCwgbWVzc2FnZUlkOiBtaWQsIHJlYWN0aW9ucyB9ID0gYXdhaXQgdG9nZ2xlUmVhY3Rpb24oXG4gICAgICAgICAgbWVzc2FnZUlkLFxuICAgICAgICAgIHVzZXIuaWQsXG4gICAgICAgICAgZW1vamlcbiAgICAgICAgKTtcbiAgICAgICAgaW8udG8oY29udmVyc2F0aW9uUm9vbShjb252ZXJzYXRpb25JZCkpLmVtaXQoXCJyZWFjdGlvbjp1cGRhdGVcIiwge1xuICAgICAgICAgIGNvbnZlcnNhdGlvbklkLFxuICAgICAgICAgIG1lc3NhZ2VJZDogbWlkLFxuICAgICAgICAgIHJlYWN0aW9ucyxcbiAgICAgICAgfSk7XG4gICAgICAgIGFjayh7IG9rOiB0cnVlIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBNZXNzYWdlRXJyb3IpIHJldHVybiBhY2soeyBvazogZmFsc2UsIG1lc3NhZ2U6IGVyci5tZXNzYWdlIH0pO1xuICAgICAgICBjb25zb2xlLmVycm9yKFwicmVhY3Rpb246dG9nZ2xlIGVycm9yXCIsIGVycik7XG4gICAgICAgIGFjayh7IG9rOiBmYWxzZSwgbWVzc2FnZTogXCJDb3VsZCBub3QgYWRkIHJlYWN0aW9uLlwiIH0pO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gLS0tIGVkaXQgYSBtZXNzYWdlICh0ZXh0IG9ubHksIHNlbmRlciBvbmx5KSAtLS1cbiAgICBzb2NrZXQub24oXCJtZXNzYWdlOmVkaXRcIiwgYXN5bmMgKHsgbWVzc2FnZUlkLCBib2R5IH0sIGFjaykgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmwgPSByYXRlTGltaXQoYGVkaXQ6JHt1c2VyLmlkfWAsIFJBVEVfTElNSVRTLm1lc3NhZ2VFZGl0LmxpbWl0LCBSQVRFX0xJTUlUUy5tZXNzYWdlRWRpdC53aW5kb3dNcyk7XG4gICAgICAgIGlmICghcmwub2spIHtcbiAgICAgICAgICByZXR1cm4gYWNrKHsgb2s6IGZhbHNlLCBjb2RlOiBcIlJBVEVfTElNSVRFRFwiLCBtZXNzYWdlOiBcIllvdSdyZSBlZGl0aW5nIHRvbyBmYXN0LiBTbG93IGRvd24gYSBtb21lbnQuXCIgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyB0aGUgbmV3IGJvZHkgZ29lcyB0aHJvdWdoIHRoZSBzYW1lIHNlcnZlci1zaWRlIHByb2Zhbml0eSBnYXRlIGFzIGEgc2VuZFxuICAgICAgICBjb25zdCB2ZXJkaWN0ID0gY2hlY2tQcm9mYW5pdHkoYm9keSA/PyBcIlwiKTtcbiAgICAgICAgaWYgKCF2ZXJkaWN0LmNsZWFuKSB7XG4gICAgICAgICAgYXdhaXQgcHJpc21hLm1vZGVyYXRpb25Mb2cuY3JlYXRlKHtcbiAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgdXNlcklkOiB1c2VyLmlkLFxuICAgICAgICAgICAgICBraW5kOiBcInByb2Zhbml0eVwiLFxuICAgICAgICAgICAgICBhY3Rpb246IFwiYmxvY2tlZFwiLFxuICAgICAgICAgICAgICByZWFzb246IGBtYXRjaGVkOiAke3ZlcmRpY3QubWF0Y2hlZC5qb2luKFwiLCBcIil9YCxcbiAgICAgICAgICAgICAgZGV0YWlsOiB7IG1lc3NhZ2VJZCwgZWRpdDogdHJ1ZSB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXR1cm4gYWNrKHtcbiAgICAgICAgICAgIG9rOiBmYWxzZSxcbiAgICAgICAgICAgIGNvZGU6IFwiUFJPRkFOSVRZXCIsXG4gICAgICAgICAgICBtZXNzYWdlOiBcIllvdXIgZWRpdCB3YXMgYmxvY2tlZCBmb3IgcHJvaGliaXRlZCBsYW5ndWFnZS4gUGxlYXNlIHJlcGhyYXNlIGFuZCB0cnkgYWdhaW4uXCIsXG4gICAgICAgICAgICBtYXRjaGVkOiB2ZXJkaWN0Lm1hdGNoZWQsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7IG1lc3NhZ2UsIGNvbnZlcnNhdGlvbklkIH0gPSBhd2FpdCBlZGl0TWVzc2FnZShtZXNzYWdlSWQsIHVzZXIuaWQsIGJvZHkpO1xuICAgICAgICBpby50byhjb252ZXJzYXRpb25Sb29tKGNvbnZlcnNhdGlvbklkKSkuZW1pdChcIm1lc3NhZ2U6dXBkYXRlXCIsIG1lc3NhZ2UpO1xuICAgICAgICBhY2soeyBvazogdHJ1ZSwgbWVzc2FnZSB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBpZiAoZXJyIGluc3RhbmNlb2YgTWVzc2FnZUVycm9yKSB7XG4gICAgICAgICAgcmV0dXJuIGFjayh7IG9rOiBmYWxzZSwgY29kZTogZXJyLmNvZGUgPT09IFwiRk9SQklEREVOXCIgPyBcIkZPUkJJRERFTlwiIDogXCJJTlZBTElEXCIsIG1lc3NhZ2U6IGVyci5tZXNzYWdlIH0pO1xuICAgICAgICB9XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJtZXNzYWdlOmVkaXQgZXJyb3JcIiwgZXJyKTtcbiAgICAgICAgYWNrKHsgb2s6IGZhbHNlLCBjb2RlOiBcIkVSUk9SXCIsIG1lc3NhZ2U6IFwiQ291bGQgbm90IGVkaXQgdGhlIG1lc3NhZ2UuXCIgfSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyAtLS0gZGVsZXRlIGEgbWVzc2FnZSAoZm9yIG1lIC8gZm9yIGV2ZXJ5b25lKSAtLS1cbiAgICBzb2NrZXQub24oXCJtZXNzYWdlOmRlbGV0ZVwiLCBhc3luYyAoeyBtZXNzYWdlSWQsIHNjb3BlIH0sIGFjaykgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmwgPSByYXRlTGltaXQoYGRlbDoke3VzZXIuaWR9YCwgUkFURV9MSU1JVFMubWVzc2FnZURlbGV0ZS5saW1pdCwgUkFURV9MSU1JVFMubWVzc2FnZURlbGV0ZS53aW5kb3dNcyk7XG4gICAgICAgIGlmICghcmwub2spIHJldHVybiBhY2soeyBvazogZmFsc2UsIG1lc3NhZ2U6IFwiWW91J3JlIGRlbGV0aW5nIHRvbyBmYXN0LiBTbG93IGRvd24gYSBtb21lbnQuXCIgfSk7XG5cbiAgICAgICAgaWYgKHNjb3BlID09PSBcImV2ZXJ5b25lXCIpIHtcbiAgICAgICAgICBjb25zdCB7IG1lc3NhZ2UsIGNvbnZlcnNhdGlvbklkIH0gPSBhd2FpdCBkZWxldGVNZXNzYWdlRm9yRXZlcnlvbmUobWVzc2FnZUlkLCB1c2VyLmlkKTtcbiAgICAgICAgICBpby50byhjb252ZXJzYXRpb25Sb29tKGNvbnZlcnNhdGlvbklkKSkuZW1pdChcIm1lc3NhZ2U6dXBkYXRlXCIsIG1lc3NhZ2UpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IHsgY29udmVyc2F0aW9uSWQgfSA9IGF3YWl0IGRlbGV0ZU1lc3NhZ2VGb3JNZShtZXNzYWdlSWQsIHVzZXIuaWQpO1xuICAgICAgICAgIGlvLnRvKHVzZXJSb29tKHVzZXIuaWQpKS5lbWl0KFwibWVzc2FnZTpyZW1vdmVkXCIsIHsgY29udmVyc2F0aW9uSWQsIG1lc3NhZ2VJZCB9KTtcbiAgICAgICAgfVxuICAgICAgICBhY2soeyBvazogdHJ1ZSB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBpZiAoZXJyIGluc3RhbmNlb2YgTWVzc2FnZUVycm9yKSByZXR1cm4gYWNrKHsgb2s6IGZhbHNlLCBtZXNzYWdlOiBlcnIubWVzc2FnZSB9KTtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIm1lc3NhZ2U6ZGVsZXRlIGVycm9yXCIsIGVycik7XG4gICAgICAgIGFjayh7IG9rOiBmYWxzZSwgbWVzc2FnZTogXCJDb3VsZCBub3QgZGVsZXRlIHRoZSBtZXNzYWdlLlwiIH0pO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gLS0tIHJlY29ubmVjdCByZWNvbmNpbGlhdGlvbiAtLS1cbiAgICBzb2NrZXQub24oXCJtZXNzYWdlOnN5bmNcIiwgYXN5bmMgKHsgY29udmVyc2F0aW9uSWQsIGFmdGVySWQgfSwgYWNrKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBtZXNzYWdlcyA9IGF3YWl0IGdldE1lc3NhZ2VzQWZ0ZXIoY29udmVyc2F0aW9uSWQsIHVzZXIuaWQsIGFmdGVySWQpO1xuICAgICAgICBhY2soeyBtZXNzYWdlcyB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICBhY2soeyBtZXNzYWdlczogW10gfSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyAtLS0gcmVhZCByZWNlaXB0cyAtLS1cbiAgICBzb2NrZXQub24oXCJtZXNzYWdlOnJlYWRcIiwgYXN5bmMgKHsgY29udmVyc2F0aW9uSWQgfSwgYWNrKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB7IG1lc3NhZ2VJZHMsIHJlYWRBdCB9ID0gYXdhaXQgbWFya0NvbnZlcnNhdGlvblJlYWQoY29udmVyc2F0aW9uSWQsIHVzZXIuaWQpO1xuICAgICAgICBpZiAobWVzc2FnZUlkcy5sZW5ndGgpIHtcbiAgICAgICAgICBpby50byhjb252ZXJzYXRpb25Sb29tKGNvbnZlcnNhdGlvbklkKSkuZW1pdChcIm1lc3NhZ2U6c3RhdHVzXCIsIHtcbiAgICAgICAgICAgIGNvbnZlcnNhdGlvbklkLFxuICAgICAgICAgICAgbWVzc2FnZUlkcyxcbiAgICAgICAgICAgIHN0YXR1czogXCJSRUFEXCIsXG4gICAgICAgICAgICBieTogdXNlci5pZCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBhY2s/Lih7IG9rOiB0cnVlIH0pO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIGFjaz8uKHsgb2s6IGZhbHNlIH0pO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gLS0tIHR5cGluZyBpbmRpY2F0b3JzIC0tLVxuICAgIGNvbnN0IGVtaXRUeXBpbmcgPSAoY29udmVyc2F0aW9uSWQ6IHN0cmluZywgdHlwaW5nOiBib29sZWFuKSA9PiB7XG4gICAgICBzb2NrZXQudG8oY29udmVyc2F0aW9uUm9vbShjb252ZXJzYXRpb25JZCkpLmVtaXQoXCJ0eXBpbmc6dXBkYXRlXCIsIHtcbiAgICAgICAgY29udmVyc2F0aW9uSWQsXG4gICAgICAgIHVzZXJJZDogdXNlci5pZCxcbiAgICAgICAgdHlwaW5nLFxuICAgICAgfSk7XG4gICAgfTtcbiAgICBzb2NrZXQub24oXCJ0eXBpbmc6c3RhcnRcIiwgKHsgY29udmVyc2F0aW9uSWQgfSkgPT4gZW1pdFR5cGluZyhjb252ZXJzYXRpb25JZCwgdHJ1ZSkpO1xuICAgIHNvY2tldC5vbihcInR5cGluZzpzdG9wXCIsICh7IGNvbnZlcnNhdGlvbklkIH0pID0+IGVtaXRUeXBpbmcoY29udmVyc2F0aW9uSWQsIGZhbHNlKSk7XG5cbiAgICBzb2NrZXQub24oXCJwcmVzZW5jZTpwaW5nXCIsICgpID0+IHtcbiAgICAgIHNvY2tldC5lbWl0KFwicHJlc2VuY2U6c25hcHNob3RcIiwgeyBvbmxpbmU6IG9ubGluZVVzZXJJZHMoKSB9KTtcbiAgICB9KTtcblxuICAgIHNvY2tldC5vbihcImRpc2Nvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgYmVjYW1lT2ZmbGluZSA9IHJlbW92ZVNvY2tldCh1c2VyLmlkLCBzb2NrZXQuaWQpO1xuICAgICAgaWYgKGJlY2FtZU9mZmxpbmUpIHtcbiAgICAgICAgc29ja2V0LmJyb2FkY2FzdC5lbWl0KFwicHJlc2VuY2U6dXBkYXRlXCIsIHtcbiAgICAgICAgICB1c2VySWQ6IHVzZXIuaWQsXG4gICAgICAgICAgb25saW5lOiBmYWxzZSxcbiAgICAgICAgICBsYXN0U2VlbjogZ2V0TGFzdFNlZW4odXNlci5pZCksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbn1cblxuZXhwb3J0IHsgaXNPbmxpbmUgfTtcbiIsICJpbXBvcnQgdHlwZSB7IFNlcnZlciBhcyBJT1NlcnZlciB9IGZyb20gXCJzb2NrZXQuaW9cIjtcbmltcG9ydCB0eXBlIHsgQ2xpZW50VG9TZXJ2ZXJFdmVudHMsIFNlcnZlclRvQ2xpZW50RXZlbnRzIH0gZnJvbSBcIi4vZXZlbnRzXCI7XG5pbXBvcnQgeyBjb252ZXJzYXRpb25Sb29tLCB1c2VyUm9vbSB9IGZyb20gXCIuL2V2ZW50c1wiO1xuaW1wb3J0IHR5cGUgeyBNZXNzYWdlRFRPIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCB0eXBlIFR5cGVkU2VydmVyID0gSU9TZXJ2ZXI8Q2xpZW50VG9TZXJ2ZXJFdmVudHMsIFNlcnZlclRvQ2xpZW50RXZlbnRzPjtcblxuY29uc3QgZyA9IGdsb2JhbFRoaXMgYXMgdW5rbm93biBhcyB7IF9fcnRtSU8/OiBUeXBlZFNlcnZlciB9O1xuXG5leHBvcnQgZnVuY3Rpb24gc2V0SU8oaW86IFR5cGVkU2VydmVyKSB7XG4gIGcuX19ydG1JTyA9IGlvO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0SU8oKTogVHlwZWRTZXJ2ZXIgfCBudWxsIHtcbiAgcmV0dXJuIGcuX19ydG1JTyA/PyBudWxsO1xufVxuXG4vKipcbiAqIEZhbiBhIGZyZXNobHktY3JlYXRlZCBtZXNzYWdlIG91dCB0byBldmVyeSBwYXJ0aWNpcGFudC4gQ2FsbGVkIGZyb20gYm90aCB0aGVcbiAqIHNvY2tldCBoYW5kbGVyICh0ZXh0L2dpZi9zdGlja2VyKSBhbmQgdGhlIFJFU1QgdXBsb2FkIHJvdXRlIChpbWFnZXMpLCBzb1xuICogbW9kZXJhdGVkIGltYWdlcyByZWFjaCBjbGllbnRzIG92ZXIgdGhlIHNhbWUgcmVhbC10aW1lIGNoYW5uZWwuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBicm9hZGNhc3RNZXNzYWdlKG1zZzogTWVzc2FnZURUTywgcGFydGljaXBhbnRJZHM6IHN0cmluZ1tdKSB7XG4gIGNvbnN0IGlvID0gZ2V0SU8oKTtcbiAgaWYgKCFpbykgcmV0dXJuO1xuICBpby50byhjb252ZXJzYXRpb25Sb29tKG1zZy5jb252ZXJzYXRpb25JZCkpLmVtaXQoXCJtZXNzYWdlOm5ld1wiLCBtc2cpO1xuICAvLyBhbHNvIG5vdGlmeSBwYXJ0aWNpcGFudHMgbm90IGN1cnJlbnRseSBpbiB0aGUgcm9vbSAoZS5nLiBsaXN0IHZpZXcgb25seSlcbiAgZm9yIChjb25zdCB1aWQgb2YgcGFydGljaXBhbnRJZHMpIHtcbiAgICBpby50byh1c2VyUm9vbSh1aWQpKS5lbWl0KFwibWVzc2FnZTpuZXdcIiwgbXNnKTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gbm90aWZ5Q29udmVyc2F0aW9uQ3JlYXRlZChjb252ZXJzYXRpb25JZDogc3RyaW5nLCBwYXJ0aWNpcGFudElkczogc3RyaW5nW10pIHtcbiAgY29uc3QgaW8gPSBnZXRJTygpO1xuICBpZiAoIWlvKSByZXR1cm47XG4gIGZvciAoY29uc3QgdWlkIG9mIHBhcnRpY2lwYW50SWRzKSB7XG4gICAgaW8udG8odXNlclJvb20odWlkKSkuZW1pdChcImNvbnZlcnNhdGlvbjpuZXdcIiwgY29udmVyc2F0aW9uSWQpO1xuICB9XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsb0JBQU87QUFDUCx1QkFBNkI7QUFDN0Isa0JBQWlCO0FBQ2pCLG9CQUFtQzs7O0FDRm5DLGlCQUFrQjtBQUVsQixJQUFNLFNBQVMsYUFBRSxPQUFPO0FBQUEsRUFDdEIsY0FBYyxhQUFFLE9BQU8sRUFBRSxJQUFJLENBQUM7QUFBQSxFQUM5QixhQUFhLGFBQUUsT0FBTyxFQUFFLElBQUksSUFBSSw0Q0FBNEM7QUFBQSxFQUM1RSxhQUFhLGFBQUUsT0FBTyxFQUFFLFFBQVEsYUFBYTtBQUFBLEVBQzdDLE1BQU0sYUFBRSxPQUFPLE9BQU8sRUFBRSxRQUFRLEdBQUk7QUFBQSxFQUNwQyxVQUFVLGFBQUUsT0FBTyxFQUFFLFFBQVEsV0FBVztBQUFBLEVBQ3hDLFlBQVksYUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLFFBQVEsdUJBQXVCO0FBQUEsRUFDNUQsZUFBZSxhQUFFLE9BQU8sRUFBRSxJQUFJLENBQUM7QUFBQSxFQUMvQixhQUFhLGFBQUUsT0FBTyxFQUFFLFFBQVEsV0FBVztBQUFBLEVBQzNDLGtCQUFrQixhQUFFLE9BQU8sT0FBTyxFQUFFLFFBQVEsT0FBUztBQUFBLEVBQ3JELGdCQUFn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LFdBQVcsZ0JBQWdCLElBQUksQ0FBQztBQUNsRixXQUFPLEdBQUcsZUFBZSxDQUFDLEVBQUUsZUFBZSxNQUFNLFdBQVcsZ0JBQWdCLEtBQUssQ0FBQztBQUVsRixXQUFPLEdBQUcsaUJBQWlCLE1BQU07QUFDL0IsYUFBTyxLQUFLLHFCQUFxQixFQUFFLFFBQVEsY0FBYyxFQUFFLENBQUM7QUFBQSxJQUM5RCxDQUFDO0FBRUQsV0FBTyxHQUFHLGNBQWMsTUFBTTtBQUM1QixZQUFNLGdCQUFnQixhQUFhLEtBQUssSUFBSSxPQUFPLEVBQUU7QUFDckQsVUFBSSxlQUFlO0FBQ2pCLGVBQU8sVUFBVSxLQUFLLG1CQUFtQjtBQUFBLFVBQ3ZDLFFBQVEsS0FBSztBQUFBLFVBQ2IsUUFBUTtBQUFBLFVBQ1IsVUFBVSxZQUFZLEtBQUssRUFBRTtBQUFBLFFBQy9CLENBQUM7QUFBQSxNQUNIO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSCxDQUFDO0FBQ0g7OztBQzdRQSxJQUFNLElBQUk7QUFFSCxTQUFTLE1BQU0sSUFBaUI7QUFDckMsSUFBRSxVQUFVO0FBQ2Q7OztBYkhBLElBQU0sTUFBTSxRQUFRLElBQUksYUFBYTtBQUNyQyxJQUFNLFVBQU0sWUFBQUMsU0FBSyxFQUFFLEtBQUssVUFBVSxJQUFJLFVBQVUsTUFBTSxJQUFJLEtBQUssQ0FBQztBQUNoRSxJQUFNLFNBQVMsSUFBSSxrQkFBa0I7QUFFckMsZUFBZSxPQUFPO0FBQ3BCLFFBQU0sSUFBSSxRQUFRO0FBRWxCLFFBQU0sYUFBUywrQkFBYSxDQUFDLEtBQUssUUFBUTtBQUN4QyxXQUFPLEtBQUssR0FBRztBQUFBLEVBQ2pCLENBQUM7QUFFRCxRQUFNLEtBQWtCLElBQUksY0FBQUMsT0FBUyxRQUFRO0FBQUEsSUFDM0MsTUFBTTtBQUFBLElBQ04sTUFBTSxFQUFFLFFBQVEsSUFBSSxZQUFZLGFBQWEsS0FBSztBQUFBO0FBQUEsSUFFbEQseUJBQXlCO0FBQUEsTUFDdkIsMEJBQTBCLElBQUksS0FBSztBQUFBLE1BQ25DLGlCQUFpQjtBQUFBLElBQ25CO0FBQUEsRUFDRixDQUFDO0FBRUQsUUFBTSxFQUFFO0FBQ1IseUJBQXVCLEVBQUU7QUFFekIsU0FBTyxPQUFPLElBQUksTUFBTSxNQUFNO0FBQzVCLFlBQVEsSUFBSTtBQUFBLHVDQUFxQyxJQUFJLFVBQVU7QUFBQSxDQUFJO0FBQUEsRUFDckUsQ0FBQztBQUNIO0FBRUEsS0FBSyxFQUFFLE1BQU0sQ0FBQyxRQUFRO0FBQ3BCLFVBQVEsTUFBTSxHQUFHO0FBQ2pCLFVBQVEsS0FBSyxDQUFDO0FBQ2hCLENBQUM7IiwKICAibmFtZXMiOiBbInBhcnNlQ29va2llIiwgImltcG9ydF9jbGllbnQiLCAiZyIsICJnIiwgIm5leHQiLCAibmV4dCIsICJJT1NlcnZlciJdCn0K
