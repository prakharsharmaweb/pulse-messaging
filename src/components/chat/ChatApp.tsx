"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/auth-core";
import type { ConversationDTO, MessageDTO } from "@/lib/types";
import { useChat } from "@/store/chat";
import { useChatSocket } from "@/hooks/useChatSocket";
import Sidebar from "./Sidebar";
import ChatPane from "./ChatPane";
import ConnectionBanner from "./ConnectionBanner";
import CommandPalette from "@/components/CommandPalette";

const withLocal = (m: MessageDTO) => ({ ...m, local: { status: "sent" as const } });

export default function ChatApp({
  me,
  initialConversations,
}: {
  me: SessionUser;
  initialConversations: ConversationDTO[];
}) {
  const socket = useChatSocket(me.id);
  const {
    conversations,
    activeId,
    setConversations,
    setActive,
    setMessages,
    setCursorLoading,
    prependMessages,
    clearUnread,
  } = useChat();
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [listLoading, setListLoading] = useState(true);

  useEffect(() => {
    setConversations(initialConversations);
    setListLoading(false);
  }, [initialConversations, setConversations]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        document.documentElement.classList.toggle("dark");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      setCursorLoading(conversationId, true);
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      if (!res.ok) return;
      const page = await res.json();
      setMessages(conversationId, page.messages.map(withLocal), {
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      });
    },
    [setCursorLoading, setMessages]
  );

  const loadOlder = useCallback(
    async (conversationId: string) => {
      const cursor = useChat.getState().cursors[conversationId];
      if (!cursor?.hasMore || cursor.loading) return;
      setCursorLoading(conversationId, true);
      const res = await fetch(
        `/api/conversations/${conversationId}/messages?cursor=${cursor.nextCursor}`
      );
      if (!res.ok) {
        setCursorLoading(conversationId, false);
        return;
      }
      const page = await res.json();
      prependMessages(conversationId, page.messages.map(withLocal), {
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      });
    },
    [prependMessages, setCursorLoading]
  );

  const openConversation = useCallback(
    async (conversationId: string) => {
      setActive(conversationId);
      setMobileView("chat");
      clearUnread(conversationId);
      if (!useChat.getState().messages[conversationId]) {
        await loadMessages(conversationId);
      }
      socket.joinConversation(conversationId);
    },
    [clearUnread, loadMessages, setActive, socket]
  );

  const active = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface text-ink">
      <div className="flex w-full flex-col">
        <ConnectionBanner />
        <div className="flex min-h-0 flex-1">
          <aside
            className={`${
              mobileView === "chat" ? "hidden" : "flex"
            } w-full flex-col border-r border-surface-border md:flex md:w-[340px] md:shrink-0`}
          >
            <Sidebar
              me={me}
              conversations={conversations}
              loading={listLoading}
              activeId={activeId}
              onOpen={openConversation}
              onOpenPalette={() => setPaletteOpen(true)}
            />
          </aside>

          <div
            className={`${mobileView === "list" ? "hidden" : "flex"} min-w-0 flex-1 md:flex`}
          >
            <ChatPane
              me={me}
              conversation={active}
              socket={socket}
              onLoadOlder={loadOlder}
              onBack={() => setMobileView("list")}
            />
          </div>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        meId={me.id}
        onOpenConversation={openConversation}
      />
    </div>
  );
}
