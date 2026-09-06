# Pulse — Real-Time Messaging System

A production-oriented one-to-one messaging module: real-time delivery, presence,
typing, read receipts, GIFs & stickers, server-side image (nudity) and profanity
moderation, and reliable delivery across disconnects and multiple tabs.

Built with **Next.js 14 (App Router) · TypeScript · Socket.IO · Prisma ·
PostgreSQL**. Everything runs locally and uses only free components.

---

## 1. Quick start

**Prerequisites:** Node 18+, a local PostgreSQL 14+ instance.

```bash
# 1. install
npm install

# 2. database — create it once (password used here: "Prakhar")
#    createdb realtime_messaging      (or use pgAdmin / psql)
#    connection string lives in .env  ->  DATABASE_URL

# 3. schema + demo data
npx prisma migrate deploy      # or: npm run db:push
npm run db:seed                # users: alice / bob / carol   (password: "password")

# 4. one-time: download the nudity-detection model (~2.7 MB, open-source)
npm run setup:models

# 5. run
npm run dev                    # http://localhost:3000
```

Open two browsers (or a normal + a private window), sign in as **alice** and
**bob**, and message between them.

`.env` is committed with working local defaults (including a public GIPHY demo
key) so the app runs with no extra setup.

### Production-style run

```bash
npm run build      # next build + bundles the custom server
npm start          # NODE_ENV=production node .server/server.cjs
```

---

## 2. Architecture

```
┌─────────────┐   HTTP (REST)         ┌──────────────────────────────────────┐
│  Browser    │ ────────────────────► │  Next.js route handlers (App Router)  │
│  (React)    │                       │   auth · conversations · messages     │
│             │   WebSocket           │   upload (+moderation) · giphy proxy   │
│  zustand    │ ◄───────────────────► │                                      │
│  store      │   Socket.IO           │  Socket.IO server (same Node process) │
└─────────────┘                       │   send · typing · read · presence     │
                                      │   sync (reconnect reconciliation)     │
                                      └───────────────┬──────────────────────┘
                                                      │  Prisma
                                              ┌───────▼────────┐   ┌──────────────┐
                                              │  PostgreSQL     │   │ ./storage     │
                                              │  (messages,     │   │ (image blobs, │
                                              │   memberships…) │   │  S3/R2 stand-in)│
                                              └────────────────┘   └──────────────┘
```

### Why a custom server (`server.ts`)

Next.js and the Socket.IO server share **one Node process and one HTTP port**.
That lets a REST route handler (e.g. the moderated image upload) push the
resulting message straight onto the real-time channel via a shared `io`
singleton (`src/lib/socket/io.ts`). The server is bundled with esbuild
(`scripts/build-server.mjs`) — dependencies stay external, only our `src/` is
bundled — and run with plain `node`, which avoids the App-Router/`ts-node`
`AsyncLocalStorage` incompatibility.

### Key modules

| Area | Location |
| --- | --- |
| Auth (JWT in `httpOnly` cookie, bcrypt) | `src/lib/auth-core.ts`, `src/lib/auth.ts` |
| Socket wire contract | `src/lib/socket/events.ts` |
| Socket handlers | `src/lib/socket/handlers.ts` |
| Presence (multi-tab aware) | `src/lib/socket/presence.ts` |
| Message service (create / paginate / receipts) | `src/server/messages.ts` |
| Conversation service (membership / authz) | `src/server/conversations.ts` |
| Image moderation (NSFW) | `src/lib/moderation/nsfw.ts` |
| Profanity moderation | `src/lib/moderation/profanity.ts` + `normalize.ts` |
| Upload validation (magic bytes) | `src/lib/moderation/imageValidation.ts` |
| Object storage abstraction | `src/lib/storage.ts` |
| Rate limiting | `src/lib/rateLimit.ts` |
| Client store | `src/store/chat.ts` |
| Client socket wiring | `src/hooks/useChatSocket.ts` |
| Persistent outbox | `src/lib/client/outbox.ts` |

### Where Redis would go

Presence, rate limiting and the Socket.IO room fan-out are all in-process —
correct and sufficient for a single node. For horizontal scaling: add the
Socket.IO Redis adapter, move `rateLimit` to Redis `INCR`/`EXPIRE`, and move
`presence` to a Redis hash. Call sites and contracts don't change.

---

## 3. Data model & indexing

`prisma/schema.prisma`. Highlights:

- **`Message`**
  - `@@unique([conversationId, clientId])` — idempotency key; a retried or
    replayed send can never create a duplicate row.
  - `@@index([conversationId, createdAt, id])` — the primary retrieval path:
    newest-first within a conversation with a stable `(createdAt, id)` cursor.
  - `@@index([senderId])`.
- **`ConversationMember`**
  - `@@unique([conversationId, userId])`, plus `@@index([userId])` and
    `@@index([conversationId])` for membership / authorization lookups.
  - `lastReadAt` drives unread counts without scanning receipts.
  - `editedAt` / `deletedAt` — nullable; `deletedAt` is a soft "delete for everyone".
- **`MessageRead`** — per-user read receipts, `@@unique([messageId, userId])`.
- **`MessageReaction`** — `@@unique([messageId, userId, emoji])`.
- **`MessageHidden`** — "delete for me": `@@unique([messageId, userId])`, `@@index([userId])`; every message read path filters `hiddenFor: { none: { userId } }`.
- **`Conversation`** — `@@index([updatedAt])` for the conversation list ordering.
- **`ModerationLog`** — every moderation decision (image + profanity) is recorded.

### Pagination (10,000+ messages)

`GET /api/conversations/:id/messages?cursor=<messageId>` returns 30 messages at a
time, newest page first, older pages as the user scrolls up
(`src/server/messages.ts → getMessages`). Uses Prisma `cursor` + `take` on the
composite index — no `OFFSET`, constant-time regardless of history size. The
client keeps scroll position stable when older messages are prepended
(`ChatPane.tsx`).

---

## 4. Real-time behaviour

| Feature | How |
| --- | --- |
| Instant delivery | `message:send` → persist → `io.to(conversationRoom).emit("message:new")` + per-user rooms |
| Optimistic send | temp `clientId` (`tmp_…`), bubble shows immediately as "sending…" |
| Delivery state | recipient's socket marks `SENT → DELIVERED` on connect; `message:status` receipt to sender |
| Read state | opening a conversation emits `message:read`; `MessageRead` rows + `message:status: READ`; blue ✓✓ |
| Typing | debounced `typing:start` / `typing:stop`, 4 s TTL client-side auto-expire |
| Presence | in-process `userId → Set<socketId>`; online while ≥1 socket; broadcast on first-connect / last-disconnect |
| Unread counts | `messages where senderId≠me and createdAt > member.lastReadAt` |
| Reactions | `reaction:toggle` → `MessageReaction` (unique `messageId+userId+emoji`) → `reaction:update` to the room |
| Reply / quote | `replyToId` self-relation; jump-to-original in the UI |
| Edit | `message:edit` (sender-only, TEXT-only) → re-runs profanity moderation → `message:update` to the room; `editedAt` shows a "· edited" marker |
| Delete for everyone | `message:delete { scope: "everyone" }` (sender-only) → soft delete (`deletedAt`, body/metadata/reactions cleared) → `message:update`; renders as "This message was deleted" |
| Delete for me | `message:delete { scope: "me" }` → `MessageHidden` row (unique `messageId+userId`) → `message:removed` to the acting user's own room (all their tabs); filtered from that user's pagination + reconnect sync only |

---

## 5. GIFs & stickers

- **GIFs** — GIPHY. The API key is **server-side only**; the browser calls
  `GET /api/giphy?q=…`, which is authenticated + rate-limited and proxies to
  GIPHY (`rating=pg-13`, messaging bundle). Sent as a `GIF` message referencing
  the remote URL — no proxying of the media bytes.
- **Stickers** — a bundled **"Blobs"** pack: 12 hand-drawn SVGs generated by
  `scripts/generate-stickers.ts` into `public/stickers/blobs/`. Served as static
  files; `GET /api/stickers` returns the manifest.
- Both render lazily (`loading="lazy"`, `decoding="async"`) and are capped in
  size so the message list stays smooth.

---

## 6. Image upload & nudity detection

**Endpoint:** `POST /api/upload` (multipart). Pipeline, in order:

1. **Auth + rate limit** (10 uploads / user / minute).
2. **Membership check** — sender must belong to the conversation.
3. **Real byte validation** — `file-type` sniffs magic bytes; only genuine
   `image/jpeg` / `image/png` accepted, max 8 MB. The filename and the
   client-supplied `Content-Type` are never trusted.
4. **Caption** (if any) goes through the profanity gate.
5. **Nudity / explicit-content detection** — see below.
6. On pass: written to object storage (`./storage/<conv>/<uuid>.<ext>`), a
   `IMAGE` message is created and broadcast over Socket.IO.
7. On fail: **422**, nothing stored, nothing delivered, sender sees
   *"This image was rejected by moderation … It was not delivered."*

Every decision is written to `ModerationLog` with the class probabilities.

### The model

| | |
| --- | --- |
| Model | **NSFWJS – MobileNetV2** (open-source, `github.com/infinitered/nsfwjs`, MIT) |
| Size | ~2.6 MB weights + ~126 KB graph (quantised), 224×224 input |
| Where inference runs | **In-process on the Node app server** via `@tensorflow/tfjs` pure-JS **CPU** backend. No GPU, no native addons, no external API, no data leaves the machine. |
| Latency | ~150–500 ms per image once warm; first call ~1–2 s while the model loads once and is cached for the process lifetime |
| Classes | `Neutral`, `Drawing`, `Sexy`, `Porn`, `Hentai` |
| Decision rule | Reject if **any** holds: `P(Porn) ≥ 0.30`, `P(Hentai) ≥ 0.30`, `P(Sexy) ≥ 0.55`, or `P(Porn) + P(Hentai) + 0.5·P(Sexy) ≥ 0.45` (`NSFW_THRESHOLD`). Per-class gates catch a single strong signal; the combined score catches "a bit of everything". |
| Failure mode | **fail-closed** — if the model cannot run, the upload is rejected (503), never delivered unchecked |

Model files are downloaded once by `npm run setup:models` into
`public/models/nsfw/` and loaded from `http://localhost:3000/models/nsfw/model.json`,
so inference is fully offline afterwards.

### Not bypassable from the browser

Moderation lives entirely in the server route handler. There is **no** image
message path that skips it — text/GIF/sticker go over the socket, but images
*must* go through `POST /api/upload`. Calling the API directly with a raw body,
a spoofed MIME type, or a renamed file still hits steps 1–5.

---

## 7. Profanity moderation (server-side)

`src/lib/moderation/profanity.ts`. Enforced in the Socket.IO `message:send`
handler and the upload caption check — **never** in the browser.

**Normalisation** (`normalize.ts`) defeats the common evasions:

| Evasion | Handling |
| --- | --- |
| Casing | lower-cased |
| Accents / diacritics | Unicode NFKD + combining-mark strip |
| Leetspeak (`f4ck`, `sh!t`, `@ss`) | character map `0→o 1→i 3→e 4→a @→a $→s …` |
| Homoglyphs (Cyrillic `а`, `е`, `о`…) | mapped to Latin |
| Repeated letters (`fuuuuck`, `shiiit`) | runs of 3+ collapsed |
| Padding (`f u c k`, `s-h-i-t`, `g o f u c k`) | whole-message letters-only skeleton, substring scan |

**Two passes:** (1) exact match each normalised token against the blocklist;
(2) scan the collapsed whole-message skeleton for any blocked term as a
substring. An **allowlist** (`class`, `assignment`, `scunthorpe`, `analysis`, …)
prevents the Scunthorpe problem. Blocked sends return
`{ ok: false, code: "PROFANITY" }` and the sender sees a clear inline message
with a retry affordance.

---

## 8. Reliability

| Concern | Mechanism |
| --- | --- |
| WebSocket disconnect | Socket.IO auto-reconnect + `connectionStateRecovery` (2 min window) |
| No lost "accepted" messages | **Persistent outbox** in `localStorage` (`src/lib/client/outbox.ts`). Anything shown optimistically but not yet ack'd is re-sent on reconnect. |
| No duplicates on retry | `Message.@@unique([conversationId, clientId])` — server `createMessage` catches `P2002` and returns the existing row (`created: false`). Client dedupes by `clientId` / `id`. |
| Missed messages during downtime | on reconnect the client calls `message:sync { afterId }`; server returns everything since that id |
| Optimistic UI | temp id, "sending…" state, then reconciled to the server message on ack |
| Ack timeout | after 10 s an un-ack'd message reverts to "pending" and is retried on the next connect |
| Multiple tabs, same account | every socket joins the user's room; `message:new`, receipts and presence reach all tabs; presence stays "online" until the **last** tab closes |

Verify with `node scripts/smoke.mjs` (needs the dev server running) — it checks
real-time fanout, idempotency, profanity variants, cross-conversation
authorization, and the image moderation + magic-byte pipeline.

---

## 9. Security

| Requirement | Implementation |
| --- | --- |
| Can't read conversations you're not in | every read path calls `isMember(conversationId, userId)` — REST routes, socket handlers, and the authenticated media route `GET /api/files/[...key]` |
| Can't send as another account | sender id comes from the verified session (cookie JWT) on the server, never from the payload |
| Uploaded file type & size | magic-byte sniff (`file-type`), 8 MB cap, JPEG/PNG only, filename ignored; storage keys are server-generated UUIDs, path-traversal-guarded |
| Server-side authn/authz | `httpOnly` `SameSite=Lax` cookie, `jose` HS256 verification on every request and on the socket handshake; `middleware.ts` only does page redirects |
| Rate limiting | sends 30/10 s, uploads 10/min, auth 10/min, GIF search 60/min, conversation-create 20/min (`src/lib/rateLimit.ts`) |
| Media authorization | images are served through a route that re-checks membership *and* that the key is referenced by a message in that conversation — not from a public folder |

---

## 10. Performance & data handling

- Cursor pagination, composite indexes (§3) — history size is irrelevant to load
  cost.
- Media is **lazy-rendered** (`loading="lazy"`, width hints from metadata).
- Large uploads go to a **dedicated object store**, not through an oversized JSON
  body — `src/lib/storage.ts` is a drop-in seam for S3 / Cloudflare R2
  (`putObject` / `getObject`).
- Conversation list unread counts use `lastReadAt` rather than scanning receipts.

---

## 11. Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | esbuild-bundled custom server + Next dev, watch mode |
| `npm run build` / `npm start` | production build / run |
| `npm run db:push` / `db:seed` | sync schema / load demo users + conversation |
| `npm run setup:models` | download the NSFW model |
| `node scripts/generate-stickers.ts` | regenerate the sticker pack |
| `node scripts/smoke.mjs` | end-to-end reliability & moderation checks |

---

## 12. Known limitations / trade-offs

- Single-node only (see §2 for the Redis path).
- Image moderation supports JPEG/PNG (pure-JS decoders); WebP/GIF uploads are
  rejected as "unsupported" — a `sharp` or `tfjs-node` decode step would add them.
- The GIPHY key in `.env` is a public demo key with low quotas — fine for the
  demo, replace with a free personal key for anything more.
- Group conversations: the schema and rooms already support N members; only the
  1:1 UI and "start conversation" flow are built out.
