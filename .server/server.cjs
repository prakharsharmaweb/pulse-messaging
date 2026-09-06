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
  NSFW_THRESHOLD: import_zod.z.coerce.number().default(0.6)
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
  reaction: { limit: 40, windowMs: 1e4 }
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
  const replyTo = m.replyTo ? {
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
    body: m.body,
    metadata: m.metadata ?? null,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    readBy: (m.reads ?? []).map((r) => r.userId),
    reactions: groupReactions(m.reactions),
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
    where: { conversationId, ...after ? { createdAt: { gt: after } } : {} },
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc2VydmVyLnRzIiwgIi4uL3NyYy9saWIvZW52LnRzIiwgIi4uL3NyYy9saWIvYXV0aC1jb3JlLnRzIiwgIi4uL3NyYy9saWIvcHJpc21hLnRzIiwgIi4uL3NyYy9saWIvc29ja2V0L2V2ZW50cy50cyIsICIuLi9zcmMvbGliL3NvY2tldC9wcmVzZW5jZS50cyIsICIuLi9zcmMvbGliL3JhdGVMaW1pdC50cyIsICIuLi9zcmMvbGliL21vZGVyYXRpb24vbm9ybWFsaXplLnRzIiwgIi4uL3NyYy9saWIvbW9kZXJhdGlvbi9wcm9mYW5pdHkudHMiLCAiLi4vc3JjL3NlcnZlci9tZXNzYWdlcy50cyIsICIuLi9zcmMvc2VydmVyL3NlcmlhbGl6ZS50cyIsICIuLi9zcmMvc2VydmVyL2NvbnZlcnNhdGlvbnMudHMiLCAiLi4vc3JjL2xpYi9zb2NrZXQvaGFuZGxlcnMudHMiLCAiLi4vc3JjL2xpYi9zb2NrZXQvaW8udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCBcImRvdGVudi9jb25maWdcIjtcbmltcG9ydCB7IGNyZWF0ZVNlcnZlciB9IGZyb20gXCJub2RlOmh0dHBcIjtcbmltcG9ydCBuZXh0IGZyb20gXCJuZXh0XCI7XG5pbXBvcnQgeyBTZXJ2ZXIgYXMgSU9TZXJ2ZXIgfSBmcm9tIFwic29ja2V0LmlvXCI7XG5pbXBvcnQgeyBlbnYgfSBmcm9tIFwiLi9zcmMvbGliL2VudlwiO1xuaW1wb3J0IHsgcmVnaXN0ZXJTb2NrZXRIYW5kbGVycyB9IGZyb20gXCIuL3NyYy9saWIvc29ja2V0L2hhbmRsZXJzXCI7XG5pbXBvcnQgeyBzZXRJTywgdHlwZSBUeXBlZFNlcnZlciB9IGZyb20gXCIuL3NyYy9saWIvc29ja2V0L2lvXCI7XG5cbmNvbnN0IGRldiA9IHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSBcInByb2R1Y3Rpb25cIjtcbmNvbnN0IGFwcCA9IG5leHQoeyBkZXYsIGhvc3RuYW1lOiBlbnYuSE9TVE5BTUUsIHBvcnQ6IGVudi5QT1JUIH0pO1xuY29uc3QgaGFuZGxlID0gYXBwLmdldFJlcXVlc3RIYW5kbGVyKCk7XG5cbmFzeW5jIGZ1bmN0aW9uIG1haW4oKSB7XG4gIGF3YWl0IGFwcC5wcmVwYXJlKCk7XG5cbiAgY29uc3Qgc2VydmVyID0gY3JlYXRlU2VydmVyKChyZXEsIHJlcykgPT4ge1xuICAgIGhhbmRsZShyZXEsIHJlcyk7XG4gIH0pO1xuXG4gIGNvbnN0IGlvOiBUeXBlZFNlcnZlciA9IG5ldyBJT1NlcnZlcihzZXJ2ZXIsIHtcbiAgICBwYXRoOiBcIi9zb2NrZXQuaW9cIixcbiAgICBjb3JzOiB7IG9yaWdpbjogZW52LkFQUF9PUklHSU4sIGNyZWRlbnRpYWxzOiB0cnVlIH0sXG4gICAgLy8gc3Vydml2ZSBicmllZiBuZXR3b3JrIGJsaXBzIHdpdGhvdXQgZHJvcHBpbmcgdGhlIHNlc3Npb25cbiAgICBjb25uZWN0aW9uU3RhdGVSZWNvdmVyeToge1xuICAgICAgbWF4RGlzY29ubmVjdGlvbkR1cmF0aW9uOiAyICogNjAgKiAxMDAwLFxuICAgICAgc2tpcE1pZGRsZXdhcmVzOiBmYWxzZSxcbiAgICB9LFxuICB9KTtcblxuICBzZXRJTyhpbyk7XG4gIHJlZ2lzdGVyU29ja2V0SGFuZGxlcnMoaW8pO1xuXG4gIHNlcnZlci5saXN0ZW4oZW52LlBPUlQsICgpID0+IHtcbiAgICBjb25zb2xlLmxvZyhgXFxuICBcdTI1QjggUmVhbHRpbWUgTWVzc2FnaW5nIHJlYWR5IG9uICR7ZW52LkFQUF9PUklHSU59XFxuYCk7XG4gIH0pO1xufVxuXG5tYWluKCkuY2F0Y2goKGVycikgPT4ge1xuICBjb25zb2xlLmVycm9yKGVycik7XG4gIHByb2Nlc3MuZXhpdCgxKTtcbn0pO1xuIiwgIi8qKiBDZW50cmFsaXNlZCwgdmFsaWRhdGVkIGVudmlyb25tZW50IGFjY2Vzcy4gRmFpbHMgZmFzdCBvbiBtaXNjb25maWd1cmF0aW9uLiAqL1xuaW1wb3J0IHsgeiB9IGZyb20gXCJ6b2RcIjtcblxuY29uc3Qgc2NoZW1hID0gei5vYmplY3Qoe1xuICBEQVRBQkFTRV9VUkw6IHouc3RyaW5nKCkubWluKDEpLFxuICBBVVRIX1NFQ1JFVDogei5zdHJpbmcoKS5taW4oMzIsIFwiQVVUSF9TRUNSRVQgbXVzdCBiZSBhdCBsZWFzdCAzMiBjaGFyYWN0ZXJzXCIpLFxuICBBVVRIX0NPT0tJRTogei5zdHJpbmcoKS5kZWZhdWx0KFwicnRtX3Nlc3Npb25cIiksXG4gIFBPUlQ6IHouY29lcmNlLm51bWJlcigpLmRlZmF1bHQoMzAwMCksXG4gIEhPU1ROQU1FOiB6LnN0cmluZygpLmRlZmF1bHQoXCJsb2NhbGhvc3RcIiksXG4gIEFQUF9PUklHSU46IHouc3RyaW5nKCkudXJsKCkuZGVmYXVsdChcImh0dHA6Ly9sb2NhbGhvc3Q6MzAwMFwiKSxcbiAgR0lQSFlfQVBJX0tFWTogei5zdHJpbmcoKS5taW4oMSksXG4gIFNUT1JBR0VfRElSOiB6LnN0cmluZygpLmRlZmF1bHQoXCIuL3N0b3JhZ2VcIiksXG4gIE1BWF9VUExPQURfQllURVM6IHouY29lcmNlLm51bWJlcigpLmRlZmF1bHQoOF8zODhfNjA4KSxcbiAgTlNGV19NT0RFTF9ESVI6IHouc3RyaW5nKCkuZGVmYXVsdChcIi4vcHVibGljL21vZGVscy9uc2Z3XCIpLFxuICBOU0ZXX1RIUkVTSE9MRDogei5jb2VyY2UubnVtYmVyKCkuZGVmYXVsdCgwLjYpLFxufSk7XG5cbmV4cG9ydCBjb25zdCBlbnYgPSBzY2hlbWEucGFyc2UocHJvY2Vzcy5lbnYpO1xuIiwgImltcG9ydCB7IFNpZ25KV1QsIGp3dFZlcmlmeSB9IGZyb20gXCJqb3NlXCI7XG5pbXBvcnQgYmNyeXB0IGZyb20gXCJiY3J5cHRqc1wiO1xuaW1wb3J0IHsgcGFyc2UgYXMgcGFyc2VDb29raWUgfSBmcm9tIFwiY29va2llXCI7XG5pbXBvcnQgeyBlbnYgfSBmcm9tIFwiLi9lbnZcIjtcbmltcG9ydCB7IHByaXNtYSB9IGZyb20gXCIuL3ByaXNtYVwiO1xuXG4vKipcbiAqIEZyYW1ld29yay1hZ25vc3RpYyBhdXRoIHByaW1pdGl2ZXMuIFNhZmUgdG8gaW1wb3J0IGZyb20gdGhlIHN0YW5kYWxvbmVcbiAqIFNvY2tldC5JTyBzZXJ2ZXIgKG5vIGBuZXh0L2hlYWRlcnNgIGRlcGVuZGVuY3kpLlxuICovXG5cbmNvbnN0IHNlY3JldCA9IG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShlbnYuQVVUSF9TRUNSRVQpO1xuZXhwb3J0IGNvbnN0IFNFU1NJT05fTUFYX0FHRSA9IDYwICogNjAgKiAyNCAqIDc7IC8vIDcgZGF5c1xuXG5leHBvcnQgdHlwZSBTZXNzaW9uVXNlciA9IHtcbiAgaWQ6IHN0cmluZztcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgZGlzcGxheU5hbWU6IHN0cmluZztcbiAgYXZhdGFyQ29sb3I6IHN0cmluZztcbn07XG5cbmV4cG9ydCB0eXBlIFNlc3Npb25QYXlsb2FkID0geyBzdWI6IHN0cmluZzsgdXNlcm5hbWU6IHN0cmluZyB9O1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFzaFBhc3N3b3JkKHBsYWluOiBzdHJpbmcpIHtcbiAgcmV0dXJuIGJjcnlwdC5oYXNoKHBsYWluLCAxMCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB2ZXJpZnlQYXNzd29yZChwbGFpbjogc3RyaW5nLCBoYXNoOiBzdHJpbmcpIHtcbiAgcmV0dXJuIGJjcnlwdC5jb21wYXJlKHBsYWluLCBoYXNoKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVNlc3Npb25Ub2tlbihwYXlsb2FkOiBTZXNzaW9uUGF5bG9hZCkge1xuICByZXR1cm4gbmV3IFNpZ25KV1QoeyB1c2VybmFtZTogcGF5bG9hZC51c2VybmFtZSB9KVxuICAgIC5zZXRQcm90ZWN0ZWRIZWFkZXIoeyBhbGc6IFwiSFMyNTZcIiB9KVxuICAgIC5zZXRTdWJqZWN0KHBheWxvYWQuc3ViKVxuICAgIC5zZXRJc3N1ZWRBdCgpXG4gICAgLnNldEV4cGlyYXRpb25UaW1lKGAke1NFU1NJT05fTUFYX0FHRX1zYClcbiAgICAuc2lnbihzZWNyZXQpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5U2Vzc2lvblRva2VuKHRva2VuOiBzdHJpbmcpOiBQcm9taXNlPFNlc3Npb25QYXlsb2FkIHwgbnVsbD4ge1xuICB0cnkge1xuICAgIGNvbnN0IHsgcGF5bG9hZCB9ID0gYXdhaXQgand0VmVyaWZ5KHRva2VuLCBzZWNyZXQpO1xuICAgIGlmICghcGF5bG9hZC5zdWIpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB7IHN1YjogcGF5bG9hZC5zdWIsIHVzZXJuYW1lOiBTdHJpbmcocGF5bG9hZC51c2VybmFtZSA/PyBcIlwiKSB9O1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvbkNvb2tpZU9wdGlvbnMobWF4QWdlID0gU0VTU0lPTl9NQVhfQUdFKSB7XG4gIHJldHVybiB7XG4gICAgaHR0cE9ubHk6IHRydWUsXG4gICAgc2FtZVNpdGU6IFwibGF4XCIgYXMgY29uc3QsXG4gICAgc2VjdXJlOiBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gXCJwcm9kdWN0aW9uXCIsXG4gICAgcGF0aDogXCIvXCIsXG4gICAgbWF4QWdlLFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZFVzZXIoaWQ6IHN0cmluZyk6IFByb21pc2U8U2Vzc2lvblVzZXIgfCBudWxsPiB7XG4gIHJldHVybiBwcmlzbWEudXNlci5maW5kVW5pcXVlKHtcbiAgICB3aGVyZTogeyBpZCB9LFxuICAgIHNlbGVjdDogeyBpZDogdHJ1ZSwgdXNlcm5hbWU6IHRydWUsIGRpc3BsYXlOYW1lOiB0cnVlLCBhdmF0YXJDb2xvcjogdHJ1ZSB9LFxuICB9KTtcbn1cblxuLyoqIFNvY2tldC5JTyBoYW5kc2hha2UgaGVscGVyIFx1MjAxNCBwYXJzZXMgdGhlIHJhdyBDb29raWUgaGVhZGVyLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldFNlc3Npb25Vc2VyRnJvbUNvb2tpZUhlYWRlcihcbiAgY29va2llSGVhZGVyOiBzdHJpbmcgfCB1bmRlZmluZWRcbik6IFByb21pc2U8U2Vzc2lvblVzZXIgfCBudWxsPiB7XG4gIGlmICghY29va2llSGVhZGVyKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdG9rZW4gPSBwYXJzZUNvb2tpZShjb29raWVIZWFkZXIpW2Vudi5BVVRIX0NPT0tJRV07XG4gIGlmICghdG9rZW4pIHJldHVybiBudWxsO1xuICBjb25zdCBwYXlsb2FkID0gYXdhaXQgdmVyaWZ5U2Vzc2lvblRva2VuKHRva2VuKTtcbiAgaWYgKCFwYXlsb2FkKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIGxvYWRVc2VyKHBheWxvYWQuc3ViKTtcbn1cbiIsICJpbXBvcnQgeyBQcmlzbWFDbGllbnQgfSBmcm9tIFwiQHByaXNtYS9jbGllbnRcIjtcblxuY29uc3QgZ2xvYmFsRm9yUHJpc21hID0gZ2xvYmFsVGhpcyBhcyB1bmtub3duIGFzIHsgcHJpc21hPzogUHJpc21hQ2xpZW50IH07XG5cbmV4cG9ydCBjb25zdCBwcmlzbWEgPVxuICBnbG9iYWxGb3JQcmlzbWEucHJpc21hID8/XG4gIG5ldyBQcmlzbWFDbGllbnQoe1xuICAgIGxvZzogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09IFwiZGV2ZWxvcG1lbnRcIiA/IFtcIndhcm5cIiwgXCJlcnJvclwiXSA6IFtcImVycm9yXCJdLFxuICB9KTtcblxuaWYgKHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSBcInByb2R1Y3Rpb25cIikgZ2xvYmFsRm9yUHJpc21hLnByaXNtYSA9IHByaXNtYTtcbiIsICJpbXBvcnQgdHlwZSB7IE1lc3NhZ2VEVE8sIE1lc3NhZ2VLaW5kLCBNZXNzYWdlTWV0YWRhdGEsIFJlYWN0aW9uR3JvdXAgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuLyoqIFdpcmUgY29udHJhY3QgZm9yIHRoZSBTb2NrZXQuSU8gY29ubmVjdGlvbi4gKi9cblxuZXhwb3J0IHR5cGUgU2VuZE1lc3NhZ2VJbnB1dCA9IHtcbiAgY29udmVyc2F0aW9uSWQ6IHN0cmluZztcbiAgY2xpZW50SWQ6IHN0cmluZzsgLy8gaWRlbXBvdGVuY3kga2V5IC8gb3B0aW1pc3RpYyB0ZW1wIGlkXG4gIGtpbmQ6IE1lc3NhZ2VLaW5kO1xuICBib2R5Pzogc3RyaW5nO1xuICBtZXRhZGF0YT86IE1lc3NhZ2VNZXRhZGF0YTtcbiAgcmVwbHlUb0lkPzogc3RyaW5nIHwgbnVsbDtcbn07XG5cbmV4cG9ydCB0eXBlIFNlbmRBY2sgPVxuICB8IHsgb2s6IHRydWU7IG1lc3NhZ2U6IE1lc3NhZ2VEVE8gfVxuICB8IHsgb2s6IGZhbHNlOyBjb2RlOiBcIlJBVEVfTElNSVRFRFwiIHwgXCJQUk9GQU5JVFlcIiB8IFwiRk9SQklEREVOXCIgfCBcIklOVkFMSURcIiB8IFwiRVJST1JcIjsgbWVzc2FnZTogc3RyaW5nOyBtYXRjaGVkPzogc3RyaW5nW10gfTtcblxuZXhwb3J0IHR5cGUgUHJlc2VuY2VQYXlsb2FkID0geyB1c2VySWQ6IHN0cmluZzsgb25saW5lOiBib29sZWFuOyBsYXN0U2Vlbjogc3RyaW5nIH07XG5cbmV4cG9ydCB0eXBlIFR5cGluZ1BheWxvYWQgPSB7IGNvbnZlcnNhdGlvbklkOiBzdHJpbmc7IHVzZXJJZDogc3RyaW5nOyB0eXBpbmc6IGJvb2xlYW4gfTtcblxuZXhwb3J0IHR5cGUgUmVhZFBheWxvYWQgPSB7IGNvbnZlcnNhdGlvbklkOiBzdHJpbmc7IHVzZXJJZDogc3RyaW5nOyByZWFkQXQ6IHN0cmluZzsgbWVzc2FnZUlkczogc3RyaW5nW10gfTtcblxuZXhwb3J0IHR5cGUgUmVhY3Rpb25VcGRhdGUgPSB7XG4gIGNvbnZlcnNhdGlvbklkOiBzdHJpbmc7XG4gIG1lc3NhZ2VJZDogc3RyaW5nO1xuICByZWFjdGlvbnM6IFJlYWN0aW9uR3JvdXBbXTtcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VydmVyVG9DbGllbnRFdmVudHMge1xuICBcIm1lc3NhZ2U6bmV3XCI6IChtc2c6IE1lc3NhZ2VEVE8pID0+IHZvaWQ7XG4gIFwibWVzc2FnZTpzdGF0dXNcIjogKHA6IHsgY29udmVyc2F0aW9uSWQ6IHN0cmluZzsgbWVzc2FnZUlkczogc3RyaW5nW107IHN0YXR1czogXCJERUxJVkVSRURcIiB8IFwiUkVBRFwiOyBieTogc3RyaW5nIH0pID0+IHZvaWQ7XG4gIFwicmVhY3Rpb246dXBkYXRlXCI6IChwOiBSZWFjdGlvblVwZGF0ZSkgPT4gdm9pZDtcbiAgXCJwcmVzZW5jZTp1cGRhdGVcIjogKHA6IFByZXNlbmNlUGF5bG9hZCkgPT4gdm9pZDtcbiAgXCJwcmVzZW5jZTpzbmFwc2hvdFwiOiAocDogeyBvbmxpbmU6IHN0cmluZ1tdIH0pID0+IHZvaWQ7XG4gIFwidHlwaW5nOnVwZGF0ZVwiOiAocDogVHlwaW5nUGF5bG9hZCkgPT4gdm9pZDtcbiAgXCJjb252ZXJzYXRpb246bmV3XCI6IChjb252ZXJzYXRpb25JZDogc3RyaW5nKSA9PiB2b2lkO1xuICBcImVycm9yOnRvYXN0XCI6IChwOiB7IG1lc3NhZ2U6IHN0cmluZyB9KSA9PiB2b2lkO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIENsaWVudFRvU2VydmVyRXZlbnRzIHtcbiAgXCJtZXNzYWdlOnNlbmRcIjogKGlucHV0OiBTZW5kTWVzc2FnZUlucHV0LCBhY2s6IChyZXM6IFNlbmRBY2spID0+IHZvaWQpID0+IHZvaWQ7XG4gIFwibWVzc2FnZTpyZWFkXCI6IChwOiB7IGNvbnZlcnNhdGlvbklkOiBzdHJpbmcgfSwgYWNrPzogKHJlczogeyBvazogYm9vbGVhbiB9KSA9PiB2b2lkKSA9PiB2b2lkO1xuICBcIm1lc3NhZ2U6c3luY1wiOiAocDogeyBjb252ZXJzYXRpb25JZDogc3RyaW5nOyBhZnRlcklkOiBzdHJpbmcgfCBudWxsIH0sIGFjazogKHJlczogeyBtZXNzYWdlczogTWVzc2FnZURUT1tdIH0pID0+IHZvaWQpID0+IHZvaWQ7XG4gIFwicmVhY3Rpb246dG9nZ2xlXCI6IChwOiB7IG1lc3NhZ2VJZDogc3RyaW5nOyBlbW9qaTogc3RyaW5nIH0sIGFjazogKHJlczogeyBvazogYm9vbGVhbjsgbWVzc2FnZT86IHN0cmluZyB9KSA9PiB2b2lkKSA9PiB2b2lkO1xuICBcInR5cGluZzpzdGFydFwiOiAocDogeyBjb252ZXJzYXRpb25JZDogc3RyaW5nIH0pID0+IHZvaWQ7XG4gIFwidHlwaW5nOnN0b3BcIjogKHA6IHsgY29udmVyc2F0aW9uSWQ6IHN0cmluZyB9KSA9PiB2b2lkO1xuICBcInByZXNlbmNlOnBpbmdcIjogKCkgPT4gdm9pZDtcbn1cblxuZXhwb3J0IGNvbnN0IHVzZXJSb29tID0gKHVzZXJJZDogc3RyaW5nKSA9PiBgdXNlcjoke3VzZXJJZH1gO1xuZXhwb3J0IGNvbnN0IGNvbnZlcnNhdGlvblJvb20gPSAoY29udmVyc2F0aW9uSWQ6IHN0cmluZykgPT4gYGNvbnZlcnNhdGlvbjoke2NvbnZlcnNhdGlvbklkfWA7XG4iLCAiLyoqXG4gKiBJbi1wcm9jZXNzIHByZXNlbmNlIHRyYWNraW5nLiB1c2VySWQgLT4gc2V0IG9mIGxpdmUgc29ja2V0IGlkcy5cbiAqIE11bHRpLXRhYiBzYWZlOiBhIHVzZXIgaXMgXCJvbmxpbmVcIiB3aGlsZSBhdCBsZWFzdCBvbmUgc29ja2V0IGlzIGNvbm5lY3RlZC5cbiAqL1xuY29uc3Qgc29ja2V0cyA9IG5ldyBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj4oKTtcbmNvbnN0IGxhc3RTZWVuID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGFkZFNvY2tldCh1c2VySWQ6IHN0cmluZywgc29ja2V0SWQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBzZXQgPSBzb2NrZXRzLmdldCh1c2VySWQpID8/IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCB3YXNPZmZsaW5lID0gc2V0LnNpemUgPT09IDA7XG4gIHNldC5hZGQoc29ja2V0SWQpO1xuICBzb2NrZXRzLnNldCh1c2VySWQsIHNldCk7XG4gIHJldHVybiB3YXNPZmZsaW5lO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlU29ja2V0KHVzZXJJZDogc3RyaW5nLCBzb2NrZXRJZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGNvbnN0IHNldCA9IHNvY2tldHMuZ2V0KHVzZXJJZCk7XG4gIGlmICghc2V0KSByZXR1cm4gZmFsc2U7XG4gIHNldC5kZWxldGUoc29ja2V0SWQpO1xuICBpZiAoc2V0LnNpemUgPT09IDApIHtcbiAgICBzb2NrZXRzLmRlbGV0ZSh1c2VySWQpO1xuICAgIGxhc3RTZWVuLnNldCh1c2VySWQsIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSk7XG4gICAgcmV0dXJuIHRydWU7IC8vIGJlY2FtZSBvZmZsaW5lXG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNPbmxpbmUodXNlcklkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIChzb2NrZXRzLmdldCh1c2VySWQpPy5zaXplID8/IDApID4gMDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG9ubGluZVVzZXJJZHMoKTogc3RyaW5nW10ge1xuICByZXR1cm4gWy4uLnNvY2tldHMua2V5cygpXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldExhc3RTZWVuKHVzZXJJZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGxhc3RTZWVuLmdldCh1c2VySWQpID8/IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbn1cbiIsICIvKipcbiAqIEluLW1lbW9yeSBzbGlkaW5nLXdpbmRvdyByYXRlIGxpbWl0ZXIuXG4gKlxuICogU3VmZmljaWVudCBmb3IgYSBzaW5nbGUtbm9kZSBkZXBsb3ltZW50ICh0aGlzIGFzc2lnbm1lbnQpLiBGb3IgYSBob3Jpem9udGFsbHlcbiAqIHNjYWxlZCBkZXBsb3ltZW50LCBzd2FwIHRoZSBNYXAgZm9yIFJlZGlzIChJTkNSICsgRVhQSVJFKSBcdTIwMTQgdGhlIGNhbGwgc2l0ZXMgYW5kXG4gKiB0aGUgYFJhdGVMaW1pdFJlc3VsdGAgY29udHJhY3Qgc3RheSBpZGVudGljYWwuXG4gKi9cbnR5cGUgQnVja2V0ID0geyBjb3VudDogbnVtYmVyOyByZXNldEF0OiBudW1iZXIgfTtcblxuY29uc3QgYnVja2V0cyA9IG5ldyBNYXA8c3RyaW5nLCBCdWNrZXQ+KCk7XG5cbmV4cG9ydCB0eXBlIFJhdGVMaW1pdFJlc3VsdCA9IHtcbiAgb2s6IGJvb2xlYW47XG4gIHJlbWFpbmluZzogbnVtYmVyO1xuICByZXRyeUFmdGVyTXM6IG51bWJlcjtcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiByYXRlTGltaXQoa2V5OiBzdHJpbmcsIGxpbWl0OiBudW1iZXIsIHdpbmRvd01zOiBudW1iZXIpOiBSYXRlTGltaXRSZXN1bHQge1xuICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICBjb25zdCBleGlzdGluZyA9IGJ1Y2tldHMuZ2V0KGtleSk7XG5cbiAgaWYgKCFleGlzdGluZyB8fCBleGlzdGluZy5yZXNldEF0IDw9IG5vdykge1xuICAgIGJ1Y2tldHMuc2V0KGtleSwgeyBjb3VudDogMSwgcmVzZXRBdDogbm93ICsgd2luZG93TXMgfSk7XG4gICAgcmV0dXJuIHsgb2s6IHRydWUsIHJlbWFpbmluZzogbGltaXQgLSAxLCByZXRyeUFmdGVyTXM6IDAgfTtcbiAgfVxuXG4gIGlmIChleGlzdGluZy5jb3VudCA+PSBsaW1pdCkge1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgcmVtYWluaW5nOiAwLCByZXRyeUFmdGVyTXM6IGV4aXN0aW5nLnJlc2V0QXQgLSBub3cgfTtcbiAgfVxuXG4gIGV4aXN0aW5nLmNvdW50ICs9IDE7XG4gIHJldHVybiB7IG9rOiB0cnVlLCByZW1haW5pbmc6IGxpbWl0IC0gZXhpc3RpbmcuY291bnQsIHJldHJ5QWZ0ZXJNczogMCB9O1xufVxuXG4vLyBPcHBvcnR1bmlzdGljIGNsZWFudXAgc28gdGhlIE1hcCBjYW5ub3QgZ3JvdyB1bmJvdW5kZWQuXG5zZXRJbnRlcnZhbCgoKSA9PiB7XG4gIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gIGZvciAoY29uc3QgW2tleSwgYnVja2V0XSBvZiBidWNrZXRzKSB7XG4gICAgaWYgKGJ1Y2tldC5yZXNldEF0IDw9IG5vdykgYnVja2V0cy5kZWxldGUoa2V5KTtcbiAgfVxufSwgNjBfMDAwKS51bnJlZj8uKCk7XG5cbmV4cG9ydCBjb25zdCBSQVRFX0xJTUlUUyA9IHtcbiAgc2VuZDogeyBsaW1pdDogMzAsIHdpbmRvd01zOiAxMF8wMDAgfSxcbiAgdXBsb2FkOiB7IGxpbWl0OiAxMCwgd2luZG93TXM6IDYwXzAwMCB9LFxuICBhdXRoOiB7IGxpbWl0OiAxMCwgd2luZG93TXM6IDYwXzAwMCB9LFxuICBnaXBoeTogeyBsaW1pdDogNjAsIHdpbmRvd01zOiA2MF8wMDAgfSxcbiAgY29udmVyc2F0aW9uQ3JlYXRlOiB7IGxpbWl0OiAyMCwgd2luZG93TXM6IDYwXzAwMCB9LFxuICByZWFjdGlvbjogeyBsaW1pdDogNDAsIHdpbmRvd01zOiAxMF8wMDAgfSxcbn0gYXMgY29uc3Q7XG4iLCAiLyoqXG4gKiBUZXh0IG5vcm1hbGlzYXRpb24gZm9yIHByb2Zhbml0eSBtYXRjaGluZy5cbiAqXG4gKiBEZWZlYXRzIHRoZSBjb21tb24sIFwic3RyYWlnaHRmb3J3YXJkXCIgZXZhc2lvbiB0ZWNobmlxdWVzIGNhbGxlZCBvdXQgaW4gdGhlXG4gKiBicmllZjogY2FzaW5nLCBwYWRkaW5nIHdoaXRlc3BhY2UvcHVuY3R1YXRpb24gYmV0d2VlbiBsZXR0ZXJzLCByZXBlYXRlZFxuICogbGV0dGVycywgYW5kIGxlZXRzcGVhayAvIGhvbW9nbHlwaCBjaGFyYWN0ZXIgc3Vic3RpdHV0aW9uLlxuICovXG5cbmNvbnN0IENPTUJJTklOR19NQVJLUyA9IC9bXHUwMzAwLVx1MDM2Rl0vZztcblxuY29uc3QgTEVFVF9NQVA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gIFwiMFwiOiBcIm9cIixcbiAgXCIxXCI6IFwiaVwiLFxuICBcIiFcIjogXCJpXCIsXG4gIFwifFwiOiBcImlcIixcbiAgXCIzXCI6IFwiZVwiLFxuICBcIjRcIjogXCJhXCIsXG4gIFwiQFwiOiBcImFcIixcbiAgXCI1XCI6IFwic1wiLFxuICBcIiRcIjogXCJzXCIsXG4gIFwiN1wiOiBcInRcIixcbiAgXCI4XCI6IFwiYlwiLFxuICBcIjlcIjogXCJnXCIsXG4gIFwiK1wiOiBcInRcIixcbiAgXCIoXCI6IFwiY1wiLFxufTtcblxuY29uc3QgSE9NT0dMWVBIUzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgXCJcdTA0MzBcIjogXCJhXCIsIC8vIEN5cmlsbGljIFx1MDQzMFxuICBcIlx1MDQzNVwiOiBcImVcIiwgLy8gXHUwNDM1XG4gIFwiXHUwNDNFXCI6IFwib1wiLCAvLyBcdTA0M0VcbiAgXCJcdTA0NDBcIjogXCJwXCIsIC8vIFx1MDQ0MFxuICBcIlx1MDQ0MVwiOiBcImNcIiwgLy8gXHUwNDQxXG4gIFwiXHUwNDQ1XCI6IFwieFwiLCAvLyBcdTA0NDVcbiAgXCJcdTA0NDNcIjogXCJ5XCIsIC8vIFx1MDQ0M1xuICBcIlx1MDQ1NlwiOiBcImlcIiwgLy8gXHUwNDU2XG4gIFwiXHUwNDU1XCI6IFwic1wiLCAvLyBcdTA0NTVcbn07XG5cbmZ1bmN0aW9uIHN1YnN0KGNoOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gSE9NT0dMWVBIU1tjaF0gPz8gTEVFVF9NQVBbY2hdID8/IGNoO1xufVxuXG4vKiogQ29sbGFwc2UgYSB0b2tlbiB0byBpdHMgYmFyZSBhbHBoYWJldGljIHNrZWxldG9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVRva2VuKHJhdzogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IHMgPSByYXcudG9Mb3dlckNhc2UoKS5ub3JtYWxpemUoXCJORktEXCIpLnJlcGxhY2UoQ09NQklOSU5HX01BUktTLCBcIlwiKTtcbiAgcyA9IHMuc3BsaXQoXCJcIikubWFwKHN1YnN0KS5qb2luKFwiXCIpO1xuICBzID0gcy5yZXBsYWNlKC9bXmEtel0vZywgXCJcIik7XG4gIC8vIGNvbGxhcHNlIDMrIHJlcGVhdHMgdG8gYSBzaW5nbGUgY2hhciAoXCJmdXV1dWNrXCIgLT4gXCJmdWNrXCIpXG4gIHMgPSBzLnJlcGxhY2UoLyguKVxcMXsyLH0vZywgXCIkMVwiKTtcbiAgcmV0dXJuIHM7XG59XG5cbi8qKlxuICogRnVsbHkgY29sbGFwc2VkLCBsZXR0ZXJzLW9ubHkgcmVwcmVzZW50YXRpb24gb2YgdGhlIHdob2xlIG1lc3NhZ2Ugc28gdGhhdFxuICogc3BhY2VkLW91dCBwcm9mYW5pdHkgKFwiZiB1IGMga1wiLCBcInMtaC1pLXRcIikgaXMgc3RpbGwgY2F1Z2h0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29sbGFwc2VNZXNzYWdlKHRleHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB0ZXh0XG4gICAgLnRvTG93ZXJDYXNlKClcbiAgICAubm9ybWFsaXplKFwiTkZLRFwiKVxuICAgIC5yZXBsYWNlKENPTUJJTklOR19NQVJLUywgXCJcIilcbiAgICAuc3BsaXQoXCJcIilcbiAgICAubWFwKHN1YnN0KVxuICAgIC5qb2luKFwiXCIpXG4gICAgLnJlcGxhY2UoL1teYS16XS9nLCBcIlwiKVxuICAgIC5yZXBsYWNlKC8oLilcXDF7Mix9L2csIFwiJDFcIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b2tlbml6ZSh0ZXh0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiB0ZXh0LnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pO1xufVxuIiwgIi8qKlxuICogU2VydmVyLXNpZGUgcHJvZmFuaXR5IG1vZGVyYXRpb24uXG4gKlxuICogUGlwZWxpbmU6XG4gKiAgIDEuIHRva2VuaXNlIHRoZSBtZXNzYWdlIGFuZCBub3JtYWxpc2UgZWFjaCB0b2tlbiAoY2FzaW5nLCBsZWV0LCByZXBlYXRzKS5cbiAqICAgMi4gZXhhY3QtbWF0Y2ggZWFjaCBub3JtYWxpc2VkIHRva2VuIGFnYWluc3QgdGhlIGJsb2NrbGlzdC5cbiAqICAgMy4gYnVpbGQgYSB3aG9sZS1tZXNzYWdlIGNvbGxhcHNlZCBza2VsZXRvbiBhbmQgc2NhbiBpdCBmb3IgYW55IGJsb2NrZWRcbiAqICAgICAgdGVybSBhcyBhIHN1YnN0cmluZyBcdTIwMTQgdGhpcyBjYXRjaGVzIHNwYWNlZC1vdXQgKFwiZiB1IGMga1wiKSBhbmQgZ2x1ZWRcbiAqICAgICAgKFwiZ29mdWNreW91cnNlbGZcIikgZXZhc2lvbi5cbiAqXG4gKiBBbGxvd2xpc3RlZCB0ZXJtcyAoZS5nLiBcImNsYXNzXCIsIFwiYXNzaWdubWVudFwiLCBcInNjdW50aG9ycGVcIikgYXJlIHByb3RlY3RlZFxuICogZnJvbSB0aGUgc3Vic3RyaW5nIHBhc3Mgc28gd2UgZG8gbm90IG92ZXItYmxvY2suXG4gKi9cbmltcG9ydCB7IGNvbGxhcHNlTWVzc2FnZSwgbm9ybWFsaXplVG9rZW4sIHRva2VuaXplIH0gZnJvbSBcIi4vbm9ybWFsaXplXCI7XG5cbi8vIENvcmUgRW5nbGlzaCBwcm9mYW5pdHkgcm9vdHMuIEtlcHQgZGVsaWJlcmF0ZWx5IHNtYWxsIGFuZCByZWFkYWJsZTsgZXh0ZW5kIGFzXG4vLyBwb2xpY3kgcmVxdWlyZXMuIE1hdGNoaW5nIGlzIGRvbmUgb24gdGhlICpub3JtYWxpc2VkKiBmb3JtIHNvIG9ubHkgdGhlXG4vLyBza2VsZXRvbiBuZWVkcyB0byBiZSBsaXN0ZWQuXG5jb25zdCBCTE9DS0xJU1QgPSBbXG4gIFwiZnVja1wiLFxuICBcInNoaXRcIixcbiAgXCJiaXRjaFwiLFxuICBcImFzc2hvbGVcIixcbiAgXCJiYXN0YXJkXCIsXG4gIFwiZGlja1wiLFxuICBcInBpc3NcIixcbiAgXCJjdW50XCIsXG4gIFwic2x1dFwiLFxuICBcIndob3JlXCIsXG4gIFwibmlnZ2VyXCIsXG4gIFwiZmFnZ290XCIsXG4gIFwicmV0YXJkXCIsXG4gIFwibW90aGVyZnVja2VyXCIsXG4gIFwiY29ja3N1Y2tlclwiLFxuICBcIndhbmtlclwiLFxuICBcImJvbGxvY2tzXCIsXG4gIFwidHdhdFwiLFxuICBcInByaWNrXCIsXG5dO1xuXG4vLyBXb3JkcyB0aGF0IGxlZ2l0aW1hdGVseSBjb250YWluIGEgYmxvY2tlZCBzdWJzdHJpbmcuXG5jb25zdCBBTExPV0xJU1QgPSBuZXcgU2V0KFtcbiAgXCJjbGFzc1wiLFxuICBcImNsYXNzaWNcIixcbiAgXCJhc3NpZ25tZW50XCIsXG4gIFwiYXNzZXNzXCIsXG4gIFwiYXNzYXNzaW5cIixcbiAgXCJhc3Npc3RcIixcbiAgXCJhc3N1bXB0aW9uXCIsXG4gIFwicGFzc1wiLFxuICBcInBhc3NhZ2VcIixcbiAgXCJtYXNzXCIsXG4gIFwiZ3Jhc3NcIixcbiAgXCJicmFzc1wiLFxuICBcImdsYXNzXCIsXG4gIFwiY29tcGFzc1wiLFxuICBcImVtYmFzc3lcIixcbiAgXCJzY3VudGhvcnBlXCIsXG4gIFwiZGlja2Vuc1wiLFxuICBcInNoaXRha2VcIiwgLy8gcmFyZSBidXQgaGFybWxlc3NcbiAgXCJjb2NrcGl0XCIsXG4gIFwiY29ja3RhaWxcIixcbiAgXCJzaHV0dGxlY29ja1wiLFxuICBcImFuYWx5c2lzXCIsXG4gIFwiYW5hbHlzdFwiLFxuICBcImNhbmFsXCIsXG5dKTtcblxuZXhwb3J0IHR5cGUgUHJvZmFuaXR5UmVzdWx0ID1cbiAgfCB7IGNsZWFuOiB0cnVlIH1cbiAgfCB7IGNsZWFuOiBmYWxzZTsgbWF0Y2hlZDogc3RyaW5nW10gfTtcblxuZXhwb3J0IGZ1bmN0aW9uIGNoZWNrUHJvZmFuaXR5KHRleHQ6IHN0cmluZyk6IFByb2Zhbml0eVJlc3VsdCB7XG4gIGNvbnN0IG1hdGNoZWQgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAvLyBQYXNzIDEgXHUyMDE0IHBlci10b2tlbiBleGFjdCBtYXRjaCBvbiB0aGUgbm9ybWFsaXNlZCBza2VsZXRvbi5cbiAgZm9yIChjb25zdCB0b2tlbiBvZiB0b2tlbml6ZSh0ZXh0KSkge1xuICAgIGNvbnN0IG5vcm0gPSBub3JtYWxpemVUb2tlbih0b2tlbik7XG4gICAgaWYgKCFub3JtIHx8IEFMTE9XTElTVC5oYXMobm9ybSkpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgYmFkIG9mIEJMT0NLTElTVCkge1xuICAgICAgaWYgKG5vcm0gPT09IGJhZCkgbWF0Y2hlZC5hZGQoYmFkKTtcbiAgICB9XG4gIH1cblxuICAvLyBQYXNzIDIgXHUyMDE0IHdob2xlLW1lc3NhZ2UgY29sbGFwc2VkIHNrZWxldG9uLCBzdWJzdHJpbmcgc2Nhbi5cbiAgY29uc3QgY29sbGFwc2VkID0gY29sbGFwc2VNZXNzYWdlKHRleHQpO1xuICBpZiAoY29sbGFwc2VkLmxlbmd0aCA8PSAyMDApIHtcbiAgICBmb3IgKGNvbnN0IGJhZCBvZiBCTE9DS0xJU1QpIHtcbiAgICAgIGlmICghY29sbGFwc2VkLmluY2x1ZGVzKGJhZCkpIGNvbnRpbnVlO1xuICAgICAgLy8gZ3VhcmQgYWdhaW5zdCBhbGxvd2xpc3RlZCB3b3JkcyBwcm9kdWNpbmcgdGhlIHN1YnN0cmluZ1xuICAgICAgY29uc3QgZnJvbUFsbG93ZWQgPSBbLi4uQUxMT1dMSVNUXS5zb21lKFxuICAgICAgICAodykgPT4gdy5pbmNsdWRlcyhiYWQpICYmIGNvbGxhcHNlZC5pbmNsdWRlcyh3KVxuICAgICAgKTtcbiAgICAgIGlmICghZnJvbUFsbG93ZWQpIG1hdGNoZWQuYWRkKGJhZCk7XG4gICAgfVxuICB9XG5cbiAgaWYgKG1hdGNoZWQuc2l6ZSA9PT0gMCkgcmV0dXJuIHsgY2xlYW46IHRydWUgfTtcbiAgcmV0dXJuIHsgY2xlYW46IGZhbHNlLCBtYXRjaGVkOiBbLi4ubWF0Y2hlZF0gfTtcbn1cbiIsICJpbXBvcnQgeyBQcmlzbWEgfSBmcm9tIFwiQHByaXNtYS9jbGllbnRcIjtcbmltcG9ydCB7IHByaXNtYSB9IGZyb20gXCJAL2xpYi9wcmlzbWFcIjtcbmltcG9ydCB0eXBlIHtcbiAgTWVzc2FnZURUTyxcbiAgTWVzc2FnZUtpbmQsXG4gIE1lc3NhZ2VNZXRhZGF0YSxcbiAgTWVzc2FnZVBhZ2UsXG4gIFJlYWN0aW9uR3JvdXAsXG59IGZyb20gXCJAL2xpYi90eXBlc1wiO1xuaW1wb3J0IHsgbWVzc2FnZUluY2x1ZGUsIHRvTWVzc2FnZURUTyB9IGZyb20gXCIuL3NlcmlhbGl6ZVwiO1xuaW1wb3J0IHsgaXNNZW1iZXIgfSBmcm9tIFwiLi9jb252ZXJzYXRpb25zXCI7XG5cbmNvbnN0IFBBR0VfU0laRSA9IDMwO1xuXG5leHBvcnQgY2xhc3MgTWVzc2FnZUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihwdWJsaWMgY29kZTogXCJGT1JCSURERU5cIiB8IFwiSU5WQUxJRFwiIHwgXCJOT1RfRk9VTkRcIiwgbWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gIH1cbn1cblxudHlwZSBDcmVhdGVJbnB1dCA9IHtcbiAgY29udmVyc2F0aW9uSWQ6IHN0cmluZztcbiAgc2VuZGVySWQ6IHN0cmluZztcbiAgY2xpZW50SWQ6IHN0cmluZztcbiAga2luZDogTWVzc2FnZUtpbmQ7XG4gIGJvZHk/OiBzdHJpbmc7XG4gIG1ldGFkYXRhPzogTWVzc2FnZU1ldGFkYXRhO1xuICByZXBseVRvSWQ/OiBzdHJpbmcgfCBudWxsO1xufTtcblxuY29uc3QgUkVBQ1RJT05fRU1PSkkgPSBbXCJcdUQ4M0RcdURDNERcIiwgXCJcdTI3NjRcdUZFMEZcIiwgXCJcdUQ4M0RcdURFMDJcIiwgXCJcdUQ4M0RcdURFMkVcIiwgXCJcdUQ4M0RcdURFMjJcIiwgXCJcdUQ4M0RcdURFNEZcIiwgXCJcdUQ4M0RcdUREMjVcIiwgXCJcdUQ4M0NcdURGODlcIl07XG5cbi8qKlxuICogSWRlbXBvdGVudCBtZXNzYWdlIGNyZWF0ZS4gVGhlIHVuaXF1ZSAoY29udmVyc2F0aW9uSWQsIGNsaWVudElkKSBjb25zdHJhaW50XG4gKiBtZWFucyBhIHJldHJ5IC8gcmVjb25uZWN0IHJlc2VuZCByZXR1cm5zIHRoZSBhbHJlYWR5LXN0b3JlZCByb3cgaW5zdGVhZCBvZlxuICogaW5zZXJ0aW5nIGEgZHVwbGljYXRlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlTWVzc2FnZShpbnB1dDogQ3JlYXRlSW5wdXQpOiBQcm9taXNlPHsgbWVzc2FnZTogTWVzc2FnZURUTzsgY3JlYXRlZDogYm9vbGVhbiB9PiB7XG4gIGlmICghKGF3YWl0IGlzTWVtYmVyKGlucHV0LmNvbnZlcnNhdGlvbklkLCBpbnB1dC5zZW5kZXJJZCkpKSB7XG4gICAgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIkZPUkJJRERFTlwiLCBcIllvdSBhcmUgbm90IGEgbWVtYmVyIG9mIHRoaXMgY29udmVyc2F0aW9uLlwiKTtcbiAgfVxuXG4gIGNvbnN0IGJvZHkgPSAoaW5wdXQuYm9keSA/PyBcIlwiKS50cmltKCk7XG4gIGlmIChpbnB1dC5raW5kID09PSBcIlRFWFRcIiAmJiAhYm9keSkge1xuICAgIHRocm93IG5ldyBNZXNzYWdlRXJyb3IoXCJJTlZBTElEXCIsIFwiTWVzc2FnZSBjYW5ub3QgYmUgZW1wdHkuXCIpO1xuICB9XG4gIGlmIChpbnB1dC5raW5kID09PSBcIlRFWFRcIiAmJiBib2R5Lmxlbmd0aCA+IDQwMDApIHtcbiAgICB0aHJvdyBuZXcgTWVzc2FnZUVycm9yKFwiSU5WQUxJRFwiLCBcIk1lc3NhZ2UgaXMgdG9vIGxvbmcuXCIpO1xuICB9XG4gIGlmICgoaW5wdXQua2luZCA9PT0gXCJHSUZcIiB8fCBpbnB1dC5raW5kID09PSBcIlNUSUNLRVJcIiB8fCBpbnB1dC5raW5kID09PSBcIklNQUdFXCIpICYmICFpbnB1dC5tZXRhZGF0YT8udXJsKSB7XG4gICAgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIklOVkFMSURcIiwgXCJNaXNzaW5nIG1lZGlhIHJlZmVyZW5jZS5cIik7XG4gIH1cblxuICAvLyBhIHJlcGx5IHRhcmdldCBtdXN0IGV4aXN0IGFuZCBsaXZlIGluIHRoZSBzYW1lIGNvbnZlcnNhdGlvblxuICBpZiAoaW5wdXQucmVwbHlUb0lkKSB7XG4gICAgY29uc3QgcGFyZW50ID0gYXdhaXQgcHJpc21hLm1lc3NhZ2UuZmluZFVuaXF1ZSh7XG4gICAgICB3aGVyZTogeyBpZDogaW5wdXQucmVwbHlUb0lkIH0sXG4gICAgICBzZWxlY3Q6IHsgY29udmVyc2F0aW9uSWQ6IHRydWUgfSxcbiAgICB9KTtcbiAgICBpZiAoIXBhcmVudCB8fCBwYXJlbnQuY29udmVyc2F0aW9uSWQgIT09IGlucHV0LmNvbnZlcnNhdGlvbklkKSB7XG4gICAgICB0aHJvdyBuZXcgTWVzc2FnZUVycm9yKFwiSU5WQUxJRFwiLCBcIlRoZSBtZXNzYWdlIHlvdSdyZSByZXBseWluZyB0byBubyBsb25nZXIgZXhpc3RzLlwiKTtcbiAgICB9XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSBhd2FpdCBwcmlzbWEuJHRyYW5zYWN0aW9uKGFzeW5jICh0eCkgPT4ge1xuICAgICAgY29uc3QgY3JlYXRlZCA9IGF3YWl0IHR4Lm1lc3NhZ2UuY3JlYXRlKHtcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGNvbnZlcnNhdGlvbklkOiBpbnB1dC5jb252ZXJzYXRpb25JZCxcbiAgICAgICAgICBzZW5kZXJJZDogaW5wdXQuc2VuZGVySWQsXG4gICAgICAgICAgY2xpZW50SWQ6IGlucHV0LmNsaWVudElkLFxuICAgICAgICAgIGtpbmQ6IGlucHV0LmtpbmQsXG4gICAgICAgICAgYm9keSxcbiAgICAgICAgICBtZXRhZGF0YTogKGlucHV0Lm1ldGFkYXRhID8/IFByaXNtYS5Kc29uTnVsbCkgYXMgUHJpc21hLklucHV0SnNvblZhbHVlLFxuICAgICAgICAgIHN0YXR1czogXCJTRU5UXCIsXG4gICAgICAgICAgcmVwbHlUb0lkOiBpbnB1dC5yZXBseVRvSWQgPz8gbnVsbCxcbiAgICAgICAgfSxcbiAgICAgICAgaW5jbHVkZTogbWVzc2FnZUluY2x1ZGUsXG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHR4LmNvbnZlcnNhdGlvbi51cGRhdGUoe1xuICAgICAgICB3aGVyZTogeyBpZDogaW5wdXQuY29udmVyc2F0aW9uSWQgfSxcbiAgICAgICAgZGF0YTogeyB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkgfSxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGNyZWF0ZWQ7XG4gICAgfSk7XG4gICAgcmV0dXJuIHsgbWVzc2FnZTogdG9NZXNzYWdlRFRPKG1lc3NhZ2UpLCBjcmVhdGVkOiB0cnVlIH07XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBQcmlzbWEuUHJpc21hQ2xpZW50S25vd25SZXF1ZXN0RXJyb3IgJiYgZXJyLmNvZGUgPT09IFwiUDIwMDJcIikge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBwcmlzbWEubWVzc2FnZS5maW5kVW5pcXVlKHtcbiAgICAgICAgd2hlcmU6IHtcbiAgICAgICAgICBjb252ZXJzYXRpb25JZF9jbGllbnRJZDoge1xuICAgICAgICAgICAgY29udmVyc2F0aW9uSWQ6IGlucHV0LmNvbnZlcnNhdGlvbklkLFxuICAgICAgICAgICAgY2xpZW50SWQ6IGlucHV0LmNsaWVudElkLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGluY2x1ZGU6IG1lc3NhZ2VJbmNsdWRlLFxuICAgICAgfSk7XG4gICAgICBpZiAoZXhpc3RpbmcpIHJldHVybiB7IG1lc3NhZ2U6IHRvTWVzc2FnZURUTyhleGlzdGluZyksIGNyZWF0ZWQ6IGZhbHNlIH07XG4gICAgfVxuICAgIHRocm93IGVycjtcbiAgfVxufVxuXG4vKipcbiAqIEN1cnNvci1iYXNlZCBwYWdpbmF0aW9uLiBMb2FkcyB0aGUgbmV3ZXN0IGBQQUdFX1NJWkVgIG1lc3NhZ2VzLCB0aGVuIG9sZGVyXG4gKiBwYWdlcyBhcyB0aGUgY2xpZW50IHNjcm9sbHMgdXAuIEN1cnNvciBpcyB0aGUgbWVzc2FnZSBpZDsgb3JkZXJpbmcgaXMgb24gdGhlXG4gKiBjb21wb3NpdGUgaW5kZXggKGNvbnZlcnNhdGlvbklkLCBjcmVhdGVkQXQsIGlkKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldE1lc3NhZ2VzKFxuICBjb252ZXJzYXRpb25JZDogc3RyaW5nLFxuICB1c2VySWQ6IHN0cmluZyxcbiAgY3Vyc29yPzogc3RyaW5nIHwgbnVsbFxuKTogUHJvbWlzZTxNZXNzYWdlUGFnZT4ge1xuICBpZiAoIShhd2FpdCBpc01lbWJlcihjb252ZXJzYXRpb25JZCwgdXNlcklkKSkpIHtcbiAgICB0aHJvdyBuZXcgTWVzc2FnZUVycm9yKFwiRk9SQklEREVOXCIsIFwiWW91IGFyZSBub3QgYSBtZW1iZXIgb2YgdGhpcyBjb252ZXJzYXRpb24uXCIpO1xuICB9XG5cbiAgY29uc3Qgcm93cyA9IGF3YWl0IHByaXNtYS5tZXNzYWdlLmZpbmRNYW55KHtcbiAgICB3aGVyZTogeyBjb252ZXJzYXRpb25JZCB9LFxuICAgIG9yZGVyQnk6IFt7IGNyZWF0ZWRBdDogXCJkZXNjXCIgfSwgeyBpZDogXCJkZXNjXCIgfV0sXG4gICAgdGFrZTogUEFHRV9TSVpFICsgMSxcbiAgICAuLi4oY3Vyc29yID8geyBjdXJzb3I6IHsgaWQ6IGN1cnNvciB9LCBza2lwOiAxIH0gOiB7fSksXG4gICAgaW5jbHVkZTogbWVzc2FnZUluY2x1ZGUsXG4gIH0pO1xuXG4gIGNvbnN0IGhhc01vcmUgPSByb3dzLmxlbmd0aCA+IFBBR0VfU0laRTtcbiAgY29uc3QgcGFnZSA9IGhhc01vcmUgPyByb3dzLnNsaWNlKDAsIFBBR0VfU0laRSkgOiByb3dzO1xuXG4gIHJldHVybiB7XG4gICAgLy8gcmV0dXJuIGluIGFzY2VuZGluZyAoY2hyb25vbG9naWNhbCkgb3JkZXIgZm9yIHJlbmRlcmluZ1xuICAgIG1lc3NhZ2VzOiBwYWdlLnJldmVyc2UoKS5tYXAodG9NZXNzYWdlRFRPKSxcbiAgICBuZXh0Q3Vyc29yOiBoYXNNb3JlID8gcGFnZVswXS5pZCA6IG51bGwsXG4gICAgaGFzTW9yZSxcbiAgfTtcbn1cblxuLyoqIE1lc3NhZ2VzIGNyZWF0ZWQgYWZ0ZXIgYSBnaXZlbiBpZCBcdTIwMTQgdXNlZCB0byByZWNvbmNpbGUgYWZ0ZXIgYSByZWNvbm5lY3QuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0TWVzc2FnZXNBZnRlcihcbiAgY29udmVyc2F0aW9uSWQ6IHN0cmluZyxcbiAgdXNlcklkOiBzdHJpbmcsXG4gIGFmdGVySWQ6IHN0cmluZyB8IG51bGxcbik6IFByb21pc2U8TWVzc2FnZURUT1tdPiB7XG4gIGlmICghKGF3YWl0IGlzTWVtYmVyKGNvbnZlcnNhdGlvbklkLCB1c2VySWQpKSkge1xuICAgIHRocm93IG5ldyBNZXNzYWdlRXJyb3IoXCJGT1JCSURERU5cIiwgXCJOb3QgYSBtZW1iZXIuXCIpO1xuICB9XG4gIGxldCBhZnRlcjogRGF0ZSB8IG51bGwgPSBudWxsO1xuICBpZiAoYWZ0ZXJJZCkge1xuICAgIGNvbnN0IGFuY2hvciA9IGF3YWl0IHByaXNtYS5tZXNzYWdlLmZpbmRVbmlxdWUoeyB3aGVyZTogeyBpZDogYWZ0ZXJJZCB9LCBzZWxlY3Q6IHsgY3JlYXRlZEF0OiB0cnVlIH0gfSk7XG4gICAgYWZ0ZXIgPSBhbmNob3I/LmNyZWF0ZWRBdCA/PyBudWxsO1xuICB9XG4gIGNvbnN0IHJvd3MgPSBhd2FpdCBwcmlzbWEubWVzc2FnZS5maW5kTWFueSh7XG4gICAgd2hlcmU6IHsgY29udmVyc2F0aW9uSWQsIC4uLihhZnRlciA/IHsgY3JlYXRlZEF0OiB7IGd0OiBhZnRlciB9IH0gOiB7fSkgfSxcbiAgICBvcmRlckJ5OiBbeyBjcmVhdGVkQXQ6IFwiYXNjXCIgfSwgeyBpZDogXCJhc2NcIiB9XSxcbiAgICB0YWtlOiAyMDAsXG4gICAgaW5jbHVkZTogbWVzc2FnZUluY2x1ZGUsXG4gIH0pO1xuICByZXR1cm4gcm93cy5tYXAodG9NZXNzYWdlRFRPKTtcbn1cblxuLyoqXG4gKiBNYXJrcyBldmVyeSB1bnJlYWQgbWVzc2FnZSBmcm9tIG90aGVyIHBlb3BsZSBhcyByZWFkIGZvciBgdXNlcklkYC5cbiAqIFJldHVybnMgdGhlIGFmZmVjdGVkIG1lc3NhZ2UgaWRzIChmb3IgYSByZWFsLXRpbWUgcmVjZWlwdCB0byB0aGUgc2VuZGVycykuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYXJrQ29udmVyc2F0aW9uUmVhZChcbiAgY29udmVyc2F0aW9uSWQ6IHN0cmluZyxcbiAgdXNlcklkOiBzdHJpbmdcbik6IFByb21pc2U8eyBtZXNzYWdlSWRzOiBzdHJpbmdbXTsgcmVhZEF0OiBEYXRlIH0+IHtcbiAgaWYgKCEoYXdhaXQgaXNNZW1iZXIoY29udmVyc2F0aW9uSWQsIHVzZXJJZCkpKSB7XG4gICAgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIkZPUkJJRERFTlwiLCBcIk5vdCBhIG1lbWJlci5cIik7XG4gIH1cbiAgY29uc3QgcmVhZEF0ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgdW5yZWFkID0gYXdhaXQgcHJpc21hLm1lc3NhZ2UuZmluZE1hbnkoe1xuICAgIHdoZXJlOiB7XG4gICAgICBjb252ZXJzYXRpb25JZCxcbiAgICAgIHNlbmRlcklkOiB7IG5vdDogdXNlcklkIH0sXG4gICAgICByZWFkczogeyBub25lOiB7IHVzZXJJZCB9IH0sXG4gICAgfSxcbiAgICBzZWxlY3Q6IHsgaWQ6IHRydWUgfSxcbiAgfSk7XG5cbiAgaWYgKHVucmVhZC5sZW5ndGggPiAwKSB7XG4gICAgYXdhaXQgcHJpc21hLiR0cmFuc2FjdGlvbihbXG4gICAgICBwcmlzbWEubWVzc2FnZVJlYWQuY3JlYXRlTWFueSh7XG4gICAgICAgIGRhdGE6IHVucmVhZC5tYXAoKG0pID0+ICh7IG1lc3NhZ2VJZDogbS5pZCwgdXNlcklkLCByZWFkQXQgfSkpLFxuICAgICAgICBza2lwRHVwbGljYXRlczogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICAgcHJpc21hLm1lc3NhZ2UudXBkYXRlTWFueSh7XG4gICAgICAgIHdoZXJlOiB7IGlkOiB7IGluOiB1bnJlYWQubWFwKChtKSA9PiBtLmlkKSB9IH0sXG4gICAgICAgIGRhdGE6IHsgc3RhdHVzOiBcIlJFQURcIiB9LFxuICAgICAgfSksXG4gICAgXSk7XG4gIH1cblxuICBhd2FpdCBwcmlzbWEuY29udmVyc2F0aW9uTWVtYmVyLnVwZGF0ZSh7XG4gICAgd2hlcmU6IHsgY29udmVyc2F0aW9uSWRfdXNlcklkOiB7IGNvbnZlcnNhdGlvbklkLCB1c2VySWQgfSB9LFxuICAgIGRhdGE6IHsgbGFzdFJlYWRBdDogcmVhZEF0IH0sXG4gIH0pO1xuXG4gIHJldHVybiB7IG1lc3NhZ2VJZHM6IHVucmVhZC5tYXAoKG0pID0+IG0uaWQpLCByZWFkQXQgfTtcbn1cblxuZXhwb3J0IGNvbnN0IEFMTE9XRURfUkVBQ1RJT05TID0gUkVBQ1RJT05fRU1PSkk7XG5cbi8qKlxuICogVG9nZ2xlcyBhIHJlYWN0aW9uOiBhZGRzIGl0IGlmIGFic2VudCwgcmVtb3ZlcyBpdCBpZiB0aGUgdXNlciBhbHJlYWR5IHJlYWN0ZWRcbiAqIHdpdGggdGhhdCBlbW9qaS4gSWRlbXBvdGVudCBwZXIgdGhlIGAobWVzc2FnZUlkLCB1c2VySWQsIGVtb2ppKWAgdW5pcXVlXG4gKiBjb25zdHJhaW50LiBSZXR1cm5zIHRoZSByZWdyb3VwZWQgcmVhY3Rpb25zIHBsdXMgdGhlIGNvbnZlcnNhdGlvbiBpZCBzbyB0aGVcbiAqIGNhbGxlciBjYW4gZmFuIHRoZSB1cGRhdGUgb3V0IHRvIHRoZSByb29tLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdG9nZ2xlUmVhY3Rpb24oXG4gIG1lc3NhZ2VJZDogc3RyaW5nLFxuICB1c2VySWQ6IHN0cmluZyxcbiAgZW1vamk6IHN0cmluZ1xuKTogUHJvbWlzZTx7IGNvbnZlcnNhdGlvbklkOiBzdHJpbmc7IG1lc3NhZ2VJZDogc3RyaW5nOyByZWFjdGlvbnM6IFJlYWN0aW9uR3JvdXBbXSB9PiB7XG4gIGlmICghUkVBQ1RJT05fRU1PSkkuaW5jbHVkZXMoZW1vamkpKSB7XG4gICAgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIklOVkFMSURcIiwgXCJVbnN1cHBvcnRlZCByZWFjdGlvbi5cIik7XG4gIH1cbiAgY29uc3QgbWVzc2FnZSA9IGF3YWl0IHByaXNtYS5tZXNzYWdlLmZpbmRVbmlxdWUoe1xuICAgIHdoZXJlOiB7IGlkOiBtZXNzYWdlSWQgfSxcbiAgICBzZWxlY3Q6IHsgY29udmVyc2F0aW9uSWQ6IHRydWUgfSxcbiAgfSk7XG4gIGlmICghbWVzc2FnZSkgdGhyb3cgbmV3IE1lc3NhZ2VFcnJvcihcIk5PVF9GT1VORFwiLCBcIk1lc3NhZ2Ugbm90IGZvdW5kLlwiKTtcbiAgaWYgKCEoYXdhaXQgaXNNZW1iZXIobWVzc2FnZS5jb252ZXJzYXRpb25JZCwgdXNlcklkKSkpIHtcbiAgICB0aHJvdyBuZXcgTWVzc2FnZUVycm9yKFwiRk9SQklEREVOXCIsIFwiWW91IGFyZSBub3QgYSBtZW1iZXIgb2YgdGhpcyBjb252ZXJzYXRpb24uXCIpO1xuICB9XG5cbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBwcmlzbWEubWVzc2FnZVJlYWN0aW9uLmZpbmRVbmlxdWUoe1xuICAgIHdoZXJlOiB7IG1lc3NhZ2VJZF91c2VySWRfZW1vamk6IHsgbWVzc2FnZUlkLCB1c2VySWQsIGVtb2ppIH0gfSxcbiAgfSk7XG4gIGlmIChleGlzdGluZykge1xuICAgIGF3YWl0IHByaXNtYS5tZXNzYWdlUmVhY3Rpb24uZGVsZXRlKHsgd2hlcmU6IHsgaWQ6IGV4aXN0aW5nLmlkIH0gfSk7XG4gIH0gZWxzZSB7XG4gICAgYXdhaXQgcHJpc21hLm1lc3NhZ2VSZWFjdGlvbi5jcmVhdGUoeyBkYXRhOiB7IG1lc3NhZ2VJZCwgdXNlcklkLCBlbW9qaSB9IH0pO1xuICB9XG5cbiAgY29uc3QgYWxsID0gYXdhaXQgcHJpc21hLm1lc3NhZ2VSZWFjdGlvbi5maW5kTWFueSh7IHdoZXJlOiB7IG1lc3NhZ2VJZCB9IH0pO1xuICBjb25zdCBtYXAgPSBuZXcgTWFwPHN0cmluZywgUmVhY3Rpb25Hcm91cD4oKTtcbiAgZm9yIChjb25zdCByIG9mIGFsbCkge1xuICAgIGNvbnN0IGcgPSBtYXAuZ2V0KHIuZW1vamkpID8/IHsgZW1vamk6IHIuZW1vamksIGNvdW50OiAwLCB1c2VySWRzOiBbXSB9O1xuICAgIGcuY291bnQgKz0gMTtcbiAgICBnLnVzZXJJZHMucHVzaChyLnVzZXJJZCk7XG4gICAgbWFwLnNldChyLmVtb2ppLCBnKTtcbiAgfVxuICBjb25zdCByZWFjdGlvbnMgPSBbLi4ubWFwLnZhbHVlcygpXS5zb3J0KFxuICAgIChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudCB8fCBhLmVtb2ppLmxvY2FsZUNvbXBhcmUoYi5lbW9qaSlcbiAgKTtcbiAgcmV0dXJuIHsgY29udmVyc2F0aW9uSWQ6IG1lc3NhZ2UuY29udmVyc2F0aW9uSWQsIG1lc3NhZ2VJZCwgcmVhY3Rpb25zIH07XG59XG5cbi8qKiBCdWxrIG1hcmsgZGVsaXZlcmVkIHdoZW4gYSByZWNpcGllbnQncyBzb2NrZXQgcmVjZWl2ZXMgbWVzc2FnZXMuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWFya0RlbGl2ZXJlZChjb252ZXJzYXRpb25JZDogc3RyaW5nLCByZWNpcGllbnRJZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICBjb25zdCBwZW5kaW5nID0gYXdhaXQgcHJpc21hLm1lc3NhZ2UuZmluZE1hbnkoe1xuICAgIHdoZXJlOiB7IGNvbnZlcnNhdGlvbklkLCBzZW5kZXJJZDogeyBub3Q6IHJlY2lwaWVudElkIH0sIHN0YXR1czogXCJTRU5UXCIgfSxcbiAgICBzZWxlY3Q6IHsgaWQ6IHRydWUgfSxcbiAgfSk7XG4gIGlmIChwZW5kaW5nLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBhd2FpdCBwcmlzbWEubWVzc2FnZS51cGRhdGVNYW55KHtcbiAgICB3aGVyZTogeyBpZDogeyBpbjogcGVuZGluZy5tYXAoKG0pID0+IG0uaWQpIH0gfSxcbiAgICBkYXRhOiB7IHN0YXR1czogXCJERUxJVkVSRURcIiB9LFxuICB9KTtcbiAgcmV0dXJuIHBlbmRpbmcubWFwKChtKSA9PiBtLmlkKTtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IE1lc3NhZ2UsIE1lc3NhZ2VSZWFjdGlvbiwgTWVzc2FnZVJlYWQsIFVzZXIgfSBmcm9tIFwiQHByaXNtYS9jbGllbnRcIjtcbmltcG9ydCB0eXBlIHtcbiAgQ29udmVyc2F0aW9uRFRPLFxuICBNZXNzYWdlRFRPLFxuICBQYXJ0aWNpcGFudERUTyxcbiAgUmVhY3Rpb25Hcm91cCxcbiAgUmVwbHlQcmV2aWV3LFxufSBmcm9tIFwiQC9saWIvdHlwZXNcIjtcblxudHlwZSBNZXNzYWdlV2l0aFJlbGF0aW9ucyA9IE1lc3NhZ2UgJiB7XG4gIHJlYWRzPzogTWVzc2FnZVJlYWRbXTtcbiAgcmVhY3Rpb25zPzogTWVzc2FnZVJlYWN0aW9uW107XG4gIHJlcGx5VG8/OiAoTWVzc2FnZSAmIHsgc2VuZGVyPzogUGljazxVc2VyLCBcImlkXCI+IH0pIHwgbnVsbDtcbn07XG5cbmZ1bmN0aW9uIHByZXZpZXdGb3IobTogUGljazxNZXNzYWdlLCBcImtpbmRcIiB8IFwiYm9keVwiPik6IHN0cmluZyB7XG4gIHN3aXRjaCAobS5raW5kKSB7XG4gICAgY2FzZSBcIklNQUdFXCI6XG4gICAgICByZXR1cm4gXCJcdUQ4M0RcdURDRjcgUGhvdG9cIjtcbiAgICBjYXNlIFwiR0lGXCI6XG4gICAgICByZXR1cm4gXCJHSUZcIjtcbiAgICBjYXNlIFwiU1RJQ0tFUlwiOlxuICAgICAgcmV0dXJuIFwiU3RpY2tlclwiO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gbS5ib2R5Lmxlbmd0aCA+IDEyMCA/IGAke20uYm9keS5zbGljZSgwLCAxMjApfVx1MjAyNmAgOiBtLmJvZHk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZ3JvdXBSZWFjdGlvbnMocmVhY3Rpb25zOiBNZXNzYWdlUmVhY3Rpb25bXSA9IFtdKTogUmVhY3Rpb25Hcm91cFtdIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcDxzdHJpbmcsIFJlYWN0aW9uR3JvdXA+KCk7XG4gIGZvciAoY29uc3QgciBvZiByZWFjdGlvbnMpIHtcbiAgICBjb25zdCBnID0gbWFwLmdldChyLmVtb2ppKSA/PyB7IGVtb2ppOiByLmVtb2ppLCBjb3VudDogMCwgdXNlcklkczogW10gfTtcbiAgICBnLmNvdW50ICs9IDE7XG4gICAgZy51c2VySWRzLnB1c2goci51c2VySWQpO1xuICAgIG1hcC5zZXQoci5lbW9qaSwgZyk7XG4gIH1cbiAgcmV0dXJuIFsuLi5tYXAudmFsdWVzKCldLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50IHx8IGEuZW1vamkubG9jYWxlQ29tcGFyZShiLmVtb2ppKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b01lc3NhZ2VEVE8obTogTWVzc2FnZVdpdGhSZWxhdGlvbnMpOiBNZXNzYWdlRFRPIHtcbiAgY29uc3QgcmVwbHlUbzogUmVwbHlQcmV2aWV3IHwgbnVsbCA9IG0ucmVwbHlUb1xuICAgID8ge1xuICAgICAgICBpZDogbS5yZXBseVRvLmlkLFxuICAgICAgICBzZW5kZXJJZDogbS5yZXBseVRvLnNlbmRlcklkLFxuICAgICAgICBraW5kOiBtLnJlcGx5VG8ua2luZCxcbiAgICAgICAgcHJldmlldzogcHJldmlld0ZvcihtLnJlcGx5VG8pLFxuICAgICAgfVxuICAgIDogbnVsbDtcblxuICByZXR1cm4ge1xuICAgIGlkOiBtLmlkLFxuICAgIGNsaWVudElkOiBtLmNsaWVudElkLFxuICAgIGNvbnZlcnNhdGlvbklkOiBtLmNvbnZlcnNhdGlvbklkLFxuICAgIHNlbmRlcklkOiBtLnNlbmRlcklkLFxuICAgIGtpbmQ6IG0ua2luZCxcbiAgICBib2R5OiBtLmJvZHksXG4gICAgbWV0YWRhdGE6IChtLm1ldGFkYXRhIGFzIE1lc3NhZ2VEVE9bXCJtZXRhZGF0YVwiXSkgPz8gbnVsbCxcbiAgICBzdGF0dXM6IG0uc3RhdHVzLFxuICAgIGNyZWF0ZWRBdDogbS5jcmVhdGVkQXQudG9JU09TdHJpbmcoKSxcbiAgICByZWFkQnk6IChtLnJlYWRzID8/IFtdKS5tYXAoKHIpID0+IHIudXNlcklkKSxcbiAgICByZWFjdGlvbnM6IGdyb3VwUmVhY3Rpb25zKG0ucmVhY3Rpb25zKSxcbiAgICByZXBseVRvLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9QYXJ0aWNpcGFudERUTyhcbiAgdTogUGljazxVc2VyLCBcImlkXCIgfCBcInVzZXJuYW1lXCIgfCBcImRpc3BsYXlOYW1lXCIgfCBcImF2YXRhckNvbG9yXCI+XG4pOiBQYXJ0aWNpcGFudERUTyB7XG4gIHJldHVybiB7XG4gICAgaWQ6IHUuaWQsXG4gICAgdXNlcm5hbWU6IHUudXNlcm5hbWUsXG4gICAgZGlzcGxheU5hbWU6IHUuZGlzcGxheU5hbWUsXG4gICAgYXZhdGFyQ29sb3I6IHUuYXZhdGFyQ29sb3IsXG4gIH07XG59XG5cbmV4cG9ydCB0eXBlIENvbnZlcnNhdGlvblJvdyA9IHtcbiAgaWQ6IHN0cmluZztcbiAgaXNHcm91cDogYm9vbGVhbjtcbiAgdGl0bGU6IHN0cmluZyB8IG51bGw7XG4gIHVwZGF0ZWRBdDogRGF0ZTtcbiAgbWVtYmVyczogeyB1c2VyOiBQaWNrPFVzZXIsIFwiaWRcIiB8IFwidXNlcm5hbWVcIiB8IFwiZGlzcGxheU5hbWVcIiB8IFwiYXZhdGFyQ29sb3JcIj4gfVtdO1xuICBtZXNzYWdlczogTWVzc2FnZVdpdGhSZWxhdGlvbnNbXTtcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiB0b0NvbnZlcnNhdGlvbkRUTyhcbiAgcm93OiBDb252ZXJzYXRpb25Sb3csXG4gIHVucmVhZENvdW50OiBudW1iZXIsXG4gIG15TGFzdFJlYWRBdDogRGF0ZVxuKTogQ29udmVyc2F0aW9uRFRPIHtcbiAgcmV0dXJuIHtcbiAgICBpZDogcm93LmlkLFxuICAgIGlzR3JvdXA6IHJvdy5pc0dyb3VwLFxuICAgIHRpdGxlOiByb3cudGl0bGUsXG4gICAgcGFydGljaXBhbnRzOiByb3cubWVtYmVycy5tYXAoKG0pID0+IHRvUGFydGljaXBhbnREVE8obS51c2VyKSksXG4gICAgbGFzdE1lc3NhZ2U6IHJvdy5tZXNzYWdlc1swXSA/IHRvTWVzc2FnZURUTyhyb3cubWVzc2FnZXNbMF0pIDogbnVsbCxcbiAgICB1bnJlYWRDb3VudCxcbiAgICBteUxhc3RSZWFkQXQ6IG15TGFzdFJlYWRBdC50b0lTT1N0cmluZygpLFxuICAgIHVwZGF0ZWRBdDogcm93LnVwZGF0ZWRBdC50b0lTT1N0cmluZygpLFxuICB9O1xufVxuXG4vKiogU3RhbmRhcmQgaW5jbHVkZSBmb3IgbG9hZGluZyBhIG1lc3NhZ2Ugd2l0aCBldmVyeXRoaW5nIHRoZSBEVE8gbmVlZHMuICovXG5leHBvcnQgY29uc3QgbWVzc2FnZUluY2x1ZGUgPSB7XG4gIHJlYWRzOiB0cnVlLFxuICByZWFjdGlvbnM6IHRydWUsXG4gIHJlcGx5VG86IHRydWUsXG59IGFzIGNvbnN0O1xuIiwgImltcG9ydCB7IHByaXNtYSB9IGZyb20gXCJAL2xpYi9wcmlzbWFcIjtcbmltcG9ydCB0eXBlIHsgQ29udmVyc2F0aW9uRFRPIH0gZnJvbSBcIkAvbGliL3R5cGVzXCI7XG5pbXBvcnQgeyBtZXNzYWdlSW5jbHVkZSwgdG9Db252ZXJzYXRpb25EVE8sIHR5cGUgQ29udmVyc2F0aW9uUm93IH0gZnJvbSBcIi4vc2VyaWFsaXplXCI7XG5cbmNvbnN0IG1lbWJlclVzZXJTZWxlY3QgPSB7XG4gIHNlbGVjdDogeyBpZDogdHJ1ZSwgdXNlcm5hbWU6IHRydWUsIGRpc3BsYXlOYW1lOiB0cnVlLCBhdmF0YXJDb2xvcjogdHJ1ZSB9LFxufSBhcyBjb25zdDtcblxuLyoqIFRocm93cy1mcmVlIG1lbWJlcnNoaXAgY2hlY2sgdXNlZCBmb3IgYXV0aG9yaXphdGlvbiBldmVyeXdoZXJlLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGlzTWVtYmVyKGNvbnZlcnNhdGlvbklkOiBzdHJpbmcsIHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IGNvdW50ID0gYXdhaXQgcHJpc21hLmNvbnZlcnNhdGlvbk1lbWJlci5jb3VudCh7XG4gICAgd2hlcmU6IHsgY29udmVyc2F0aW9uSWQsIHVzZXJJZCB9LFxuICB9KTtcbiAgcmV0dXJuIGNvdW50ID4gMDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldE1lbWJlcklkcyhjb252ZXJzYXRpb25JZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICBjb25zdCByb3dzID0gYXdhaXQgcHJpc21hLmNvbnZlcnNhdGlvbk1lbWJlci5maW5kTWFueSh7XG4gICAgd2hlcmU6IHsgY29udmVyc2F0aW9uSWQgfSxcbiAgICBzZWxlY3Q6IHsgdXNlcklkOiB0cnVlIH0sXG4gIH0pO1xuICByZXR1cm4gcm93cy5tYXAoKHIpID0+IHIudXNlcklkKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxpc3RDb252ZXJzYXRpb25zKHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxDb252ZXJzYXRpb25EVE9bXT4ge1xuICBjb25zdCByb3dzID0gYXdhaXQgcHJpc21hLmNvbnZlcnNhdGlvbi5maW5kTWFueSh7XG4gICAgd2hlcmU6IHsgbWVtYmVyczogeyBzb21lOiB7IHVzZXJJZCB9IH0gfSxcbiAgICBvcmRlckJ5OiB7IHVwZGF0ZWRBdDogXCJkZXNjXCIgfSxcbiAgICBpbmNsdWRlOiB7XG4gICAgICBtZW1iZXJzOiB7IGluY2x1ZGU6IHsgdXNlcjogbWVtYmVyVXNlclNlbGVjdCB9IH0sXG4gICAgICBtZXNzYWdlczoge1xuICAgICAgICBvcmRlckJ5OiB7IGNyZWF0ZWRBdDogXCJkZXNjXCIgfSxcbiAgICAgICAgdGFrZTogMSxcbiAgICAgICAgaW5jbHVkZTogbWVzc2FnZUluY2x1ZGUsXG4gICAgICB9LFxuICAgIH0sXG4gIH0pO1xuXG4gIGNvbnN0IG1lbWJlcnNoaXBzID0gYXdhaXQgcHJpc21hLmNvbnZlcnNhdGlvbk1lbWJlci5maW5kTWFueSh7XG4gICAgd2hlcmU6IHsgdXNlcklkLCBjb252ZXJzYXRpb25JZDogeyBpbjogcm93cy5tYXAoKHIpID0+IHIuaWQpIH0gfSxcbiAgICBzZWxlY3Q6IHsgY29udmVyc2F0aW9uSWQ6IHRydWUsIGxhc3RSZWFkQXQ6IHRydWUgfSxcbiAgfSk7XG4gIGNvbnN0IGxhc3RSZWFkTWFwID0gbmV3IE1hcChtZW1iZXJzaGlwcy5tYXAoKG0pID0+IFttLmNvbnZlcnNhdGlvbklkLCBtLmxhc3RSZWFkQXRdKSk7XG5cbiAgY29uc3QgcmVzdWx0OiBDb252ZXJzYXRpb25EVE9bXSA9IFtdO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgY29uc3QgbGFzdFJlYWRBdCA9IGxhc3RSZWFkTWFwLmdldChyb3cuaWQpID8/IG5ldyBEYXRlKDApO1xuICAgIGNvbnN0IHVucmVhZENvdW50ID0gYXdhaXQgcHJpc21hLm1lc3NhZ2UuY291bnQoe1xuICAgICAgd2hlcmU6IHtcbiAgICAgICAgY29udmVyc2F0aW9uSWQ6IHJvdy5pZCxcbiAgICAgICAgc2VuZGVySWQ6IHsgbm90OiB1c2VySWQgfSxcbiAgICAgICAgY3JlYXRlZEF0OiB7IGd0OiBsYXN0UmVhZEF0IH0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHJlc3VsdC5wdXNoKHRvQ29udmVyc2F0aW9uRFRPKHJvdyBhcyBDb252ZXJzYXRpb25Sb3csIHVucmVhZENvdW50LCBsYXN0UmVhZEF0KSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldENvbnZlcnNhdGlvbkZvclVzZXIoXG4gIGNvbnZlcnNhdGlvbklkOiBzdHJpbmcsXG4gIHVzZXJJZDogc3RyaW5nXG4pOiBQcm9taXNlPENvbnZlcnNhdGlvbkRUTyB8IG51bGw+IHtcbiAgaWYgKCEoYXdhaXQgaXNNZW1iZXIoY29udmVyc2F0aW9uSWQsIHVzZXJJZCkpKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgcm93ID0gYXdhaXQgcHJpc21hLmNvbnZlcnNhdGlvbi5maW5kVW5pcXVlKHtcbiAgICB3aGVyZTogeyBpZDogY29udmVyc2F0aW9uSWQgfSxcbiAgICBpbmNsdWRlOiB7XG4gICAgICBtZW1iZXJzOiB7IGluY2x1ZGU6IHsgdXNlcjogbWVtYmVyVXNlclNlbGVjdCB9IH0sXG4gICAgICBtZXNzYWdlczogeyBvcmRlckJ5OiB7IGNyZWF0ZWRBdDogXCJkZXNjXCIgfSwgdGFrZTogMSwgaW5jbHVkZTogbWVzc2FnZUluY2x1ZGUgfSxcbiAgICB9LFxuICB9KTtcbiAgaWYgKCFyb3cpIHJldHVybiBudWxsO1xuICBjb25zdCBtZW1iZXJzaGlwID0gYXdhaXQgcHJpc21hLmNvbnZlcnNhdGlvbk1lbWJlci5maW5kVW5pcXVlKHtcbiAgICB3aGVyZTogeyBjb252ZXJzYXRpb25JZF91c2VySWQ6IHsgY29udmVyc2F0aW9uSWQsIHVzZXJJZCB9IH0sXG4gIH0pO1xuICBjb25zdCBsYXN0UmVhZEF0ID0gbWVtYmVyc2hpcD8ubGFzdFJlYWRBdCA/PyBuZXcgRGF0ZSgwKTtcbiAgY29uc3QgdW5yZWFkQ291bnQgPSBhd2FpdCBwcmlzbWEubWVzc2FnZS5jb3VudCh7XG4gICAgd2hlcmU6IHtcbiAgICAgIGNvbnZlcnNhdGlvbklkLFxuICAgICAgc2VuZGVySWQ6IHsgbm90OiB1c2VySWQgfSxcbiAgICAgIGNyZWF0ZWRBdDogeyBndDogbGFzdFJlYWRBdCB9LFxuICAgIH0sXG4gIH0pO1xuICByZXR1cm4gdG9Db252ZXJzYXRpb25EVE8ocm93IGFzIENvbnZlcnNhdGlvblJvdywgdW5yZWFkQ291bnQsIGxhc3RSZWFkQXQpO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSAxOjEgY29udmVyc2F0aW9uLCBvciByZXR1cm5zIHRoZSBleGlzdGluZyBvbmUgYmV0d2VlbiB0aGUgdHdvIHVzZXJzXG4gKiAoaWRlbXBvdGVudCBcdTIwMTQgYSB1c2VyIGRvdWJsZS1jbGlja2luZyBcIm1lc3NhZ2VcIiBuZXZlciBjcmVhdGVzIGR1cGxpY2F0ZXMpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0T3JDcmVhdGVEaXJlY3RDb252ZXJzYXRpb24oXG4gIHVzZXJJZDogc3RyaW5nLFxuICBvdGhlclVzZXJJZDogc3RyaW5nXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBpZiAodXNlcklkID09PSBvdGhlclVzZXJJZCkgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHN0YXJ0IGEgY29udmVyc2F0aW9uIHdpdGggeW91cnNlbGYuXCIpO1xuXG4gIGNvbnN0IG90aGVyID0gYXdhaXQgcHJpc21hLnVzZXIuZmluZFVuaXF1ZSh7IHdoZXJlOiB7IGlkOiBvdGhlclVzZXJJZCB9IH0pO1xuICBpZiAoIW90aGVyKSB0aHJvdyBuZXcgRXJyb3IoXCJVc2VyIG5vdCBmb3VuZC5cIik7XG5cbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBwcmlzbWEuY29udmVyc2F0aW9uLmZpbmRGaXJzdCh7XG4gICAgd2hlcmU6IHtcbiAgICAgIGlzR3JvdXA6IGZhbHNlLFxuICAgICAgQU5EOiBbXG4gICAgICAgIHsgbWVtYmVyczogeyBzb21lOiB7IHVzZXJJZCB9IH0gfSxcbiAgICAgICAgeyBtZW1iZXJzOiB7IHNvbWU6IHsgdXNlcklkOiBvdGhlclVzZXJJZCB9IH0gfSxcbiAgICAgIF0sXG4gICAgfSxcbiAgICBzZWxlY3Q6IHsgaWQ6IHRydWUsIG1lbWJlcnM6IHsgc2VsZWN0OiB7IHVzZXJJZDogdHJ1ZSB9IH0gfSxcbiAgfSk7XG4gIGlmIChleGlzdGluZyAmJiBleGlzdGluZy5tZW1iZXJzLmxlbmd0aCA9PT0gMikgcmV0dXJuIGV4aXN0aW5nLmlkO1xuXG4gIGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCBwcmlzbWEuY29udmVyc2F0aW9uLmNyZWF0ZSh7XG4gICAgZGF0YToge1xuICAgICAgaXNHcm91cDogZmFsc2UsXG4gICAgICBtZW1iZXJzOiB7IGNyZWF0ZTogW3sgdXNlcklkIH0sIHsgdXNlcklkOiBvdGhlclVzZXJJZCB9XSB9LFxuICAgIH0sXG4gIH0pO1xuICByZXR1cm4gY3JlYXRlZC5pZDtcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFNvY2tldCB9IGZyb20gXCJzb2NrZXQuaW9cIjtcbmltcG9ydCB0eXBlIHsgU2Vzc2lvblVzZXIgfSBmcm9tIFwiLi4vYXV0aC1jb3JlXCI7XG5pbXBvcnQgeyBnZXRTZXNzaW9uVXNlckZyb21Db29raWVIZWFkZXIgfSBmcm9tIFwiLi4vYXV0aC1jb3JlXCI7XG5pbXBvcnQgdHlwZSB7IENsaWVudFRvU2VydmVyRXZlbnRzLCBTZXJ2ZXJUb0NsaWVudEV2ZW50cyB9IGZyb20gXCIuL2V2ZW50c1wiO1xuaW1wb3J0IHsgY29udmVyc2F0aW9uUm9vbSwgdXNlclJvb20gfSBmcm9tIFwiLi9ldmVudHNcIjtcbmltcG9ydCB7IGFkZFNvY2tldCwgZ2V0TGFzdFNlZW4sIGlzT25saW5lLCBvbmxpbmVVc2VySWRzLCByZW1vdmVTb2NrZXQgfSBmcm9tIFwiLi9wcmVzZW5jZVwiO1xuaW1wb3J0IHsgcmF0ZUxpbWl0LCBSQVRFX0xJTUlUUyB9IGZyb20gXCIuLi9yYXRlTGltaXRcIjtcbmltcG9ydCB7IGNoZWNrUHJvZmFuaXR5IH0gZnJvbSBcIi4uL21vZGVyYXRpb24vcHJvZmFuaXR5XCI7XG5pbXBvcnQgeyBwcmlzbWEgfSBmcm9tIFwiLi4vcHJpc21hXCI7XG5pbXBvcnQge1xuICBjcmVhdGVNZXNzYWdlLFxuICBnZXRNZXNzYWdlc0FmdGVyLFxuICBtYXJrQ29udmVyc2F0aW9uUmVhZCxcbiAgbWFya0RlbGl2ZXJlZCxcbiAgTWVzc2FnZUVycm9yLFxuICB0b2dnbGVSZWFjdGlvbixcbn0gZnJvbSBcIkAvc2VydmVyL21lc3NhZ2VzXCI7XG5pbXBvcnQgeyBnZXRNZW1iZXJJZHMsIGlzTWVtYmVyIH0gZnJvbSBcIkAvc2VydmVyL2NvbnZlcnNhdGlvbnNcIjtcbmltcG9ydCB0eXBlIHsgVHlwZWRTZXJ2ZXIgfSBmcm9tIFwiLi9pb1wiO1xuXG50eXBlIFR5cGVkU29ja2V0ID0gU29ja2V0PENsaWVudFRvU2VydmVyRXZlbnRzLCBTZXJ2ZXJUb0NsaWVudEV2ZW50cywgUmVjb3JkPHN0cmluZywgbmV2ZXI+LCB7IHVzZXI6IFNlc3Npb25Vc2VyIH0+O1xuXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJTb2NrZXRIYW5kbGVycyhpbzogVHlwZWRTZXJ2ZXIpIHtcbiAgLy8gLS0tIGF1dGhlbnRpY2F0aW9uIG9uIHRoZSBoYW5kc2hha2UgKHNlcnZlci1zaWRlLCBjb29raWUtYmFzZWQpIC0tLVxuICBpby51c2UoYXN5bmMgKHNvY2tldCwgbmV4dCkgPT4ge1xuICAgIGNvbnN0IHVzZXIgPSBhd2FpdCBnZXRTZXNzaW9uVXNlckZyb21Db29raWVIZWFkZXIoc29ja2V0LmhhbmRzaGFrZS5oZWFkZXJzLmNvb2tpZSk7XG4gICAgaWYgKCF1c2VyKSByZXR1cm4gbmV4dChuZXcgRXJyb3IoXCJVTkFVVEhPUklaRURcIikpO1xuICAgIChzb2NrZXQuZGF0YSBhcyB7IHVzZXI6IFNlc3Npb25Vc2VyIH0pLnVzZXIgPSB1c2VyO1xuICAgIG5leHQoKTtcbiAgfSk7XG5cbiAgaW8ub24oXCJjb25uZWN0aW9uXCIsIChzb2NrZXQ6IFR5cGVkU29ja2V0KSA9PiB7XG4gICAgY29uc3QgdXNlciA9IHNvY2tldC5kYXRhLnVzZXI7XG5cbiAgICAvLyAtLS0gcmVnaXN0ZXIgZXZlbnQgaGFuZGxlcnMgc3luY2hyb25vdXNseSAobmV2ZXIgYmVoaW5kIGFuIGF3YWl0KSAtLS1cblxuICAgIC8vIGFzeW5jIGNvbm5lY3Rpb24gc2V0dXA6IGpvaW4gcm9vbXMsIHByZXNlbmNlLCBkZWxpdmVyIHJlY2VpcHRzXG4gICAgdm9pZCAoYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgc29ja2V0LmpvaW4odXNlclJvb20odXNlci5pZCkpO1xuICAgICAgICBjb25zdCBtZW1iZXJzaGlwcyA9IGF3YWl0IHByaXNtYS5jb252ZXJzYXRpb25NZW1iZXIuZmluZE1hbnkoe1xuICAgICAgICAgIHdoZXJlOiB7IHVzZXJJZDogdXNlci5pZCB9LFxuICAgICAgICAgIHNlbGVjdDogeyBjb252ZXJzYXRpb25JZDogdHJ1ZSB9LFxuICAgICAgICB9KTtcbiAgICAgICAgZm9yIChjb25zdCBtIG9mIG1lbWJlcnNoaXBzKSBzb2NrZXQuam9pbihjb252ZXJzYXRpb25Sb29tKG0uY29udmVyc2F0aW9uSWQpKTtcblxuICAgICAgICBjb25zdCBiZWNhbWVPbmxpbmUgPSBhZGRTb2NrZXQodXNlci5pZCwgc29ja2V0LmlkKTtcbiAgICAgICAgc29ja2V0LmVtaXQoXCJwcmVzZW5jZTpzbmFwc2hvdFwiLCB7IG9ubGluZTogb25saW5lVXNlcklkcygpIH0pO1xuICAgICAgICBpZiAoYmVjYW1lT25saW5lKSB7XG4gICAgICAgICAgc29ja2V0LmJyb2FkY2FzdC5lbWl0KFwicHJlc2VuY2U6dXBkYXRlXCIsIHtcbiAgICAgICAgICAgIHVzZXJJZDogdXNlci5pZCxcbiAgICAgICAgICAgIG9ubGluZTogdHJ1ZSxcbiAgICAgICAgICAgIGxhc3RTZWVuOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IG0gb2YgbWVtYmVyc2hpcHMpIHtcbiAgICAgICAgICBjb25zdCBpZHMgPSBhd2FpdCBtYXJrRGVsaXZlcmVkKG0uY29udmVyc2F0aW9uSWQsIHVzZXIuaWQpO1xuICAgICAgICAgIGlmIChpZHMubGVuZ3RoKSB7XG4gICAgICAgICAgICBpby50byhjb252ZXJzYXRpb25Sb29tKG0uY29udmVyc2F0aW9uSWQpKS5lbWl0KFwibWVzc2FnZTpzdGF0dXNcIiwge1xuICAgICAgICAgICAgICBjb252ZXJzYXRpb25JZDogbS5jb252ZXJzYXRpb25JZCxcbiAgICAgICAgICAgICAgbWVzc2FnZUlkczogaWRzLFxuICAgICAgICAgICAgICBzdGF0dXM6IFwiREVMSVZFUkVEXCIsXG4gICAgICAgICAgICAgIGJ5OiB1c2VyLmlkLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcInNvY2tldCBjb25uZWN0aW9uIHNldHVwIGVycm9yXCIsIGVycik7XG4gICAgICB9XG4gICAgfSkoKTtcblxuICAgIC8vIC0tLSBzZW5kIGEgbWVzc2FnZSAodGV4dCAvIGdpZiAvIHN0aWNrZXIpIC0tLVxuICAgIHNvY2tldC5vbihcIm1lc3NhZ2U6c2VuZFwiLCBhc3luYyAoaW5wdXQsIGFjaykgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmwgPSByYXRlTGltaXQoYHNlbmQ6JHt1c2VyLmlkfWAsIFJBVEVfTElNSVRTLnNlbmQubGltaXQsIFJBVEVfTElNSVRTLnNlbmQud2luZG93TXMpO1xuICAgICAgICBpZiAoIXJsLm9rKSB7XG4gICAgICAgICAgcmV0dXJuIGFjayh7IG9rOiBmYWxzZSwgY29kZTogXCJSQVRFX0xJTUlURURcIiwgbWVzc2FnZTogXCJZb3UncmUgc2VuZGluZyBtZXNzYWdlcyB0b28gZmFzdC4gU2xvdyBkb3duIGEgbW9tZW50LlwiIH0pO1xuICAgICAgICB9XG4gICAgICAgIGlmICghW1wiVEVYVFwiLCBcIkdJRlwiLCBcIlNUSUNLRVJcIl0uaW5jbHVkZXMoaW5wdXQua2luZCkpIHtcbiAgICAgICAgICByZXR1cm4gYWNrKHsgb2s6IGZhbHNlLCBjb2RlOiBcIklOVkFMSURcIiwgbWVzc2FnZTogXCJVbnN1cHBvcnRlZCBtZXNzYWdlIHR5cGUgZm9yIHRoaXMgY2hhbm5lbC5cIiB9KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIShhd2FpdCBpc01lbWJlcihpbnB1dC5jb252ZXJzYXRpb25JZCwgdXNlci5pZCkpKSB7XG4gICAgICAgICAgcmV0dXJuIGFjayh7IG9rOiBmYWxzZSwgY29kZTogXCJGT1JCSURERU5cIiwgbWVzc2FnZTogXCJZb3UgYXJlIG5vdCBwYXJ0IG9mIHRoaXMgY29udmVyc2F0aW9uLlwiIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gc2VydmVyLXNpZGUgcHJvZmFuaXR5IG1vZGVyYXRpb24gXHUyMDE0IGFwcGxpZXMgdG8gdGhlIHRleHQgYm9keSBhbmQgdG9cbiAgICAgICAgLy8gR0lGL3N0aWNrZXIgc2VhcmNoIHRpdGxlcyBjYXJyaWVkIGluIG1ldGFkYXRhLlxuICAgICAgICBjb25zdCB0ZXh0VG9TY2FuID0gW2lucHV0LmJvZHkgPz8gXCJcIiwgaW5wdXQubWV0YWRhdGE/LnRpdGxlID8/IFwiXCJdLmpvaW4oXCIgXCIpLnRyaW0oKTtcbiAgICAgICAgaWYgKHRleHRUb1NjYW4pIHtcbiAgICAgICAgICBjb25zdCB2ZXJkaWN0ID0gY2hlY2tQcm9mYW5pdHkodGV4dFRvU2Nhbik7XG4gICAgICAgICAgaWYgKCF2ZXJkaWN0LmNsZWFuKSB7XG4gICAgICAgICAgICBhd2FpdCBwcmlzbWEubW9kZXJhdGlvbkxvZy5jcmVhdGUoe1xuICAgICAgICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgICAgICAgdXNlcklkOiB1c2VyLmlkLFxuICAgICAgICAgICAgICAgIGtpbmQ6IFwicHJvZmFuaXR5XCIsXG4gICAgICAgICAgICAgICAgYWN0aW9uOiBcImJsb2NrZWRcIixcbiAgICAgICAgICAgICAgICByZWFzb246IGBtYXRjaGVkOiAke3ZlcmRpY3QubWF0Y2hlZC5qb2luKFwiLCBcIil9YCxcbiAgICAgICAgICAgICAgICBkZXRhaWw6IHsgY29udmVyc2F0aW9uSWQ6IGlucHV0LmNvbnZlcnNhdGlvbklkIH0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiBhY2soe1xuICAgICAgICAgICAgICBvazogZmFsc2UsXG4gICAgICAgICAgICAgIGNvZGU6IFwiUFJPRkFOSVRZXCIsXG4gICAgICAgICAgICAgIG1lc3NhZ2U6IFwiWW91ciBtZXNzYWdlIHdhcyBibG9ja2VkIGZvciBwcm9oaWJpdGVkIGxhbmd1YWdlLiBQbGVhc2UgcmVwaHJhc2UgYW5kIHRyeSBhZ2Fpbi5cIixcbiAgICAgICAgICAgICAgbWF0Y2hlZDogdmVyZGljdC5tYXRjaGVkLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgeyBtZXNzYWdlIH0gPSBhd2FpdCBjcmVhdGVNZXNzYWdlKHtcbiAgICAgICAgICBjb252ZXJzYXRpb25JZDogaW5wdXQuY29udmVyc2F0aW9uSWQsXG4gICAgICAgICAgc2VuZGVySWQ6IHVzZXIuaWQsXG4gICAgICAgICAgY2xpZW50SWQ6IGlucHV0LmNsaWVudElkLFxuICAgICAgICAgIGtpbmQ6IGlucHV0LmtpbmQsXG4gICAgICAgICAgYm9keTogaW5wdXQuYm9keSxcbiAgICAgICAgICBtZXRhZGF0YTogaW5wdXQubWV0YWRhdGEsXG4gICAgICAgICAgcmVwbHlUb0lkOiBpbnB1dC5yZXBseVRvSWQgPz8gbnVsbCxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcGFydGljaXBhbnRJZHMgPSBhd2FpdCBnZXRNZW1iZXJJZHMoaW5wdXQuY29udmVyc2F0aW9uSWQpO1xuICAgICAgICBpby50byhjb252ZXJzYXRpb25Sb29tKGlucHV0LmNvbnZlcnNhdGlvbklkKSkuZW1pdChcIm1lc3NhZ2U6bmV3XCIsIG1lc3NhZ2UpO1xuICAgICAgICBmb3IgKGNvbnN0IHVpZCBvZiBwYXJ0aWNpcGFudElkcykge1xuICAgICAgICAgIGlmICh1aWQgIT09IHVzZXIuaWQpIGlvLnRvKHVzZXJSb29tKHVpZCkpLmVtaXQoXCJtZXNzYWdlOm5ld1wiLCBtZXNzYWdlKTtcbiAgICAgICAgfVxuICAgICAgICBhY2soeyBvazogdHJ1ZSwgbWVzc2FnZSB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBpZiAoZXJyIGluc3RhbmNlb2YgTWVzc2FnZUVycm9yKSB7XG4gICAgICAgICAgcmV0dXJuIGFjayh7IG9rOiBmYWxzZSwgY29kZTogZXJyLmNvZGUgPT09IFwiRk9SQklEREVOXCIgPyBcIkZPUkJJRERFTlwiIDogXCJJTlZBTElEXCIsIG1lc3NhZ2U6IGVyci5tZXNzYWdlIH0pO1xuICAgICAgICB9XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJtZXNzYWdlOnNlbmQgZXJyb3JcIiwgZXJyKTtcbiAgICAgICAgYWNrKHsgb2s6IGZhbHNlLCBjb2RlOiBcIkVSUk9SXCIsIG1lc3NhZ2U6IFwiU29tZXRoaW5nIHdlbnQgd3Jvbmcgc2VuZGluZyB5b3VyIG1lc3NhZ2UuXCIgfSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyAtLS0gcmVhY3Rpb25zIC0tLVxuICAgIHNvY2tldC5vbihcInJlYWN0aW9uOnRvZ2dsZVwiLCBhc3luYyAoeyBtZXNzYWdlSWQsIGVtb2ppIH0sIGFjaykgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmwgPSByYXRlTGltaXQoYHJlYWN0OiR7dXNlci5pZH1gLCBSQVRFX0xJTUlUUy5yZWFjdGlvbi5saW1pdCwgUkFURV9MSU1JVFMucmVhY3Rpb24ud2luZG93TXMpO1xuICAgICAgICBpZiAoIXJsLm9rKSByZXR1cm4gYWNrKHsgb2s6IGZhbHNlLCBtZXNzYWdlOiBcIlNsb3cgZG93biBhIG1vbWVudC5cIiB9KTtcbiAgICAgICAgY29uc3QgeyBjb252ZXJzYXRpb25JZCwgbWVzc2FnZUlkOiBtaWQsIHJlYWN0aW9ucyB9ID0gYXdhaXQgdG9nZ2xlUmVhY3Rpb24oXG4gICAgICAgICAgbWVzc2FnZUlkLFxuICAgICAgICAgIHVzZXIuaWQsXG4gICAgICAgICAgZW1vamlcbiAgICAgICAgKTtcbiAgICAgICAgaW8udG8oY29udmVyc2F0aW9uUm9vbShjb252ZXJzYXRpb25JZCkpLmVtaXQoXCJyZWFjdGlvbjp1cGRhdGVcIiwge1xuICAgICAgICAgIGNvbnZlcnNhdGlvbklkLFxuICAgICAgICAgIG1lc3NhZ2VJZDogbWlkLFxuICAgICAgICAgIHJlYWN0aW9ucyxcbiAgICAgICAgfSk7XG4gICAgICAgIGFjayh7IG9rOiB0cnVlIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBNZXNzYWdlRXJyb3IpIHJldHVybiBhY2soeyBvazogZmFsc2UsIG1lc3NhZ2U6IGVyci5tZXNzYWdlIH0pO1xuICAgICAgICBjb25zb2xlLmVycm9yKFwicmVhY3Rpb246dG9nZ2xlIGVycm9yXCIsIGVycik7XG4gICAgICAgIGFjayh7IG9rOiBmYWxzZSwgbWVzc2FnZTogXCJDb3VsZCBub3QgYWRkIHJlYWN0aW9uLlwiIH0pO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gLS0tIHJlY29ubmVjdCByZWNvbmNpbGlhdGlvbiAtLS1cbiAgICBzb2NrZXQub24oXCJtZXNzYWdlOnN5bmNcIiwgYXN5bmMgKHsgY29udmVyc2F0aW9uSWQsIGFmdGVySWQgfSwgYWNrKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBtZXNzYWdlcyA9IGF3YWl0IGdldE1lc3NhZ2VzQWZ0ZXIoY29udmVyc2F0aW9uSWQsIHVzZXIuaWQsIGFmdGVySWQpO1xuICAgICAgICBhY2soeyBtZXNzYWdlcyB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICBhY2soeyBtZXNzYWdlczogW10gfSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyAtLS0gcmVhZCByZWNlaXB0cyAtLS1cbiAgICBzb2NrZXQub24oXCJtZXNzYWdlOnJlYWRcIiwgYXN5bmMgKHsgY29udmVyc2F0aW9uSWQgfSwgYWNrKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB7IG1lc3NhZ2VJZHMsIHJlYWRBdCB9ID0gYXdhaXQgbWFya0NvbnZlcnNhdGlvblJlYWQoY29udmVyc2F0aW9uSWQsIHVzZXIuaWQpO1xuICAgICAgICBpZiAobWVzc2FnZUlkcy5sZW5ndGgpIHtcbiAgICAgICAgICBpby50byhjb252ZXJzYXRpb25Sb29tKGNvbnZlcnNhdGlvbklkKSkuZW1pdChcIm1lc3NhZ2U6c3RhdHVzXCIsIHtcbiAgICAgICAgICAgIGNvbnZlcnNhdGlvbklkLFxuICAgICAgICAgICAgbWVzc2FnZUlkcyxcbiAgICAgICAgICAgIHN0YXR1czogXCJSRUFEXCIsXG4gICAgICAgICAgICBieTogdXNlci5pZCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBhY2s/Lih7IG9rOiB0cnVlIH0pO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIGFjaz8uKHsgb2s6IGZhbHNlIH0pO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gLS0tIHR5cGluZyBpbmRpY2F0b3JzIC0tLVxuICAgIGNvbnN0IGVtaXRUeXBpbmcgPSAoY29udmVyc2F0aW9uSWQ6IHN0cmluZywgdHlwaW5nOiBib29sZWFuKSA9PiB7XG4gICAgICBzb2NrZXQudG8oY29udmVyc2F0aW9uUm9vbShjb252ZXJzYXRpb25JZCkpLmVtaXQoXCJ0eXBpbmc6dXBkYXRlXCIsIHtcbiAgICAgICAgY29udmVyc2F0aW9uSWQsXG4gICAgICAgIHVzZXJJZDogdXNlci5pZCxcbiAgICAgICAgdHlwaW5nLFxuICAgICAgfSk7XG4gICAgfTtcbiAgICBzb2NrZXQub24oXCJ0eXBpbmc6c3RhcnRcIiwgKHsgY29udmVyc2F0aW9uSWQgfSkgPT4gZW1pdFR5cGluZyhjb252ZXJzYXRpb25JZCwgdHJ1ZSkpO1xuICAgIHNvY2tldC5vbihcInR5cGluZzpzdG9wXCIsICh7IGNvbnZlcnNhdGlvbklkIH0pID0+IGVtaXRUeXBpbmcoY29udmVyc2F0aW9uSWQsIGZhbHNlKSk7XG5cbiAgICBzb2NrZXQub24oXCJwcmVzZW5jZTpwaW5nXCIsICgpID0+IHtcbiAgICAgIHNvY2tldC5lbWl0KFwicHJlc2VuY2U6c25hcHNob3RcIiwgeyBvbmxpbmU6IG9ubGluZVVzZXJJZHMoKSB9KTtcbiAgICB9KTtcblxuICAgIHNvY2tldC5vbihcImRpc2Nvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgYmVjYW1lT2ZmbGluZSA9IHJlbW92ZVNvY2tldCh1c2VyLmlkLCBzb2NrZXQuaWQpO1xuICAgICAgaWYgKGJlY2FtZU9mZmxpbmUpIHtcbiAgICAgICAgc29ja2V0LmJyb2FkY2FzdC5lbWl0KFwicHJlc2VuY2U6dXBkYXRlXCIsIHtcbiAgICAgICAgICB1c2VySWQ6IHVzZXIuaWQsXG4gICAgICAgICAgb25saW5lOiBmYWxzZSxcbiAgICAgICAgICBsYXN0U2VlbjogZ2V0TGFzdFNlZW4odXNlci5pZCksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbn1cblxuZXhwb3J0IHsgaXNPbmxpbmUgfTtcbiIsICJpbXBvcnQgdHlwZSB7IFNlcnZlciBhcyBJT1NlcnZlciB9IGZyb20gXCJzb2NrZXQuaW9cIjtcbmltcG9ydCB0eXBlIHsgQ2xpZW50VG9TZXJ2ZXJFdmVudHMsIFNlcnZlclRvQ2xpZW50RXZlbnRzIH0gZnJvbSBcIi4vZXZlbnRzXCI7XG5pbXBvcnQgeyBjb252ZXJzYXRpb25Sb29tLCB1c2VyUm9vbSB9IGZyb20gXCIuL2V2ZW50c1wiO1xuaW1wb3J0IHR5cGUgeyBNZXNzYWdlRFRPIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCB0eXBlIFR5cGVkU2VydmVyID0gSU9TZXJ2ZXI8Q2xpZW50VG9TZXJ2ZXJFdmVudHMsIFNlcnZlclRvQ2xpZW50RXZlbnRzPjtcblxuY29uc3QgZyA9IGdsb2JhbFRoaXMgYXMgdW5rbm93biBhcyB7IF9fcnRtSU8/OiBUeXBlZFNlcnZlciB9O1xuXG5leHBvcnQgZnVuY3Rpb24gc2V0SU8oaW86IFR5cGVkU2VydmVyKSB7XG4gIGcuX19ydG1JTyA9IGlvO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0SU8oKTogVHlwZWRTZXJ2ZXIgfCBudWxsIHtcbiAgcmV0dXJuIGcuX19ydG1JTyA/PyBudWxsO1xufVxuXG4vKipcbiAqIEZhbiBhIGZyZXNobHktY3JlYXRlZCBtZXNzYWdlIG91dCB0byBldmVyeSBwYXJ0aWNpcGFudC4gQ2FsbGVkIGZyb20gYm90aCB0aGVcbiAqIHNvY2tldCBoYW5kbGVyICh0ZXh0L2dpZi9zdGlja2VyKSBhbmQgdGhlIFJFU1QgdXBsb2FkIHJvdXRlIChpbWFnZXMpLCBzb1xuICogbW9kZXJhdGVkIGltYWdlcyByZWFjaCBjbGllbnRzIG92ZXIgdGhlIHNhbWUgcmVhbC10aW1lIGNoYW5uZWwuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBicm9hZGNhc3RNZXNzYWdlKG1zZzogTWVzc2FnZURUTywgcGFydGljaXBhbnRJZHM6IHN0cmluZ1tdKSB7XG4gIGNvbnN0IGlvID0gZ2V0SU8oKTtcbiAgaWYgKCFpbykgcmV0dXJuO1xuICBpby50byhjb252ZXJzYXRpb25Sb29tKG1zZy5jb252ZXJzYXRpb25JZCkpLmVtaXQoXCJtZXNzYWdlOm5ld1wiLCBtc2cpO1xuICAvLyBhbHNvIG5vdGlmeSBwYXJ0aWNpcGFudHMgbm90IGN1cnJlbnRseSBpbiB0aGUgcm9vbSAoZS5nLiBsaXN0IHZpZXcgb25seSlcbiAgZm9yIChjb25zdCB1aWQgb2YgcGFydGljaXBhbnRJZHMpIHtcbiAgICBpby50byh1c2VyUm9vbSh1aWQpKS5lbWl0KFwibWVzc2FnZTpuZXdcIiwgbXNnKTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gbm90aWZ5Q29udmVyc2F0aW9uQ3JlYXRlZChjb252ZXJzYXRpb25JZDogc3RyaW5nLCBwYXJ0aWNpcGFudElkczogc3RyaW5nW10pIHtcbiAgY29uc3QgaW8gPSBnZXRJTygpO1xuICBpZiAoIWlvKSByZXR1cm47XG4gIGZvciAoY29uc3QgdWlkIG9mIHBhcnRpY2lwYW50SWRzKSB7XG4gICAgaW8udG8odXNlclJvb20odWlkKSkuZW1pdChcImNvbnZlcnNhdGlvbjpuZXdcIiwgY29udmVyc2F0aW9uSWQpO1xuICB9XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsb0JBQU87QUFDUCx1QkFBNkI7QUFDN0Isa0JBQWlCO0FBQ2pCLG9CQUFtQzs7O0FDRm5DLGlCQUFrQjtBQUVsQixJQUFNLFNBQVMsYUFBRSxPQUFPO0FBQUEsRUFDdEIsY0FBYyxhQUFFLE9BQU8sRUFBRSxJQUFJLENBQUM7QUFBQSxFQUM5QixhQUFhLGFBQUUsT0FBTyxFQUFFLElBQUksSUFBSSw0Q0FBNEM7QUFBQSxFQUM1RSxhQUFhLGFBQUUsT0FBTyxFQUFFLFFBQVEsYUFBYTtBQUFBLEVBQzdDLE1BQU0sYUFBRSxPQUFPLE9BQU8sRUFBRSxRQUFRLEdBQUk7QUFBQSxFQUNwQyxVQUFVLGFBQUUsT0FBTyxFQUFFLFFBQVEsV0FBVztBQUFBLEVBQ3hDLFlBQVksYUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLFFBQVEsdUJBQXVCO0FBQUEsRUFDNUQsZUFBZSxhQUFFLE9BQU8sRUFBRSxJQUFJLENBQUM7QUFBQSxFQUMvQixhQUFhLGFBQUUsT0FBTyxFQUFFLFFBQVEsV0FBVztBQUFBLEVBQzNDLGtCQUFrQixhQUFFLE9BQU8sT0FBTyxFQUFFLFFBQVEsT0FBUztBQUFBLEVBQ3JELGdCQUFnQixhQUFFLE9BQU8sRUFBRSxRQUFRLHNCQUFzQjtBQUFBLEVBQ3pELGdCQUFnQixhQUFFLE9BQU8sT0FBTyxFQUFFLFFBQVEsR0FBRztBQUMvQyxDQUFDO0FBRU0sSUFBTSxNQUFNLE9BQU8sTUFBTSxRQUFRLEdBQUc7OztBQ2pCM0Msa0JBQW1DO0FBQ25DLHNCQUFtQjtBQUNuQixvQkFBcUM7OztBQ0ZyQyxvQkFBNkI7QUFFN0IsSUFBTSxrQkFBa0I7QUFFakIsSUFBTSxTQUNYLGdCQUFnQixVQUNoQixJQUFJLDJCQUFhO0FBQUEsRUFDZixLQUFLLFFBQVEsSUFBSSxhQUFhLGdCQUFnQixDQUFDLFFBQVEsT0FBTyxJQUFJLENBQUMsT0FBTztBQUM1RSxDQUFDO0FBRUgsSUFBSSxRQUFRLElBQUksYUFBYSxhQUFjLGlCQUFnQixTQUFTOzs7QURDcEUsSUFBTSxTQUFTLElBQUksWUFBWSxFQUFFLE9BQU8sSUFBSSxXQUFXO0FBQ2hELElBQU0sa0JBQWtCLEtBQUssS0FBSyxLQUFLO0FBNEI5QyxlQUFzQixtQkFBbUIsT0FBK0M7QUFDdEYsTUFBSTtBQUNGLFVBQU0sRUFBRSxRQUFRLElBQUksVUFBTSx1QkFBVSxPQUFPLE1BQU07QUFDakQsUUFBSSxDQUFDLFFBQVEsSUFBSyxRQUFPO0FBQ3pCLFdBQU8sRUFBRSxLQUFLLFFBQVEsS0FBSyxVQUFVLE9BQU8sUUFBUSxZQUFZLEVBQUUsRUFBRTtBQUFBLEVBQ3RFLFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNGO0FBWUEsZUFBc0IsU0FBUyxJQUF5QztBQUN0RSxTQUFPLE9BQU8sS0FBSyxXQUFXO0FBQUEsSUFDNUIsT0FBTyxFQUFFLEdBQUc7QUFBQSxJQUNaLFFBQVEsRUFBRSxJQUFJLE1BQU0sVUFBVSxNQUFNLGFBQWEsTUFBTSxhQUFhLEtBQUs7QUFBQSxFQUMzRSxDQUFDO0FBQ0g7QUFHQSxlQUFzQiwrQkFDcEIsY0FDNkI7QUFDN0IsTUFBSSxDQUFDLGFBQWMsUUFBTztBQUMxQixRQUFNLFlBQVEsY0FBQUEsT0FBWSxZQUFZLEVBQUUsSUFBSSxXQUFXO0FBQ3ZELE1BQUksQ0FBQyxNQUFPLFFBQU87QUFDbkIsUUFBTSxVQUFVLE1BQU0sbUJBQW1CLEtBQUs7QUFDOUMsTUFBSSxDQUFDLFFBQVMsUUFBTztBQUNyQixTQUFPLFNBQVMsUUFBUSxHQUFHO0FBQzdCOzs7QUUzQk8sSUFBTSxXQUFXLENBQUMsV0FBbUIsUUFBUSxNQUFNO0FBQ25ELElBQU0sbUJBQW1CLENBQUMsbUJBQTJCLGdCQUFnQixjQUFjOzs7QUMvQzFGLElBQU0sVUFBVSxvQkFBSSxJQUF5QjtBQUM3QyxJQUFNLFdBQVcsb0JBQUksSUFBb0I7QUFFbEMsU0FBUyxVQUFVLFFBQWdCLFVBQTJCO0FBQ25FLFFBQU0sTUFBTSxRQUFRLElBQUksTUFBTSxLQUFLLG9CQUFJLElBQVk7QUFDbkQsUUFBTSxhQUFhLElBQUksU0FBUztBQUNoQyxNQUFJLElBQUksUUFBUTtBQUNoQixVQUFRLElBQUksUUFBUSxHQUFHO0FBQ3ZCLFNBQU87QUFDVDtBQUVPLFNBQVMsYUFBYSxRQUFnQixVQUEyQjtBQUN0RSxRQUFNLE1BQU0sUUFBUSxJQUFJLE1BQU07QUFDOUIsTUFBSSxDQUFDLElBQUssUUFBTztBQUNqQixNQUFJLE9BQU8sUUFBUTtBQUNuQixNQUFJLElBQUksU0FBUyxHQUFHO0FBQ2xCLFlBQVEsT0FBTyxNQUFNO0FBQ3JCLGFBQVMsSUFBSSxTQUFRLG9CQUFJLEtBQUssR0FBRSxZQUFZLENBQUM7QUFDN0MsV0FBTztBQUFBLEVBQ1Q7QUFDQSxTQUFPO0FBQ1Q7QUFNTyxTQUFTLGdCQUEwQjtBQUN4QyxTQUFPLENBQUMsR0FBRyxRQUFRLEtBQUssQ0FBQztBQUMzQjtBQUVPLFNBQVMsWUFBWSxRQUF3QjtBQUNsRCxTQUFPLFNBQVMsSUFBSSxNQUFNLE1BQUssb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFDeEQ7OztBQzVCQSxJQUFNLFVBQVUsb0JBQUksSUFBb0I7QUFRakMsU0FBUyxVQUFVLEtBQWEsT0FBZSxVQUFtQztBQUN2RixRQUFNLE1BQU0sS0FBSyxJQUFJO0FBQ3JCLFFBQU0sV0FBVyxRQUFRLElBQUksR0FBRztBQUVoQyxNQUFJLENBQUMsWUFBWSxTQUFTLFdBQVcsS0FBSztBQUN4QyxZQUFRLElBQUksS0FBSyxFQUFFLE9BQU8sR0FBRyxTQUFTLE1BQU0sU0FBUyxDQUFDO0FBQ3RELFdBQU8sRUFBRSxJQUFJLE1BQU0sV0FBVyxRQUFRLEdBQUcsY0FBYyxFQUFFO0FBQUEsRUFDM0Q7QUFFQSxNQUFJLFNBQVMsU0FBUyxPQUFPO0FBQzNCLFdBQU8sRUFBRSxJQUFJLE9BQU8sV0FBVyxHQUFHLGNBQWMsU0FBUyxVQUFVLElBQUk7QUFBQSxFQUN6RTtBQUVBLFdBQVMsU0FBUztBQUNsQixTQUFPLEVBQUUsSUFBSSxNQUFNLFdBQVcsUUFBUSxTQUFTLE9BQU8sY0FBYyxFQUFFO0FBQ3hFO0FBR0EsWUFBWSxNQUFNO0FBQ2hCLFFBQU0sTUFBTSxLQUFLLElBQUk7QUFDckIsYUFBVyxDQUFDLEtBQUssTUFBTSxLQUFLLFNBQVM7QUFDbkMsUUFBSSxPQUFPLFdBQVcsSUFBSyxTQUFRLE9BQU8sR0FBRztBQUFBLEVBQy9DO0FBQ0YsR0FBRyxHQUFNLEVBQUUsUUFBUTtBQUVaLElBQU0sY0FBYztBQUFBLEVBQ3pCLE1BQU0sRUFBRSxPQUFPLElBQUksVUFBVSxJQUFPO0FBQUEsRUFDcEMsUUFBUSxFQUFFLE9BQU8sSUFBSSxVQUFVLElBQU87QUFBQSxFQUN0QyxNQUFNLEVBQUUsT0FBTyxJQUFJLFVBQVUsSUFBTztBQUFBLEVBQ3BDLE9BQU8sRUFBRSxPQUFPLElBQUksVUFBVSxJQUFPO0FBQUEsRUFDckMsb0JBQW9CLEVBQUUsT0FBTyxJQUFJLFVBQVUsSUFBTztBQUFBLEVBQ2xELFVBQVUsRUFBRSxPQUFPLElBQUksVUFBVSxJQUFPO0FBQzFDOzs7QUN6Q0EsSUFBTSxrQkFBa0I7QUFFeEIsSUFBTSxXQUFtQztBQUFBLEVBQ3ZDLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFBQSxFQUNMLEtBQUs7QUFDUDtBQUVBLElBQU0sYUFBcUM7QUFBQSxFQUN6QyxVQUFLO0FBQUE7QUFBQSxFQUNMLFVBQUs7QUFBQTtBQUFBLEVBQ0wsVUFBSztBQUFBO0FBQUEsRUFDTCxVQUFLO0FBQUE7QUFBQSxFQUNMLFVBQUs7QUFBQTtBQUFBLEVBQ0wsVUFBSztBQUFBO0FBQUEsRUFDTCxVQUFLO0FBQUE7QUFBQSxFQUNMLFVBQUs7QUFBQTtBQUFBLEVBQ0wsVUFBSztBQUFBO0FBQ1A7QUFFQSxTQUFTLE1BQU0sSUFBb0I7QUFDakMsU0FBTyxXQUFXLEVBQUUsS0FBSyxTQUFTLEVBQUUsS0FBSztBQUMzQztBQUdPLFNBQVMsZUFBZSxLQUFxQjtBQUNsRCxNQUFJLElBQUksSUFBSSxZQUFZLEVBQUUsVUFBVSxNQUFNLEVBQUUsUUFBUSxpQkFBaUIsRUFBRTtBQUN2RSxNQUFJLEVBQUUsTUFBTSxFQUFFLEVBQUUsSUFBSSxLQUFLLEVBQUUsS0FBSyxFQUFFO0FBQ2xDLE1BQUksRUFBRSxRQUFRLFdBQVcsRUFBRTtBQUUzQixNQUFJLEVBQUUsUUFBUSxjQUFjLElBQUk7QUFDaEMsU0FBTztBQUNUO0FBTU8sU0FBUyxnQkFBZ0IsTUFBc0I7QUFDcEQsU0FBTyxLQUNKLFlBQVksRUFDWixVQUFVLE1BQU0sRUFDaEIsUUFBUSxpQkFBaUIsRUFBRSxFQUMzQixNQUFNLEVBQUUsRUFDUixJQUFJLEtBQUssRUFDVCxLQUFLLEVBQUUsRUFDUCxRQUFRLFdBQVcsRUFBRSxFQUNyQixRQUFRLGNBQWMsSUFBSTtBQUMvQjtBQUVPLFNBQVMsU0FBUyxNQUF3QjtBQUMvQyxTQUFPLEtBQUssTUFBTSxLQUFLLEVBQUUsT0FBTyxPQUFPO0FBQ3pDOzs7QUNyREEsSUFBTSxZQUFZO0FBQUEsRUFDaEI7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFDRjtBQUdBLElBQU0sWUFBWSxvQkFBSSxJQUFJO0FBQUEsRUFDeEI7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQ0YsQ0FBQztBQU1NLFNBQVMsZUFBZSxNQUErQjtBQUM1RCxRQUFNLFVBQVUsb0JBQUksSUFBWTtBQUdoQyxhQUFXLFNBQVMsU0FBUyxJQUFJLEdBQUc7QUFDbEMsVUFBTSxPQUFPLGVBQWUsS0FBSztBQUNqQyxRQUFJLENBQUMsUUFBUSxVQUFVLElBQUksSUFBSSxFQUFHO0FBQ2xDLGVBQVcsT0FBTyxXQUFXO0FBQzNCLFVBQUksU0FBUyxJQUFLLFNBQVEsSUFBSSxHQUFHO0FBQUEsSUFDbkM7QUFBQSxFQUNGO0FBR0EsUUFBTSxZQUFZLGdCQUFnQixJQUFJO0FBQ3RDLE1BQUksVUFBVSxVQUFVLEtBQUs7QUFDM0IsZUFBVyxPQUFPLFdBQVc7QUFDM0IsVUFBSSxDQUFDLFVBQVUsU0FBUyxHQUFHLEVBQUc7QUFFOUIsWUFBTSxjQUFjLENBQUMsR0FBRyxTQUFTLEVBQUU7QUFBQSxRQUNqQyxDQUFDLE1BQU0sRUFBRSxTQUFTLEdBQUcsS0FBSyxVQUFVLFNBQVMsQ0FBQztBQUFBLE1BQ2hEO0FBQ0EsVUFBSSxDQUFDLFlBQWEsU0FBUSxJQUFJLEdBQUc7QUFBQSxJQUNuQztBQUFBLEVBQ0Y7QUFFQSxNQUFJLFFBQVEsU0FBUyxFQUFHLFFBQU8sRUFBRSxPQUFPLEtBQUs7QUFDN0MsU0FBTyxFQUFFLE9BQU8sT0FBTyxTQUFTLENBQUMsR0FBRyxPQUFPLEVBQUU7QUFDL0M7OztBQ25HQSxJQUFBQyxpQkFBdUI7OztBQ2V2QixTQUFTLFdBQVcsR0FBMkM7QUFDN0QsVUFBUSxFQUFFLE1BQU07QUFBQSxJQUNkLEtBQUs7QUFDSCxhQUFPO0FBQUEsSUFDVCxLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1QsS0FBSztBQUNILGFBQU87QUFBQSxJQUNUO0FBQ0UsYUFBTyxFQUFFLEtBQUssU0FBUyxNQUFNLEdBQUcsRUFBRSxLQUFLLE1BQU0sR0FBRyxHQUFHLENBQUMsV0FBTSxFQUFFO0FBQUEsRUFDaEU7QUFDRjtBQUVBLFNBQVMsZUFBZSxZQUErQixDQUFDLEdBQW9CO0FBQzFFLFFBQU0sTUFBTSxvQkFBSSxJQUEyQjtBQUMzQyxhQUFXLEtBQUssV0FBVztBQUN6QixVQUFNQyxLQUFJLElBQUksSUFBSSxFQUFFLEtBQUssS0FBSyxFQUFFLE9BQU8sRUFBRSxPQUFPLE9BQU8sR0FBRyxTQUFTLENBQUMsRUFBRTtBQUN0RSxJQUFBQSxHQUFFLFNBQVM7QUFDWCxJQUFBQSxHQUFFLFFBQVEsS0FBSyxFQUFFLE1BQU07QUFDdkIsUUFBSSxJQUFJLEVBQUUsT0FBT0EsRUFBQztBQUFBLEVBQ3BCO0FBQ0EsU0FBTyxDQUFDLEdBQUcsSUFBSSxPQUFPLENBQUMsRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxNQUFNLGNBQWMsRUFBRSxLQUFLLENBQUM7QUFDN0Y7QUFFTyxTQUFTLGFBQWEsR0FBcUM7QUFDaEUsUUFBTSxVQUErQixFQUFFLFVBQ25DO0FBQUEsSUFDRSxJQUFJLEVBQUUsUUFBUTtBQUFBLElBQ2QsVUFBVSxFQUFFLFFBQVE7QUFBQSxJQUNwQixNQUFNLEVBQUUsUUFBUTtBQUFBLElBQ2hCLFNBQVMsV0FBVyxFQUFFLE9BQU87QUFBQSxFQUMvQixJQUNBO0FBRUosU0FBTztBQUFBLElBQ0wsSUFBSSxFQUFFO0FBQUEsSUFDTixVQUFVLEVBQUU7QUFBQSxJQUNaLGdCQUFnQixFQUFFO0FBQUEsSUFDbEIsVUFBVSxFQUFFO0FBQUEsSUFDWixNQUFNLEVBQUU7QUFBQSxJQUNSLE1BQU0sRUFBRTtBQUFBLElBQ1IsVUFBVyxFQUFFLFlBQXVDO0FBQUEsSUFDcEQsUUFBUSxFQUFFO0FBQUEsSUFDVixXQUFXLEVBQUUsVUFBVSxZQUFZO0FBQUEsSUFDbkMsU0FBUyxFQUFFLFNBQVMsQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsTUFBTTtBQUFBLElBQzNDLFdBQVcsZUFBZSxFQUFFLFNBQVM7QUFBQSxJQUNyQztBQUFBLEVBQ0Y7QUFDRjtBQXdDTyxJQUFNLGlCQUFpQjtBQUFBLEVBQzVCLE9BQU87QUFBQSxFQUNQLFdBQVc7QUFBQSxFQUNYLFNBQVM7QUFDWDs7O0FDbEdBLGVBQXNCLFNBQVMsZ0JBQXdCLFFBQWtDO0FBQ3ZGLFFBQU0sUUFBUSxNQUFNLE9BQU8sbUJBQW1CLE1BQU07QUFBQSxJQUNsRCxPQUFPLEVBQUUsZ0JBQWdCLE9BQU87QUFBQSxFQUNsQyxDQUFDO0FBQ0QsU0FBTyxRQUFRO0FBQ2pCO0FBRUEsZUFBc0IsYUFBYSxnQkFBMkM7QUFDNUUsUUFBTSxPQUFPLE1BQU0sT0FBTyxtQkFBbUIsU0FBUztBQUFBLElBQ3BELE9BQU8sRUFBRSxlQUFlO0FBQUEsSUFDeEIsUUFBUSxFQUFFLFFBQVEsS0FBSztBQUFBLEVBQ3pCLENBQUM7QUFDRCxTQUFPLEtBQUssSUFBSSxDQUFDLE1BQU0sRUFBRSxNQUFNO0FBQ2pDOzs7QUZSTyxJQUFNLGVBQU4sY0FBMkIsTUFBTTtBQUFBLEVBQ3RDLFlBQW1CLE1BQTZDLFNBQWlCO0FBQy9FLFVBQU0sT0FBTztBQURJO0FBQUEsRUFFbkI7QUFDRjtBQVlBLElBQU0saUJBQWlCLENBQUMsYUFBTSxnQkFBTSxhQUFNLGFBQU0sYUFBTSxhQUFNLGFBQU0sV0FBSTtBQU90RSxlQUFzQixjQUFjLE9BQXdFO0FBQzFHLE1BQUksQ0FBRSxNQUFNLFNBQVMsTUFBTSxnQkFBZ0IsTUFBTSxRQUFRLEdBQUk7QUFDM0QsVUFBTSxJQUFJLGFBQWEsYUFBYSw0Q0FBNEM7QUFBQSxFQUNsRjtBQUVBLFFBQU0sUUFBUSxNQUFNLFFBQVEsSUFBSSxLQUFLO0FBQ3JDLE1BQUksTUFBTSxTQUFTLFVBQVUsQ0FBQyxNQUFNO0FBQ2xDLFVBQU0sSUFBSSxhQUFhLFdBQVcsMEJBQTBCO0FBQUEsRUFDOUQ7QUFDQSxNQUFJLE1BQU0sU0FBUyxVQUFVLEtBQUssU0FBUyxLQUFNO0FBQy9DLFVBQU0sSUFBSSxhQUFhLFdBQVcsc0JBQXNCO0FBQUEsRUFDMUQ7QUFDQSxPQUFLLE1BQU0sU0FBUyxTQUFTLE1BQU0sU0FBUyxhQUFhLE1BQU0sU0FBUyxZQUFZLENBQUMsTUFBTSxVQUFVLEtBQUs7QUFDeEcsVUFBTSxJQUFJLGFBQWEsV0FBVywwQkFBMEI7QUFBQSxFQUM5RDtBQUdBLE1BQUksTUFBTSxXQUFXO0FBQ25CLFVBQU0sU0FBUyxNQUFNLE9BQU8sUUFBUSxXQUFXO0FBQUEsTUFDN0MsT0FBTyxFQUFFLElBQUksTUFBTSxVQUFVO0FBQUEsTUFDN0IsUUFBUSxFQUFFLGdCQUFnQixLQUFLO0FBQUEsSUFDakMsQ0FBQztBQUNELFFBQUksQ0FBQyxVQUFVLE9BQU8sbUJBQW1CLE1BQU0sZ0JBQWdCO0FBQzdELFlBQU0sSUFBSSxhQUFhLFdBQVcsa0RBQWtEO0FBQUEsSUFDdEY7QUFBQSxFQUNGO0FBRUEsTUFBSTtBQUNGLFVBQU0sVUFBVSxNQUFNLE9BQU8sYUFBYSxPQUFPLE9BQU87QUFDdEQsWUFBTSxVQUFVLE1BQU0sR0FBRyxRQUFRLE9BQU87QUFBQSxRQUN0QyxNQUFNO0FBQUEsVUFDSixnQkFBZ0IsTUFBTTtBQUFBLFVBQ3RCLFVBQVUsTUFBTTtBQUFBLFVBQ2hCLFVBQVUsTUFBTTtBQUFBLFVBQ2hCLE1BQU0sTUFBTTtBQUFBLFVBQ1o7QUFBQSxVQUNBLFVBQVcsTUFBTSxZQUFZLHNCQUFPO0FBQUEsVUFDcEMsUUFBUTtBQUFBLFVBQ1IsV0FBVyxNQUFNLGFBQWE7QUFBQSxRQUNoQztBQUFBLFFBQ0EsU0FBUztBQUFBLE1BQ1gsQ0FBQztBQUNELFlBQU0sR0FBRyxhQUFhLE9BQU87QUFBQSxRQUMzQixPQUFPLEVBQUUsSUFBSSxNQUFNLGVBQWU7QUFBQSxRQUNsQyxNQUFNLEVBQUUsV0FBVyxvQkFBSSxLQUFLLEVBQUU7QUFBQSxNQUNoQyxDQUFDO0FBQ0QsYUFBTztBQUFBLElBQ1QsQ0FBQztBQUNELFdBQU8sRUFBRSxTQUFTLGFBQWEsT0FBTyxHQUFHLFNBQVMsS0FBSztBQUFBLEVBQ3pELFNBQVMsS0FBSztBQUNaLFFBQUksZUFBZSxzQkFBTyxpQ0FBaUMsSUFBSSxTQUFTLFNBQVM7QUFDL0UsWUFBTSxXQUFXLE1BQU0sT0FBTyxRQUFRLFdBQVc7QUFBQSxRQUMvQyxPQUFPO0FBQUEsVUFDTCx5QkFBeUI7QUFBQSxZQUN2QixnQkFBZ0IsTUFBTTtBQUFBLFlBQ3RCLFVBQVUsTUFBTTtBQUFBLFVBQ2xCO0FBQUEsUUFDRjtBQUFBLFFBQ0EsU0FBUztBQUFBLE1BQ1gsQ0FBQztBQUNELFVBQUksU0FBVSxRQUFPLEVBQUUsU0FBUyxhQUFhLFFBQVEsR0FBRyxTQUFTLE1BQU07QUFBQSxJQUN6RTtBQUNBLFVBQU07QUFBQSxFQUNSO0FBQ0Y7QUFvQ0EsZUFBc0IsaUJBQ3BCLGdCQUNBLFFBQ0EsU0FDdUI7QUFDdkIsTUFBSSxDQUFFLE1BQU0sU0FBUyxnQkFBZ0IsTUFBTSxHQUFJO0FBQzdDLFVBQU0sSUFBSSxhQUFhLGFBQWEsZUFBZTtBQUFBLEVBQ3JEO0FBQ0EsTUFBSSxRQUFxQjtBQUN6QixNQUFJLFNBQVM7QUFDWCxVQUFNLFNBQVMsTUFBTSxPQUFPLFFBQVEsV0FBVyxFQUFFLE9BQU8sRUFBRSxJQUFJLFFBQVEsR0FBRyxRQUFRLEVBQUUsV0FBVyxLQUFLLEVBQUUsQ0FBQztBQUN0RyxZQUFRLFFBQVEsYUFBYTtBQUFBLEVBQy9CO0FBQ0EsUUFBTSxPQUFPLE1BQU0sT0FBTyxRQUFRLFNBQVM7QUFBQSxJQUN6QyxPQUFPLEVBQUUsZ0JBQWdCLEdBQUksUUFBUSxFQUFFLFdBQVcsRUFBRSxJQUFJLE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRztBQUFBLElBQ3hFLFNBQVMsQ0FBQyxFQUFFLFdBQVcsTUFBTSxHQUFHLEVBQUUsSUFBSSxNQUFNLENBQUM7QUFBQSxJQUM3QyxNQUFNO0FBQUEsSUFDTixTQUFTO0FBQUEsRUFDWCxDQUFDO0FBQ0QsU0FBTyxLQUFLLElBQUksWUFBWTtBQUM5QjtBQU1BLGVBQXNCLHFCQUNwQixnQkFDQSxRQUNpRDtBQUNqRCxNQUFJLENBQUUsTUFBTSxTQUFTLGdCQUFnQixNQUFNLEdBQUk7QUFDN0MsVUFBTSxJQUFJLGFBQWEsYUFBYSxlQUFlO0FBQUEsRUFDckQ7QUFDQSxRQUFNLFNBQVMsb0JBQUksS0FBSztBQUN4QixRQUFNLFNBQVMsTUFBTSxPQUFPLFFBQVEsU0FBUztBQUFBLElBQzNDLE9BQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxVQUFVLEVBQUUsS0FBSyxPQUFPO0FBQUEsTUFDeEIsT0FBTyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUU7QUFBQSxJQUM1QjtBQUFBLElBQ0EsUUFBUSxFQUFFLElBQUksS0FBSztBQUFBLEVBQ3JCLENBQUM7QUFFRCxNQUFJLE9BQU8sU0FBUyxHQUFHO0FBQ3JCLFVBQU0sT0FBTyxhQUFhO0FBQUEsTUFDeEIsT0FBTyxZQUFZLFdBQVc7QUFBQSxRQUM1QixNQUFNLE9BQU8sSUFBSSxDQUFDLE9BQU8sRUFBRSxXQUFXLEVBQUUsSUFBSSxRQUFRLE9BQU8sRUFBRTtBQUFBLFFBQzdELGdCQUFnQjtBQUFBLE1BQ2xCLENBQUM7QUFBQSxNQUNELE9BQU8sUUFBUSxXQUFXO0FBQUEsUUFDeEIsT0FBTyxFQUFFLElBQUksRUFBRSxJQUFJLE9BQU8sSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFLEVBQUUsRUFBRTtBQUFBLFFBQzdDLE1BQU0sRUFBRSxRQUFRLE9BQU87QUFBQSxNQUN6QixDQUFDO0FBQUEsSUFDSCxDQUFDO0FBQUEsRUFDSDtBQUVBLFFBQU0sT0FBTyxtQkFBbUIsT0FBTztBQUFBLElBQ3JDLE9BQU8sRUFBRSx1QkFBdUIsRUFBRSxnQkFBZ0IsT0FBTyxFQUFFO0FBQUEsSUFDM0QsTUFBTSxFQUFFLFlBQVksT0FBTztBQUFBLEVBQzdCLENBQUM7QUFFRCxTQUFPLEVBQUUsWUFBWSxPQUFPLElBQUksQ0FBQyxNQUFNLEVBQUUsRUFBRSxHQUFHLE9BQU87QUFDdkQ7QUFVQSxlQUFzQixlQUNwQixXQUNBLFFBQ0EsT0FDb0Y7QUFDcEYsTUFBSSxDQUFDLGVBQWUsU0FBUyxLQUFLLEdBQUc7QUFDbkMsVUFBTSxJQUFJLGFBQWEsV0FBVyx1QkFBdUI7QUFBQSxFQUMzRDtBQUNBLFFBQU0sVUFBVSxNQUFNLE9BQU8sUUFBUSxXQUFXO0FBQUEsSUFDOUMsT0FBTyxFQUFFLElBQUksVUFBVTtBQUFBLElBQ3ZCLFFBQVEsRUFBRSxnQkFBZ0IsS0FBSztBQUFBLEVBQ2pDLENBQUM7QUFDRCxNQUFJLENBQUMsUUFBUyxPQUFNLElBQUksYUFBYSxhQUFhLG9CQUFvQjtBQUN0RSxNQUFJLENBQUUsTUFBTSxTQUFTLFFBQVEsZ0JBQWdCLE1BQU0sR0FBSTtBQUNyRCxVQUFNLElBQUksYUFBYSxhQUFhLDRDQUE0QztBQUFBLEVBQ2xGO0FBRUEsUUFBTSxXQUFXLE1BQU0sT0FBTyxnQkFBZ0IsV0FBVztBQUFBLElBQ3ZELE9BQU8sRUFBRSx3QkFBd0IsRUFBRSxXQUFXLFFBQVEsTUFBTSxFQUFFO0FBQUEsRUFDaEUsQ0FBQztBQUNELE1BQUksVUFBVTtBQUNaLFVBQU0sT0FBTyxnQkFBZ0IsT0FBTyxFQUFFLE9BQU8sRUFBRSxJQUFJLFNBQVMsR0FBRyxFQUFFLENBQUM7QUFBQSxFQUNwRSxPQUFPO0FBQ0wsVUFBTSxPQUFPLGdCQUFnQixPQUFPLEVBQUUsTUFBTSxFQUFFLFdBQVcsUUFBUSxNQUFNLEVBQUUsQ0FBQztBQUFBLEVBQzVFO0FBRUEsUUFBTSxNQUFNLE1BQU0sT0FBTyxnQkFBZ0IsU0FBUyxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsQ0FBQztBQUMxRSxRQUFNLE1BQU0sb0JBQUksSUFBMkI7QUFDM0MsYUFBVyxLQUFLLEtBQUs7QUFDbkIsVUFBTUMsS0FBSSxJQUFJLElBQUksRUFBRSxLQUFLLEtBQUssRUFBRSxPQUFPLEVBQUUsT0FBTyxPQUFPLEdBQUcsU0FBUyxDQUFDLEVBQUU7QUFDdEUsSUFBQUEsR0FBRSxTQUFTO0FBQ1gsSUFBQUEsR0FBRSxRQUFRLEtBQUssRUFBRSxNQUFNO0FBQ3ZCLFFBQUksSUFBSSxFQUFFLE9BQU9BLEVBQUM7QUFBQSxFQUNwQjtBQUNBLFFBQU0sWUFBWSxDQUFDLEdBQUcsSUFBSSxPQUFPLENBQUMsRUFBRTtBQUFBLElBQ2xDLENBQUMsR0FBRyxNQUFNLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxNQUFNLGNBQWMsRUFBRSxLQUFLO0FBQUEsRUFDOUQ7QUFDQSxTQUFPLEVBQUUsZ0JBQWdCLFFBQVEsZ0JBQWdCLFdBQVcsVUFBVTtBQUN4RTtBQUdBLGVBQXNCLGNBQWMsZ0JBQXdCLGFBQXdDO0FBQ2xHLFFBQU0sVUFBVSxNQUFNLE9BQU8sUUFBUSxTQUFTO0FBQUEsSUFDNUMsT0FBTyxFQUFFLGdCQUFnQixVQUFVLEVBQUUsS0FBSyxZQUFZLEdBQUcsUUFBUSxPQUFPO0FBQUEsSUFDeEUsUUFBUSxFQUFFLElBQUksS0FBSztBQUFBLEVBQ3JCLENBQUM7QUFDRCxNQUFJLFFBQVEsV0FBVyxFQUFHLFFBQU8sQ0FBQztBQUNsQyxRQUFNLE9BQU8sUUFBUSxXQUFXO0FBQUEsSUFDOUIsT0FBTyxFQUFFLElBQUksRUFBRSxJQUFJLFFBQVEsSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFLEVBQUUsRUFBRTtBQUFBLElBQzlDLE1BQU0sRUFBRSxRQUFRLFlBQVk7QUFBQSxFQUM5QixDQUFDO0FBQ0QsU0FBTyxRQUFRLElBQUksQ0FBQyxNQUFNLEVBQUUsRUFBRTtBQUNoQzs7O0FHL09PLFNBQVMsdUJBQXVCLElBQWlCO0FBRXRELEtBQUcsSUFBSSxPQUFPLFFBQVFDLFVBQVM7QUFDN0IsVUFBTSxPQUFPLE1BQU0sK0JBQStCLE9BQU8sVUFBVSxRQUFRLE1BQU07QUFDakYsUUFBSSxDQUFDLEtBQU0sUUFBT0EsTUFBSyxJQUFJLE1BQU0sY0FBYyxDQUFDO0FBQ2hELElBQUMsT0FBTyxLQUErQixPQUFPO0FBQzlDLElBQUFBLE1BQUs7QUFBQSxFQUNQLENBQUM7QUFFRCxLQUFHLEdBQUcsY0FBYyxDQUFDLFdBQXdCO0FBQzNDLFVBQU0sT0FBTyxPQUFPLEtBQUs7QUFLekIsVUFBTSxZQUFZO0FBQ2hCLFVBQUk7QUFDRixlQUFPLEtBQUssU0FBUyxLQUFLLEVBQUUsQ0FBQztBQUM3QixjQUFNLGNBQWMsTUFBTSxPQUFPLG1CQUFtQixTQUFTO0FBQUEsVUFDM0QsT0FBTyxFQUFFLFFBQVEsS0FBSyxHQUFHO0FBQUEsVUFDekIsUUFBUSxFQUFFLGdCQUFnQixLQUFLO0FBQUEsUUFDakMsQ0FBQztBQUNELG1CQUFXLEtBQUssWUFBYSxRQUFPLEtBQUssaUJBQWlCLEVBQUUsY0FBYyxDQUFDO0FBRTNFLGNBQU0sZUFBZSxVQUFVLEtBQUssSUFBSSxPQUFPLEVBQUU7QUFDakQsZUFBTyxLQUFLLHFCQUFxQixFQUFFLFFBQVEsY0FBYyxFQUFFLENBQUM7QUFDNUQsWUFBSSxjQUFjO0FBQ2hCLGlCQUFPLFVBQVUsS0FBSyxtQkFBbUI7QUFBQSxZQUN2QyxRQUFRLEtBQUs7QUFBQSxZQUNiLFFBQVE7QUFBQSxZQUNSLFdBQVUsb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxVQUNuQyxDQUFDO0FBQUEsUUFDSDtBQUVBLG1CQUFXLEtBQUssYUFBYTtBQUMzQixnQkFBTSxNQUFNLE1BQU0sY0FBYyxFQUFFLGdCQUFnQixLQUFLLEVBQUU7QUFDekQsY0FBSSxJQUFJLFFBQVE7QUFDZCxlQUFHLEdBQUcsaUJBQWlCLEVBQUUsY0FBYyxDQUFDLEVBQUUsS0FBSyxrQkFBa0I7QUFBQSxjQUMvRCxnQkFBZ0IsRUFBRTtBQUFBLGNBQ2xCLFlBQVk7QUFBQSxjQUNaLFFBQVE7QUFBQSxjQUNSLElBQUksS0FBSztBQUFBLFlBQ1gsQ0FBQztBQUFBLFVBQ0g7QUFBQSxRQUNGO0FBQUEsTUFDRixTQUFTLEtBQUs7QUFDWixnQkFBUSxNQUFNLGlDQUFpQyxHQUFHO0FBQUEsTUFDcEQ7QUFBQSxJQUNGLEdBQUc7QUFHSCxXQUFPLEdBQUcsZ0JBQWdCLE9BQU8sT0FBTyxRQUFRO0FBQzlDLFVBQUk7QUFDRixjQUFNLEtBQUssVUFBVSxRQUFRLEtBQUssRUFBRSxJQUFJLFlBQVksS0FBSyxPQUFPLFlBQVksS0FBSyxRQUFRO0FBQ3pGLFlBQUksQ0FBQyxHQUFHLElBQUk7QUFDVixpQkFBTyxJQUFJLEVBQUUsSUFBSSxPQUFPLE1BQU0sZ0JBQWdCLFNBQVMsd0RBQXdELENBQUM7QUFBQSxRQUNsSDtBQUNBLFlBQUksQ0FBQyxDQUFDLFFBQVEsT0FBTyxTQUFTLEVBQUUsU0FBUyxNQUFNLElBQUksR0FBRztBQUNwRCxpQkFBTyxJQUFJLEVBQUUsSUFBSSxPQUFPLE1BQU0sV0FBVyxTQUFTLDZDQUE2QyxDQUFDO0FBQUEsUUFDbEc7QUFDQSxZQUFJLENBQUUsTUFBTSxTQUFTLE1BQU0sZ0JBQWdCLEtBQUssRUFBRSxHQUFJO0FBQ3BELGlCQUFPLElBQUksRUFBRSxJQUFJLE9BQU8sTUFBTSxhQUFhLFNBQVMseUNBQXlDLENBQUM7QUFBQSxRQUNoRztBQUlBLGNBQU0sYUFBYSxDQUFDLE1BQU0sUUFBUSxJQUFJLE1BQU0sVUFBVSxTQUFTLEVBQUUsRUFBRSxLQUFLLEdBQUcsRUFBRSxLQUFLO0FBQ2xGLFlBQUksWUFBWTtBQUNkLGdCQUFNLFVBQVUsZUFBZSxVQUFVO0FBQ3pDLGNBQUksQ0FBQyxRQUFRLE9BQU87QUFDbEIsa0JBQU0sT0FBTyxjQUFjLE9BQU87QUFBQSxjQUNoQyxNQUFNO0FBQUEsZ0JBQ0osUUFBUSxLQUFLO0FBQUEsZ0JBQ2IsTUFBTTtBQUFBLGdCQUNOLFFBQVE7QUFBQSxnQkFDUixRQUFRLFlBQVksUUFBUSxRQUFRLEtBQUssSUFBSSxDQUFDO0FBQUEsZ0JBQzlDLFFBQVEsRUFBRSxnQkFBZ0IsTUFBTSxlQUFlO0FBQUEsY0FDakQ7QUFBQSxZQUNGLENBQUM7QUFDRCxtQkFBTyxJQUFJO0FBQUEsY0FDVCxJQUFJO0FBQUEsY0FDSixNQUFNO0FBQUEsY0FDTixTQUFTO0FBQUEsY0FDVCxTQUFTLFFBQVE7QUFBQSxZQUNuQixDQUFDO0FBQUEsVUFDSDtBQUFBLFFBQ0Y7QUFFQSxjQUFNLEVBQUUsUUFBUSxJQUFJLE1BQU0sY0FBYztBQUFBLFVBQ3RDLGdCQUFnQixNQUFNO0FBQUEsVUFDdEIsVUFBVSxLQUFLO0FBQUEsVUFDZixVQUFVLE1BQU07QUFBQSxVQUNoQixNQUFNLE1BQU07QUFBQSxVQUNaLE1BQU0sTUFBTTtBQUFBLFVBQ1osVUFBVSxNQUFNO0FBQUEsVUFDaEIsV0FBVyxNQUFNLGFBQWE7QUFBQSxRQUNoQyxDQUFDO0FBRUQsY0FBTSxpQkFBaUIsTUFBTSxhQUFhLE1BQU0sY0FBYztBQUM5RCxXQUFHLEdBQUcsaUJBQWlCLE1BQU0sY0FBYyxDQUFDLEVBQUUsS0FBSyxlQUFlLE9BQU87QUFDekUsbUJBQVcsT0FBTyxnQkFBZ0I7QUFDaEMsY0FBSSxRQUFRLEtBQUssR0FBSSxJQUFHLEdBQUcsU0FBUyxHQUFHLENBQUMsRUFBRSxLQUFLLGVBQWUsT0FBTztBQUFBLFFBQ3ZFO0FBQ0EsWUFBSSxFQUFFLElBQUksTUFBTSxRQUFRLENBQUM7QUFBQSxNQUMzQixTQUFTLEtBQUs7QUFDWixZQUFJLGVBQWUsY0FBYztBQUMvQixpQkFBTyxJQUFJLEVBQUUsSUFBSSxPQUFPLE1BQU0sSUFBSSxTQUFTLGNBQWMsY0FBYyxXQUFXLFNBQVMsSUFBSSxRQUFRLENBQUM7QUFBQSxRQUMxRztBQUNBLGdCQUFRLE1BQU0sc0JBQXNCLEdBQUc7QUFDdkMsWUFBSSxFQUFFLElBQUksT0FBTyxNQUFNLFNBQVMsU0FBUyw2Q0FBNkMsQ0FBQztBQUFBLE1BQ3pGO0FBQUEsSUFDRixDQUFDO0FBR0QsV0FBTyxHQUFHLG1CQUFtQixPQUFPLEVBQUUsV0FBVyxNQUFNLEdBQUcsUUFBUTtBQUNoRSxVQUFJO0FBQ0YsY0FBTSxLQUFLLFVBQVUsU0FBUyxLQUFLLEVBQUUsSUFBSSxZQUFZLFNBQVMsT0FBTyxZQUFZLFNBQVMsUUFBUTtBQUNsRyxZQUFJLENBQUMsR0FBRyxHQUFJLFFBQU8sSUFBSSxFQUFFLElBQUksT0FBTyxTQUFTLHNCQUFzQixDQUFDO0FBQ3BFLGNBQU0sRUFBRSxnQkFBZ0IsV0FBVyxLQUFLLFVBQVUsSUFBSSxNQUFNO0FBQUEsVUFDMUQ7QUFBQSxVQUNBLEtBQUs7QUFBQSxVQUNMO0FBQUEsUUFDRjtBQUNBLFdBQUcsR0FBRyxpQkFBaUIsY0FBYyxDQUFDLEVBQUUsS0FBSyxtQkFBbUI7QUFBQSxVQUM5RDtBQUFBLFVBQ0EsV0FBVztBQUFBLFVBQ1g7QUFBQSxRQUNGLENBQUM7QUFDRCxZQUFJLEVBQUUsSUFBSSxLQUFLLENBQUM7QUFBQSxNQUNsQixTQUFTLEtBQUs7QUFDWixZQUFJLGVBQWUsYUFBYyxRQUFPLElBQUksRUFBRSxJQUFJLE9BQU8sU0FBUyxJQUFJLFFBQVEsQ0FBQztBQUMvRSxnQkFBUSxNQUFNLHlCQUF5QixHQUFHO0FBQzFDLFlBQUksRUFBRSxJQUFJLE9BQU8sU0FBUywwQkFBMEIsQ0FBQztBQUFBLE1BQ3ZEO0FBQUEsSUFDRixDQUFDO0FBR0QsV0FBTyxHQUFHLGdCQUFnQixPQUFPLEVBQUUsZ0JBQWdCLFFBQVEsR0FBRyxRQUFRO0FBQ3BFLFVBQUk7QUFDRixjQUFNLFdBQVcsTUFBTSxpQkFBaUIsZ0JBQWdCLEtBQUssSUFBSSxPQUFPO0FBQ3hFLFlBQUksRUFBRSxTQUFTLENBQUM7QUFBQSxNQUNsQixRQUFRO0FBQ04sWUFBSSxFQUFFLFVBQVUsQ0FBQyxFQUFFLENBQUM7QUFBQSxNQUN0QjtBQUFBLElBQ0YsQ0FBQztBQUdELFdBQU8sR0FBRyxnQkFBZ0IsT0FBTyxFQUFFLGVBQWUsR0FBRyxRQUFRO0FBQzNELFVBQUk7QUFDRixjQUFNLEVBQUUsWUFBWSxPQUFPLElBQUksTUFBTSxxQkFBcUIsZ0JBQWdCLEtBQUssRUFBRTtBQUNqRixZQUFJLFdBQVcsUUFBUTtBQUNyQixhQUFHLEdBQUcsaUJBQWlCLGNBQWMsQ0FBQyxFQUFFLEtBQUssa0JBQWtCO0FBQUEsWUFDN0Q7QUFBQSxZQUNBO0FBQUEsWUFDQSxRQUFRO0FBQUEsWUFDUixJQUFJLEtBQUs7QUFBQSxVQUNYLENBQUM7QUFBQSxRQUNIO0FBQ0EsY0FBTSxFQUFFLElBQUksS0FBSyxDQUFDO0FBQUEsTUFDcEIsUUFBUTtBQUNOLGNBQU0sRUFBRSxJQUFJLE1BQU0sQ0FBQztBQUFBLE1BQ3JCO0FBQUEsSUFDRixDQUFDO0FBR0QsVUFBTSxhQUFhLENBQUMsZ0JBQXdCLFdBQW9CO0FBQzlELGFBQU8sR0FBRyxpQkFBaUIsY0FBYyxDQUFDLEVBQUUsS0FBSyxpQkFBaUI7QUFBQSxRQUNoRTtBQUFBLFFBQ0EsUUFBUSxLQUFLO0FBQUEsUUFDYjtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0g7QUFDQSxXQUFPLEdBQUcsZ0JBQWdCLENBQUMsRUFBRSxlQUFlLE1BQU0sV0FBVyxnQkFBZ0IsSUFBSSxDQUFDO0FBQ2xGLFdBQU8sR0FBRyxlQUFlLENBQUMsRUFBRSxlQUFlLE1BQU0sV0FBVyxnQkFBZ0IsS0FBSyxDQUFDO0FBRWxGLFdBQU8sR0FBRyxpQkFBaUIsTUFBTTtBQUMvQixhQUFPLEtBQUsscUJBQXFCLEVBQUUsUUFBUSxjQUFjLEVBQUUsQ0FBQztBQUFBLElBQzlELENBQUM7QUFFRCxXQUFPLEdBQUcsY0FBYyxNQUFNO0FBQzVCLFlBQU0sZ0JBQWdCLGFBQWEsS0FBSyxJQUFJLE9BQU8sRUFBRTtBQUNyRCxVQUFJLGVBQWU7QUFDakIsZUFBTyxVQUFVLEtBQUssbUJBQW1CO0FBQUEsVUFDdkMsUUFBUSxLQUFLO0FBQUEsVUFDYixRQUFRO0FBQUEsVUFDUixVQUFVLFlBQVksS0FBSyxFQUFFO0FBQUEsUUFDL0IsQ0FBQztBQUFBLE1BQ0g7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNILENBQUM7QUFDSDs7O0FDN01BLElBQU0sSUFBSTtBQUVILFNBQVMsTUFBTSxJQUFpQjtBQUNyQyxJQUFFLFVBQVU7QUFDZDs7O0FiSEEsSUFBTSxNQUFNLFFBQVEsSUFBSSxhQUFhO0FBQ3JDLElBQU0sVUFBTSxZQUFBQyxTQUFLLEVBQUUsS0FBSyxVQUFVLElBQUksVUFBVSxNQUFNLElBQUksS0FBSyxDQUFDO0FBQ2hFLElBQU0sU0FBUyxJQUFJLGtCQUFrQjtBQUVyQyxlQUFlLE9BQU87QUFDcEIsUUFBTSxJQUFJLFFBQVE7QUFFbEIsUUFBTSxhQUFTLCtCQUFhLENBQUMsS0FBSyxRQUFRO0FBQ3hDLFdBQU8sS0FBSyxHQUFHO0FBQUEsRUFDakIsQ0FBQztBQUVELFFBQU0sS0FBa0IsSUFBSSxjQUFBQyxPQUFTLFFBQVE7QUFBQSxJQUMzQyxNQUFNO0FBQUEsSUFDTixNQUFNLEVBQUUsUUFBUSxJQUFJLFlBQVksYUFBYSxLQUFLO0FBQUE7QUFBQSxJQUVsRCx5QkFBeUI7QUFBQSxNQUN2QiwwQkFBMEIsSUFBSSxLQUFLO0FBQUEsTUFDbkMsaUJBQWlCO0FBQUEsSUFDbkI7QUFBQSxFQUNGLENBQUM7QUFFRCxRQUFNLEVBQUU7QUFDUix5QkFBdUIsRUFBRTtBQUV6QixTQUFPLE9BQU8sSUFBSSxNQUFNLE1BQU07QUFDNUIsWUFBUSxJQUFJO0FBQUEsdUNBQXFDLElBQUksVUFBVTtBQUFBLENBQUk7QUFBQSxFQUNyRSxDQUFDO0FBQ0g7QUFFQSxLQUFLLEVBQUUsTUFBTSxDQUFDLFFBQVE7QUFDcEIsVUFBUSxNQUFNLEdBQUc7QUFDakIsVUFBUSxLQUFLLENBQUM7QUFDaEIsQ0FBQzsiLAogICJuYW1lcyI6IFsicGFyc2VDb29raWUiLCAiaW1wb3J0X2NsaWVudCIsICJnIiwgImciLCAibmV4dCIsICJuZXh0IiwgIklPU2VydmVyIl0KfQo=
