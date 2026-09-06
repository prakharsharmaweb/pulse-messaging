"use client";

import { create } from "zustand";
import type { ConversationDTO, MessageDTO, ReactionGroup } from "@/lib/types";

export type LocalStatus = "pending" | "failed" | "sent";

export type LocalMessage = MessageDTO & {
  local?: { status: LocalStatus; error?: string };
};

type TypingState = Record<string, Record<string, number>>; // conv -> user -> expiresAt

type ChatState = {
  meId: string;
  connection: "connecting" | "online" | "offline";
  conversations: ConversationDTO[];
  activeId: string | null;
  messages: Record<string, LocalMessage[]>;
  cursors: Record<string, { nextCursor: string | null; hasMore: boolean; loading: boolean }>;
  online: Set<string>;
  lastSeen: Record<string, string>;
  typing: TypingState;
  replyTo: LocalMessage | null;
  editing: LocalMessage | null;

  setConnection: (c: ChatState["connection"]) => void;
  setConversations: (c: ConversationDTO[]) => void;
  upsertConversation: (c: ConversationDTO) => void;
  setActive: (id: string | null) => void;

  setMessages: (conv: string, msgs: LocalMessage[], meta: { nextCursor: string | null; hasMore: boolean }) => void;
  prependMessages: (conv: string, msgs: LocalMessage[], meta: { nextCursor: string | null; hasMore: boolean }) => void;
  setCursorLoading: (conv: string, loading: boolean) => void;
  addOrReplaceMessage: (conv: string, msg: LocalMessage) => void;
  markLocal: (conv: string, clientId: string, status: LocalStatus, error?: string) => void;
  applyStatus: (conv: string, messageIds: string[], status: MessageDTO["status"], readerId: string) => void;
  applyReaction: (conv: string, messageId: string, reactions: ReactionGroup[]) => void;
  updateMessage: (conv: string, msg: MessageDTO) => void;
  removeMessage: (conv: string, messageId: string) => void;
  bumpUnread: (conv: string, msg: MessageDTO) => void;
  clearUnread: (conv: string) => void;
  setReplyTo: (msg: LocalMessage | null) => void;
  setEditing: (msg: LocalMessage | null) => void;

  setOnline: (ids: string[]) => void;
  setUserOnline: (id: string, online: boolean) => void;
  setLastSeen: (id: string, iso: string) => void;
  setTyping: (conv: string, userId: string, typing: boolean) => void;
};

const TYPING_TTL = 4000;

export const useChat = create<ChatState>((set, get) => ({
  meId: "",
  connection: "connecting",
  conversations: [],
  activeId: null,
  messages: {},
  cursors: {},
  online: new Set(),
  lastSeen: {},
  typing: {},
  replyTo: null,
  editing: null,

  setConnection: (connection) => set({ connection }),
  setConversations: (conversations) => set({ conversations }),
  upsertConversation: (c) =>
    set((s) => {
      const rest = s.conversations.filter((x) => x.id !== c.id);
      return { conversations: [c, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
    }),
  setActive: (activeId) => set({ activeId, editing: null }),

  setMessages: (conv, msgs, meta) =>
    set((s) => ({
      messages: { ...s.messages, [conv]: msgs },
      cursors: { ...s.cursors, [conv]: { ...meta, loading: false } },
    })),
  prependMessages: (conv, msgs, meta) =>
    set((s) => ({
      messages: { ...s.messages, [conv]: [...msgs, ...(s.messages[conv] ?? [])] },
      cursors: { ...s.cursors, [conv]: { ...meta, loading: false } },
    })),
  setCursorLoading: (conv, loading) =>
    set((s) => ({
      cursors: {
        ...s.cursors,
        [conv]: { ...(s.cursors[conv] ?? { nextCursor: null, hasMore: false }), loading },
      },
    })),

  addOrReplaceMessage: (conv, msg) =>
    set((s) => {
      const list = s.messages[conv] ?? [];
      const idx = list.findIndex(
        (m) => m.clientId === msg.clientId || (msg.id && m.id === msg.id)
      );
      let next: LocalMessage[];
      if (idx >= 0) {
        next = [...list];
        next[idx] = { ...next[idx], ...msg, local: msg.local ?? { status: "sent" } };
      } else {
        next = [...list, msg];
      }
      next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { messages: { ...s.messages, [conv]: next } };
    }),

  markLocal: (conv, clientId, status, error) =>
    set((s) => {
      const list = s.messages[conv] ?? [];
      return {
        messages: {
          ...s.messages,
          [conv]: list.map((m) =>
            m.clientId === clientId ? { ...m, local: { status, error } } : m
          ),
        },
      };
    }),

  applyStatus: (conv, messageIds, status, readerId) =>
    set((s) => {
      const idset = new Set(messageIds);
      const list = s.messages[conv] ?? [];
      return {
        messages: {
          ...s.messages,
          [conv]: list.map((m) => {
            if (!idset.has(m.id)) return m;
            const readBy = status === "READ" && !m.readBy.includes(readerId)
              ? [...m.readBy, readerId]
              : m.readBy;
            return { ...m, status, readBy };
          }),
        },
      };
    }),

  applyReaction: (conv, messageId, reactions) =>
    set((s) => {
      const list = s.messages[conv] ?? [];
      return {
        messages: {
          ...s.messages,
          [conv]: list.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
        },
      };
    }),

  updateMessage: (conv, msg) =>
    set((s) => {
      const list = s.messages[conv];
      const messages = list
        ? {
            ...s.messages,
            [conv]: list.map((m) =>
              m.id === msg.id ? { ...m, ...msg, local: { status: "sent" as const } } : m
            ),
          }
        : s.messages;
      const conversations = s.conversations.map((c) =>
        c.id === conv && c.lastMessage?.id === msg.id ? { ...c, lastMessage: msg } : c
      );
      return { messages, conversations };
    }),

  removeMessage: (conv, messageId) =>
    set((s) => {
      const list = s.messages[conv];
      let messages = s.messages;
      let lastRemaining: MessageDTO | null = null;
      if (list) {
        const filtered = list.filter((m) => m.id !== messageId);
        lastRemaining = filtered[filtered.length - 1] ?? null;
        messages = { ...s.messages, [conv]: filtered };
      }
      const conversations = s.conversations.map((c) =>
        c.id === conv && c.lastMessage?.id === messageId ? { ...c, lastMessage: lastRemaining } : c
      );
      return { messages, conversations };
    }),

  setReplyTo: (replyTo) => set({ replyTo }),
  setEditing: (editing) => set({ editing, replyTo: editing ? null : get().replyTo }),

  bumpUnread: (conv, msg) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conv
          ? {
              ...c,
              lastMessage: msg,
              updatedAt: msg.createdAt,
              unreadCount:
                msg.senderId !== s.meId && s.activeId !== conv
                  ? c.unreadCount + 1
                  : c.unreadCount,
            }
          : c
      ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    })),

  clearUnread: (conv) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conv ? { ...c, unreadCount: 0 } : c
      ),
    })),

  setOnline: (ids) => set({ online: new Set(ids) }),
  setUserOnline: (id, online) =>
    set((s) => {
      const next = new Set(s.online);
      if (online) next.add(id);
      else next.delete(id);
      return { online: next };
    }),
  setLastSeen: (id, iso) => set((s) => ({ lastSeen: { ...s.lastSeen, [id]: iso } })),

  setTyping: (conv, userId, typing) =>
    set((s) => {
      const convTyping = { ...(s.typing[conv] ?? {}) };
      if (typing) convTyping[userId] = Date.now() + TYPING_TTL;
      else delete convTyping[userId];
      return { typing: { ...s.typing, [conv]: convTyping } };
    }),
}));

// prune expired typing markers
if (typeof window !== "undefined") {
  setInterval(() => {
    const { typing } = useChat.getState();
    const now = Date.now();
    let changed = false;
    const next: TypingState = {};
    for (const [conv, users] of Object.entries(typing)) {
      const kept: Record<string, number> = {};
      for (const [u, exp] of Object.entries(users)) {
        if (exp > now) kept[u] = exp;
        else changed = true;
      }
      next[conv] = kept;
    }
    if (changed) useChat.setState({ typing: next });
  }, 1500);
}
