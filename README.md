# Pulse — Real-Time Messaging System

A production-oriented messaging module: real-time 1:1 chat with presence, typing,
delivery/read receipts, unread counts, GIFs & stickers, message reactions,
reply/quote, edit, delete (for me / for everyone), an image pipeline with
**server-side nudity detection**, **server-side profanity moderation**, reliable
delivery across disconnects and multiple tabs, cursor pagination for large
histories, a command palette, desktop notifications, and light/dark themes.

Everything runs locally and uses only free components.

---

## Contents

1. [Feature list](#1-feature-list)
2. [Technology stack — what each part does](#2-technology-stack--what-each-part-does)
3. [Run it locally](#3-run-it-locally)
4. [How to use the app](#4-how-to-use-the-app)
5. [Architecture](#5-architecture)
6. [Data model & indexing](#6-data-model--indexing)
7. [Real-time behaviour](#7-real-time-behaviour)
8. [GIFs & stickers](#8-gifs--stickers)
9. [Image upload & nudity detection](#9-image-upload--nudity-detection)
10. [Profanity moderation](#10-profanity-moderation)
11. [Reliability](#11-reliability)
12. [Security](#12-security)
13. [Performance & scaling](#13-performance--scaling)
14. [Deployment](#14-deployment)
15. [Environment variables](#15-environment-variables)
16. [Scripts & testing](#16-scripts--testing)
17. [Known limitations & trade-offs](#17-known-limitations--trade-offs)

---

## 1. Feature list

**Messaging**
- One-to-one conversations; start a chat by searching users
- Messages appear for both users in real time, no refresh
- Per-message timestamps, day separators, consecutive-message grouping
- Delivery state (`✓` sent → `✓✓` delivered → **blue `✓✓`** read)
- Typing indicators; online / "last seen …" presence
- Unread counts per conversation; a "New messages" divider in the thread
- Cursor pagination — newest 30 messages first, older pages load on scroll-up
- Works from two accounts simultaneously; safe with the same account in several tabs

**Rich content**
- GIF picker with GIPHY search + preview
- Sticker picker with a bundled "Blobs" pack (12 SVGs)
- Message **reactions** (emoji, real-time)
- **Reply / quote** with jump-to-original
- Image messages with a click-to-zoom **lightbox**

**Message management**
- **Edit** your own text messages (re-moderated) — shows a "· edited" marker
- **Delete for everyone** (sender only) — "This message was deleted"
- **Delete for me** — hidden only for you, across all your tabs

**Moderation (server-side, non-bypassable)**
- Nudity / explicit-content detection on every uploaded image before delivery
- Profanity blocking on every message and image caption, with evasion handling

**Reliability & UX**
- Optimistic send, temporary IDs, idempotent delivery, persistent outbox
- Reconnect reconciliation; multi-tab consistency
- Command palette (`⌘K` / `Ctrl+K`) — switch/start conversations, toggle theme, mute, sign out
- Desktop notifications + sound for messages received while the tab is unfocused
- Light / dark theme with a toggle (persisted)
- Toasts, skeleton loaders, empty states, offline banner, scroll-to-bottom button

---

## 2. Technology stack — what each part does

| Technology | Version | Used for |
| --- | --- | --- |
| **Next.js** (App Router) | 14.2 | HTTP server, React SSR, REST route handlers (`src/app/api/**`), page routing, middleware redirects |
| **React** | 18.3 | UI |
| **TypeScript** | 5.6 | Whole codebase; shared DTO types (`src/lib/types.ts`) used by client, socket layer and REST |
| **Custom Node server** (`server.ts`) | — | Runs Next **and** Socket.IO in one process on one port so a REST route (image upload) can push onto the real-time channel |
| **esbuild** | 0.28 | Bundles `server.ts` → `.server/server.cjs` (deps external) so the custom server runs with plain `node`, avoiding the App-Router / `ts-node` `AsyncLocalStorage` clash |
| **Socket.IO** (`socket.io` / `socket.io-client`) | 4.8 | Real-time transport: message send/receive, typing, presence, read receipts, reactions, edit/delete, reconnect sync; `connectionStateRecovery` for brief drops |
| **Prisma** | 5.22 | ORM + migrations + type-safe queries against PostgreSQL |
| **PostgreSQL** | 14+ | System of record — users, conversations, memberships, messages, reactions, reads, hidden flags, moderation log |
| **zustand** | 5.0 | Client state store (`src/store/chat.ts`, `src/store/toast.ts`) — conversations, messages, presence, typing, reply/edit targets |
| **jose** | 5.9 | Signs/verifies the session JWT (HS256) — used on every REST request and on the Socket.IO handshake |
| **bcryptjs** | 2.4 | Password hashing |
| **cookie** | 0.6 | Parses the raw `Cookie` header on the WebSocket handshake (no `next/headers` there) |
| **zod** | 3.23 | Validates env vars (`src/lib/env.ts`) and request bodies |
| **@tensorflow/tfjs** + **nsfwjs** | 4.22 / 4.2 | Nudity / explicit-content model (MobileNetV2), pure-JS **CPU** inference, in-process |
| **jpeg-js** + **pngjs** | 0.4 / 7.0 | Decode uploaded JPEG/PNG to a pixel tensor for the NSFW model (no native deps) |
| **file-type** | 19.6 | Magic-byte sniffing — validates real image type regardless of filename / `Content-Type` |
| **GIPHY API** | — | GIF search, proxied server-side (`GET /api/giphy`) so the key never reaches the browser |
| **nanoid** | 5.0 | Client-side temporary message IDs / idempotency keys (`tmp_…`) |
| **date-fns** | 3.6 | Timestamp + "last seen" formatting |
| **Tailwind CSS** + **PostCSS** + **autoprefixer** | 3.4 | Styling; CSS-variable token system for the light/dark "Aurora" theme (`src/app/globals.css`, `tailwind.config.ts`) |
| **framer-motion** | 13.2 | Motion — message entrance, reaction pop, panels, toasts, lightbox (loaded via `LazyMotion`, respects reduced-motion) |
| **cmdk** | 1.1 | The `⌘K` command palette (`src/components/CommandPalette.tsx`) |
| **next/font/local** + **Inter** | — | Self-hosted variable font (`public/fonts/InterVariable.woff2`), no network dependency |
| **Web Notification API** + generated WAV | — | Desktop notifications + a synthesised `pop.wav` for background messages (`src/lib/client/notifications.ts`) |
| **`localStorage`** | — | Persistent outbox (`rtm.outbox.v1`), theme, notification prefs |
| **Local disk (`./storage`)** | — | Object-storage stand-in for image blobs; `src/lib/storage.ts` is a drop-in seam for S3 / Cloudflare R2 |
| **tsx** | 4.19 | Runs `.ts` scripts (seed, model download, sticker/sound generators) |
| **cross-env** | 7.0 | Sets `NODE_ENV` cross-platform in the `start` script |
| **puppeteer-core** (dev) | 25 | Optional headless UI checks |

---

## 3. Run it locally

**Prerequisites:** Node 18+ (tested on 20 and 24), a local PostgreSQL 14+.

```bash
# 1. install
npm install

# 2. environment — copy the template and set your Postgres password
cp .env.example .env
#    then edit DATABASE_URL in .env (the rest are working local defaults)

# 3. create the database
#    createdb realtime_messaging      (or pgAdmin / psql)

# 4. schema + demo data
npx prisma migrate deploy        # applies prisma/migrations
npm run db:seed                  # users: alice / bob / carol  ·  password: "password"

# 5. one-time: download the nudity model (~2.7 MB, MIT)
npm run setup:models

# 6. run
npm run dev                      # http://localhost:3000
```

Open two browsers (or one normal + one private) and sign in as **alice** and
**bob**. Every value in `.env.example` except `DATABASE_URL` is a working local
default (including a public GIPHY demo key).

### Production-style run

```bash
npm run build      # prisma generate → next build → esbuild bundle of server.ts
npm start          # NODE_ENV=production node .server/server.cjs
```

---

## 4. How to use the app

### Sign in
- `/register` — username (3–20 chars, letters/numbers/underscore), display name, password (6+).
- `/login` — username + password.
- Session is a 7-day `httpOnly` cookie. `/chat` redirects to `/login` when signed out.
- Demo accounts after `npm run db:seed`: **alice**, **bob**, **carol** — password `password`.

### Start a conversation
- Click the **`+`** icon in the sidebar header, **or** press **`⌘K` / `Ctrl+K`** and search a person.
- Pick a user → the 1:1 conversation opens (re-opening an existing one never creates a duplicate).

### Send messages
- Type in the composer, **Enter** to send (**Shift+Enter** for a newline).
- The bubble appears instantly as "sending…", then shows `✓` → `✓✓` → blue `✓✓` as it's delivered and read.
- **GIF / sticker:** click the face icon → **GIFs** tab (type to search GIPHY) or **Stickers** tab → click one.
- **Image:** click the picture icon (or **drag an image onto the composer**). JPEG/PNG, up to 8 MB. It's moderated on the server before the other person sees it; if it's rejected you get a red "Image not sent" card.

### On a message (hover it)
- **↩ Reply** — a quoted strip appears in the composer; send your reply; click the quote later to jump to the original (it flashes).
- **🙂 React** — pick an emoji; reactions sync live and you can toggle your own off.
- **⋯ More** — for your own text message: **Edit**; for any of your messages: **Delete for everyone**; for any message: **Delete for me**.
  The menu stays open until you click outside it or press **Escape**.
- **Edit** puts the text back in the composer with an "Editing message" strip — **Enter** to save (edits are re-moderated), **Escape** to cancel. Edited messages show "· edited".
- **Delete for everyone** replaces the message with *"This message was deleted"* for both people.
- **Delete for me** removes it from your view only (all your tabs); the other person still sees it.
- **Image** → click it for a full-screen **lightbox** (scroll to zoom, drag to pan, "Open original").

### Navigation & preferences
- **Sidebar:** filter conversations by name; unread badge; "typing…" preview; active conversation has an accent bar.
- **Scroll up** in a thread → older messages page in; a **"New messages"** divider marks where you left off; a **scroll-to-bottom** button appears when you're scrolled up.
- **`⌘K` palette:** jump to a conversation, start a new one, **toggle theme**, **mute/unmute sound**, **enable/disable desktop notifications**, sign out.
- **Theme:** sun/moon icon in the sidebar header (also `⌘\`), persisted per browser.
- **Notifications:** when a message arrives while the tab is hidden, you get a sound + a desktop notification (allow it when prompted); clicking it focuses the tab and opens the conversation.

### Multi-tab / reconnect
- Open the app in two tabs as the same account — messages, receipts and presence stay in sync; you appear "online" until the **last** tab closes.
- Lose connection (DevTools → Network → Offline): an amber banner shows, messages queue as "sending…", and flush automatically — **exactly once** — when you're back.

---

## 5. Architecture

### 5.1 High-level

```
 ┌───────────────────────────┐        HTTPS / REST           ┌──────────────────────────────────────────────┐
 │  Browser (React 18)       │ ───────────────────────────►  │  ONE Node process  (server.ts → server.cjs)   │
 │                           │   auth · conversations ·      │                                              │
 │  zustand store            │   messages · upload · giphy   │   Next.js (App Router)                        │
 │  useChatSocket hook       │                               │   ├─ route handlers  src/app/api/**           │
 │  Socket.IO client         │ ◄══════════ WebSocket ══════►  │   ├─ middleware (page redirects)              │
 │  localStorage outbox      │   send · typing · read ·      │   └─ SSR / static pages                       │
 └───────────────────────────┘   presence · reaction ·       │                                              │
                                 edit · delete · sync        │   Socket.IO server (shared `io` singleton)    │
                                                             │   src/lib/socket/{handlers,presence,io}.ts    │
                                                             │                                              │
                                                             │   Service layer  src/server/*                │
                                                             │   Moderation     src/lib/moderation/*        │
                                                             │        │ tfjs + nsfwjs (in-process, CPU)      │
                                                             └────────┼─────────────────────────────────────┘
                                                       Prisma │       │  fs
                                                   ┌──────────▼──┐  ┌─▼───────────────────┐
                                                   │ PostgreSQL   │  │ ./storage (blobs)   │
                                                   │              │  │ S3/R2 stand-in      │
                                                   └──────────────┘  └─────────────────────┘
```

### 5.2 Why one custom server

Next.js and Socket.IO share **one process and one port** (`server.ts`). A REST
route handler (the moderated image upload) needs to push the resulting message
onto the real-time channel — it does so through a shared `io` singleton
(`src/lib/socket/io.ts`, stored on `globalThis`). `server.ts` is bundled by
esbuild with dependencies external (`scripts/build-server.mjs`) and run with
plain `node`; running it through `tsx`/`ts-node` breaks the App Router's
`AsyncLocalStorage`.

`connectionStateRecovery` (2-minute window) lets a socket resume its session
after a brief network blip.

### 5.3 Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| **UI components** | `src/components/**` | Rendering, local interaction state |
| **Client store** | `src/store/chat.ts`, `src/store/toast.ts` | Conversations, messages (with `local` status), presence, typing, reply/edit targets, toasts |
| **Client socket wiring** | `src/hooks/useChatSocket.ts` | Binds socket events ↔ store; exposes `sendMessage`, `retryMessage`, `reactToMessage`, `editMessage`, `deleteMessage`, `setTyping` |
| **Persistent outbox** | `src/lib/client/outbox.ts` | `localStorage` queue of un-acked sends for replay |
| **Transport — REST** | `src/app/api/**/route.ts` | Auth, conversation list/create, message pagination, image upload, GIPHY proxy, sticker manifest, authenticated media |
| **Transport — WebSocket** | `src/lib/socket/handlers.ts` + `events.ts` | `message:send/read/sync/edit/delete`, `reaction:toggle`, `typing:*`, `presence:*` |
| **Presence** | `src/lib/socket/presence.ts` | In-process `userId → Set<socketId>` |
| **Service layer** | `src/server/{messages,conversations,serialize}.ts` | All business logic + authorization (`isMember`), DTO shaping. Called by **both** REST and socket handlers so rules can't diverge |
| **Moderation** | `src/lib/moderation/{nsfw,profanity,normalize,imageValidation}.ts` | NSFW model, profanity pipeline, text normalisation, magic-byte checks |
| **Storage** | `src/lib/storage.ts` | Image blob put/get; S3/R2 seam |
| **Rate limiting** | `src/lib/rateLimit.ts` | In-process sliding window |
| **Auth** | `src/lib/auth-core.ts` (framework-agnostic) + `src/lib/auth.ts` (`next/headers`) | JWT sign/verify, password hash, cookie options, handshake helper |
| **Data** | `prisma/schema.prisma` | Schema, indexes, migrations |

### 5.4 Request flows

**Send a text / GIF / sticker**
`client sendMessage()` → optimistic bubble + `outbox.add` → `socket.emit("message:send")`
→ handler: rate-limit → `isMember` → `checkProfanity` → `createMessage` (idempotent)
→ `io.to(room).emit("message:new")` → ack with the real message → client reconciles the temp bubble.

**Send an image**
`client → POST /api/upload` (multipart)
→ auth → rate-limit → `isMember` → `validateImage` (magic bytes + size)
→ caption `checkProfanity` → `classifyImage` (NSFW)
→ if unsafe: `422`, `ModerationLog`, nothing stored/sent
→ if safe: `storage.putImage` → `createMessage` → `broadcastMessage` (same `message:new` channel).

**Reconnect**
socket reconnects → client replays `outbox` → `socket.emit("message:sync", { afterId })`
→ server returns everything since that id (filtered by "delete for me") → store merges by `id`/`clientId`.

### 5.5 Directory map

```
server.ts                     custom Next + Socket.IO server (bundled to .server/)
prisma/
  schema.prisma               models + indexes
  migrations/                 SQL migrations
  seed.ts                     demo users + conversation
scripts/
  dev-server.mjs              esbuild watch + Next dev
  build-server.mjs            esbuild bundle of server.ts
  download-nsfw-model.ts      fetch the NSFW model into public/models/nsfw
  generate-stickers.ts        write the Blobs sticker SVGs
  generate-sound.mjs          synthesise public/sounds/pop.wav
  smoke.mjs                   end-to-end checks (BASE env var to target a URL)
src/
  app/
    (auth)/{login,register}   auth pages + AuthForm
    chat/page.tsx             server component → ChatApp
    api/**/route.ts           REST endpoints
    layout.tsx globals.css    theme tokens, providers
    middleware.ts             page redirect guard
  components/
    ThemeProvider MotionProvider Toaster Brand CommandPalette
    chat/                     ChatApp, Sidebar, ChatPane, Composer, MessageItem,
                              MessageReactions, GifStickerPicker, Lightbox,
                              NewChatDialog, EmptyState, ModerationNotice,
                              ScrollToBottom, Skeletons, TypingDots, Avatar,
                              ConnectionBanner
  hooks/useChatSocket.ts
  store/{chat,toast}.ts
  server/{messages,conversations,serialize}.ts
  lib/
    env.ts auth.ts auth-core.ts prisma.ts rateLimit.ts types.ts format.ts
    api.ts storage.ts stickers.ts
    socket/{events,handlers,io,presence}.ts
    moderation/{nsfw,profanity,normalize,imageValidation}.ts
    client/{socket,outbox,notifications}.ts
public/
  fonts/InterVariable.woff2
  stickers/blobs/*.svg
  sounds/pop.wav
  models/nsfw/                downloaded, git-ignored
storage/                      image blobs, git-ignored
```

---

## 6. Data model & indexing

`prisma/schema.prisma`.

- **`User`** — `username` unique, `passwordHash` (bcrypt), `avatarColor`.
- **`Conversation`** — `isGroup` flag (schema supports N members), `@@index([updatedAt])` for list ordering.
- **`ConversationMember`** — `@@unique([conversationId, userId])`, `@@index([userId])`, `@@index([conversationId])` for membership / authorization; `lastReadAt` drives unread counts without scanning receipts.
- **`Message`**
  - `@@unique([conversationId, clientId])` — **idempotency**; a retried / replayed send returns the existing row.
  - `@@index([conversationId, createdAt, id])` — the primary retrieval path: newest-first with a stable `(createdAt, id)` cursor.
  - `@@index([senderId])`, `@@index([replyToId])`.
  - `replyToId` self-relation (reply/quote); `editedAt`, `deletedAt`, `deletedById` (nullable — soft "delete for everyone").
- **`MessageRead`** — per-user read receipts, `@@unique([messageId, userId])`.
- **`MessageReaction`** — `@@unique([messageId, userId, emoji])`, `@@index([messageId])`, `@@index([userId])`.
- **`MessageHidden`** — "delete for me": `@@unique([messageId, userId])`, `@@index([userId])`. Every message read path (`getMessages`, `getMessagesAfter`, conversation preview) filters `hiddenFor: { none: { userId } }`.
- **`ModerationLog`** — one row per moderation decision (image + profanity) with the class probabilities / matched terms; `@@index([userId, createdAt])`.

### Pagination (10,000+ messages)

`GET /api/conversations/:id/messages?cursor=<messageId>` returns 30 messages per
page, newest first, older pages on scroll-up (`src/server/messages.ts →
getMessages`). Prisma `cursor` + `take` on the composite index — **no `OFFSET`**,
constant cost regardless of history size. The client keeps scroll position
stable when older messages are prepended (`ChatPane.tsx`).

---

## 7. Real-time behaviour

Wire contract: `src/lib/socket/events.ts`. Handlers: `src/lib/socket/handlers.ts`.

| Feature | How |
| --- | --- |
| Instant delivery | `message:send` → persist → `io.to(conversationRoom).emit("message:new")` + per-user rooms |
| Optimistic send | temp `clientId` (`tmp_…`); bubble shows immediately as "sending…" |
| Delivery state | recipient's socket marks `SENT → DELIVERED` on connect; `message:status` receipt to the sender |
| Read state | opening a conversation emits `message:read` → `MessageRead` rows + `message:status: READ` → blue `✓✓` |
| Typing | debounced `typing:start` / `typing:stop`; 4 s client-side TTL auto-expire |
| Presence | in-process `userId → Set<socketId>`; online while ≥1 socket; broadcast on first-connect / last-disconnect; `presence:update` carries `lastSeen` |
| Unread counts | `messages where senderId ≠ me and createdAt > member.lastReadAt`; "New messages" divider in the thread |
| Reactions | `reaction:toggle` → `MessageReaction` (idempotent via the unique constraint) → `reaction:update` to the room |
| Reply / quote | `replyToId` self-relation, validated to the same conversation; jump-to-original in the UI |
| Edit | `message:edit` — sender-only, TEXT-only; **re-runs profanity moderation**; `message:update` to the room; `editedAt` → "· edited" |
| Delete for everyone | `message:delete { scope: "everyone" }` — sender-only; soft delete (`deletedAt`; body/metadata/reactions cleared); `message:update` → "This message was deleted" |
| Delete for me | `message:delete { scope: "me" }` → `MessageHidden` row → `message:removed` to the acting user's own room (all tabs); filtered from that user's pagination + reconnect sync only |
| Conversation created | `conversation:new` → the other user's client refetches the conversation list |

---

## 8. GIFs & stickers

- **GIFs — GIPHY.** The API key is **server-side only**; the browser calls
  `GET /api/giphy?q=…` (authenticated + rate-limited), which proxies GIPHY
  (`rating=pg-13`, messaging bundle). Sent as a `GIF` message referencing the
  remote URL — the app never proxies the media bytes.
- **Stickers.** A bundled **"Blobs"** pack — 12 SVGs generated by
  `scripts/generate-stickers.ts` into `public/stickers/blobs/`, served as static
  files; `GET /api/stickers` returns the manifest.
- Both render lazily (`loading="lazy"`, `decoding="async"`) with size hints, so
  the message list stays smooth.

---

## 9. Image upload & nudity detection

**Endpoint:** `POST /api/upload` (multipart). Pipeline, in order:

1. **Auth + rate limit** — 10 uploads / user / minute.
2. **Membership check** — sender must belong to the conversation.
3. **Real byte validation** — `file-type` sniffs magic bytes; only genuine
   `image/jpeg` / `image/png`, **max 8 MB** (`MAX_UPLOAD_BYTES`). The filename and
   the client `Content-Type` are never trusted; empty files rejected.
4. **Caption** (if any) goes through the profanity gate.
5. **Nudity / explicit-content detection** — see the model table below.
6. On pass: written to object storage (`./storage/<conv>/<uuid>.<ext>`), an
   `IMAGE` message is created and broadcast over the same `message:new` channel.
7. On fail: **422**, nothing stored, nothing delivered; sender sees
   *"This image was rejected by moderation … It was not delivered."*

Every decision is written to `ModerationLog` with the class probabilities and the
rule that fired.

### The model

| | |
| --- | --- |
| Model | **NSFWJS – MobileNetV2** (open-source, `github.com/infinitered/nsfwjs`, MIT) |
| Size | ~2.6 MB weights + ~126 KB graph (quantised), 224×224 input |
| Where inference runs | **In-process on the Node app server** via `@tensorflow/tfjs` pure-JS **CPU** backend. No GPU, no native addons, no external API, no data leaves the machine. Decoding uses `jpeg-js` / `pngjs`. |
| Latency | ~150–500 ms per image once warm; first call ~1–2 s while the model loads once and is cached for the process lifetime |
| Classes | `Neutral`, `Drawing`, `Sexy`, `Porn`, `Hentai` |
| Decision rule | **Reject if any holds:** `P(Porn) ≥ 0.30`, `P(Hentai) ≥ 0.30`, `P(Sexy) ≥ 0.55`, or `P(Porn) + P(Hentai) + 0.5·P(Sexy) ≥ 0.45` (`NSFW_THRESHOLD`). Per-class gates catch a single strong signal; the combined score catches "a bit of everything". |
| Failure mode | **fail-closed** — if the model can't run, the upload is rejected (`503`), never delivered unchecked |

Model files are downloaded once by `npm run setup:models` into
`public/models/nsfw/` and loaded from `${APP_ORIGIN}/models/nsfw/model.json`, so
inference is fully offline afterwards.

### Not bypassable from the browser

Moderation lives entirely in the server route handler. There is **no** image
message path over the socket — images *must* go through `POST /api/upload`, which
re-runs steps 1–5 regardless of a raw body, a spoofed MIME type or a renamed
file.

---

## 10. Profanity moderation

`src/lib/moderation/profanity.ts`. Enforced in the Socket.IO `message:send`
handler, the `message:edit` handler, and the upload caption check — **never** in
the browser. Blocked attempts return `{ ok: false, code: "PROFANITY" }` and are
written to `ModerationLog`.

**Normalisation** (`normalize.ts`) defeats the common evasions:

| Evasion | Handling |
| --- | --- |
| Casing | lower-cased |
| Accents / diacritics | Unicode NFKD + combining-mark strip |
| Leetspeak (`f4ck`, `sh!t`, `@ss`) | character map `0→o 1→i 3→e 4→a @→a $→s …` |
| Homoglyphs (Cyrillic `а`, `е`, `о` …) | mapped to Latin |
| Repeated letters (`fuuuuck`, `shiiit`) | runs of 3+ collapsed |
| Padding (`f u c k`, `s-h-i-t`, `g o f u c k`) | whole-message letters-only skeleton, substring scan |

**Two passes:** (1) exact-match each normalised token against the blocklist;
(2) scan the collapsed whole-message skeleton for any blocked term as a
substring. An **allowlist** (`class`, `assignment`, `scunthorpe`, `analysis`, …)
prevents the Scunthorpe problem.

---

## 11. Reliability

| Concern | Mechanism |
| --- | --- |
| WebSocket disconnect | Socket.IO auto-reconnect + `connectionStateRecovery` (2-minute window) |
| No lost "accepted" messages | **Persistent outbox** in `localStorage` (`src/lib/client/outbox.ts`) — anything shown optimistically but not yet ack'd is re-sent on reconnect |
| No duplicates on retry | `Message.@@unique([conversationId, clientId])` — `createMessage` catches `P2002` and returns the existing row (`created: false`); the client dedupes by `clientId` / `id` |
| Missed messages during downtime | on reconnect the client calls `message:sync { afterId }`; the server returns everything since that id |
| Optimistic UI | temp id, "sending…", then reconciled to the server message on ack |
| Ack timeout | after 10 s an un-acked message reverts to "pending" and is retried on the next connect |
| Multiple tabs, same account | every socket joins the user's room; `message:new`, receipts, reactions, edits, deletes and presence reach all tabs; presence stays "online" until the **last** tab closes |
| Edit / delete propagation | `message:update` / `message:removed` events keep every open client (and the conversation-list preview) consistent |

---

## 12. Security

| Requirement | Implementation |
| --- | --- |
| Can't read conversations you're not in | every read path calls `isMember(conversationId, userId)` — REST routes, socket handlers, and the authenticated media route `GET /api/files/[...key]` |
| Can't send / edit / delete as another account | the acting user id comes from the verified session (cookie JWT) on the server, never from the payload; edit & "delete for everyone" are additionally **sender-only** |
| Uploaded file type & size | magic-byte sniff (`file-type`), 8 MB cap, JPEG/PNG only, filename ignored; storage keys are server-generated UUIDs, path-traversal-guarded |
| Server-side authn/authz | `httpOnly` `SameSite=Lax` cookie (`secure` in production), `jose` HS256 verification on every request and on the socket handshake; `middleware.ts` only does page redirects |
| Media authorization | images are served through a route that re-checks membership **and** that the key is referenced by a message in that conversation — not from a public folder |
| Rate limiting (`src/lib/rateLimit.ts`) | sends 30 / 10 s · reactions 40 / 10 s · uploads 10 / min · message edit 20 / min · message delete 30 / min · auth 10 / min · GIF search 60 / min · conversation-create 20 / min |

---

## 13. Performance & scaling

**What already scales**

- Cursor pagination + the composite index → load cost is independent of history size.
- Every hot path is indexed (membership, message retrieval, reactions/reads/hidden).
- Idempotency is DB-enforced (`@@unique`), correct under concurrency.
- Unread counts use `lastReadAt`, not a receipt scan.
- REST layer is stateless (JWT cookie) → scales horizontally as-is.
- Media goes to a dedicated store (`storage.ts`), not through oversized request bodies; it's a drop-in seam for S3 / Cloudflare R2.
- Images are lazy-rendered; GIFs/stickers are URL references.

**Single-node assumptions (documented, not accidental)**

Presence, rate limiting and Socket.IO room fan-out are all **in-process** —
correct and sufficient for one node. To run 2+ instances:

- add `@socket.io/redis-adapter` for cross-instance room broadcast (+ sticky sessions),
- move `rateLimit` to Redis `INCR` / `EXPIRE`,
- move `presence` to Redis sets with TTL.

The call sites and contracts (`RateLimitResult`, the `presence` functions) don't
change — only the backing store.

**The per-instance ceiling: image moderation.** `@tensorflow/tfjs` runs the NSFW
model in-process on CPU, synchronously in the request (~200–400 MB RAM, ~150–500 ms
event-loop blocking per image). At scale, move it to a queue (accept upload →
`202` → moderate async → emit `message:new` or a rejection) or an external
service — the upload route is already an isolated pipeline.

**No Redis is used in this build** — a single instance means the in-memory maps
*are* the shared state.

---

## 14. Deployment

The app is **not serverless-compatible** (custom long-lived server + persistent
WebSockets), so Vercel / Netlify won't work. It needs one always-running Node
process (≥ 512 MB RAM), a managed PostgreSQL, and HTTPS.

### Reference deployment: Render (native Node) + Neon + UptimeRobot — free, no card

1. **Neon** → create a project → copy the direct (non-pooled) connection string →
   from your machine: `DATABASE_URL=<neon> npx prisma migrate deploy` then
   `DATABASE_URL=<neon> npm run db:seed`.
2. Push the repo to GitHub.
3. **Render → New Web Service** (Node, Free):
   - **Build command:** `npm install --include=dev && npm run setup:models && npm run build`
     (the `--include=dev` is required because Render sets `NODE_ENV=production`, which otherwise skips the build tools).
   - **Start command:** `npm start`
   - **Environment:** `DATABASE_URL`, `AUTH_SECRET` (`openssl rand -base64 48`),
     `GIPHY_API_KEY`, `HOSTNAME=0.0.0.0`, and `APP_ORIGIN=https://<service>.onrender.com`
     (fix to the real URL after the first deploy). Do **not** set `NODE_ENV` or `PORT`.
4. **UptimeRobot** → HTTP monitor on `…/login` every 5 min so the free instance
   never sleeps.

Other viable hosts: Fly.io / Railway (Docker), a VPS with PM2 + Caddy, or a
Hugging Face Docker Space. Uploaded images live on local disk, so attach a
persistent volume or switch `storage.ts` to R2/S3 if they must survive redeploys.

---

## 15. Environment variables

Copy `.env.example` → `.env`. Every value is a working local default except
`DATABASE_URL` (set your Postgres password). `.env` is git-ignored.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | local Postgres | Prisma connection string |
| `AUTH_SECRET` | dev value | JWT signing key — **must be ≥ 32 chars**; change for any real deployment |
| `AUTH_COOKIE` | `rtm_session` | session cookie name |
| `PORT` | `3000` | server port (host platforms set this) |
| `HOSTNAME` | `localhost` | bind host; `0.0.0.0` in containers |
| `APP_ORIGIN` | `http://localhost:3000` | exact public origin — used for Socket.IO CORS **and** to load the NSFW model file |
| `GIPHY_API_KEY` | public demo key | GIF search (get a free personal key for anything beyond a demo) |
| `STORAGE_DIR` | `./storage` | image blob directory |
| `MAX_UPLOAD_BYTES` | `8388608` | image size limit (8 MB) |
| `NSFW_MODEL_DIR` | `./public/models/nsfw` | where `setup:models` writes the model |
| `NSFW_THRESHOLD` | `0.45` | combined-score cutoff (per-class gates are fixed in code) |

---

## 16. Scripts & testing

| Command | Purpose |
| --- | --- |
| `npm run dev` | esbuild-watch of `server.ts` + Next dev |
| `npm run build` | `prisma generate` → `next build` → esbuild bundle → `.server/server.cjs` |
| `npm start` | production run of the bundled server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` / `npm run db:seed` | sync schema / load demo users + conversation |
| `npm run setup:models` | download the NSFW model into `public/models/nsfw/` |
| `node scripts/generate-stickers.ts` | regenerate the Blobs sticker pack |
| `node scripts/generate-sound.mjs` | regenerate `public/sounds/pop.wav` |
| `node scripts/smoke.mjs` | end-to-end checks against a running server |

**`scripts/smoke.mjs`** (dev server must be running; set `BASE=https://…` to
target a deployed URL) verifies: real-time fan-out, message idempotency, three
profanity-evasion variants, an allowlisted false-positive, cross-conversation
authorization, a benign image passing moderation, and a fake image (bad magic
bytes) being rejected.

Edit / delete behaviour is verified with ad-hoc socket clients during
development; the same paths are exercised by the UI.

---

## 17. Known limitations & trade-offs

- **Single-node** (see §13 for the Redis path). No Redis in this build.
- **Image moderation** decodes JPEG/PNG with pure-JS decoders; WebP/GIF uploads
  are rejected as "unsupported" — a `sharp` or `tfjs-node` step would add them.
- Image moderation is **synchronous in the request** and CPU-bound; at scale it
  belongs on a queue.
- The **GIPHY key** in `.env` is a public demo key with low quotas.
- **Group conversations:** the schema and socket rooms already support N members;
  only the 1:1 UI and "start conversation" flow are built. Large-group fan-out
  would need fan-out-on-read rather than per-user emits.
- On free hosting, uploaded images sit on **ephemeral disk** unless a volume or
  R2/S3 is configured.
- Message list is not virtualised — a conversation scrolled back thousands of
  messages keeps that many DOM nodes (add `react-window` if needed).
