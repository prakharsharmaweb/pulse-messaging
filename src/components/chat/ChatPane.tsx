"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { SessionUser } from "@/lib/auth-core";
import type { ConversationDTO } from "@/lib/types";
import { useChat, type LocalMessage } from "@/store/chat";
import type { useChatSocket } from "@/hooks/useChatSocket";
import { dayLabel } from "@/lib/format";
import Avatar from "./Avatar";
import MessageItem from "./MessageItem";
import Composer from "./Composer";
import TypingDots from "./TypingDots";
import ScrollToBottom from "./ScrollToBottom";
import Lightbox from "./Lightbox";
import { MessageListSkeleton } from "./Skeletons";
import { NoConversationSelected } from "./EmptyState";

type SocketApi = ReturnType<typeof useChatSocket>;
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export default function ChatPane({
  me,
  conversation,
  socket,
  onLoadOlder,
  onBack,
}: {
  me: SessionUser;
  conversation: ConversationDTO | null;
  socket: SocketApi;
  onLoadOlder: (id: string) => void;
  onBack: () => void;
}) {
  const messages = useChat((s) => (conversation ? s.messages[conversation.id] : undefined));
  const cursor = useChat((s) => (conversation ? s.cursors[conversation.id] : undefined));
  const online = useChat((s) => s.online);
  const lastSeenMap = useChat((s) => s.lastSeen);
  const typing = useChat((s) => (conversation ? s.typing[conversation.id] : undefined));
  const setReplyTo = useChat((s) => s.setReplyTo);
  const setEditing = useChat((s) => s.setEditing);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevScrollHeight = useRef(0);
  const lastCount = useRef(0);
  const seenIds = useRef<Set<string>>(new Set());
  const [showFab, setShowFab] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const other =
    conversation?.participants.find((p) => p.id !== me.id) ?? conversation?.participants[0];
  const someoneTyping = typing && Object.keys(typing).length > 0;
  const isOnline = other ? online.has(other.id) : false;

  const presenceText = useMemo(() => {
    if (someoneTyping) return "typing…";
    if (isOnline) return "Online";
    const seen = other ? lastSeenMap[other.id] : null;
    if (seen) {
      try {
        return `last seen ${formatDistanceToNow(new Date(seen), { addSuffix: true })}`;
      } catch {
        /* ignore */
      }
    }
    return "Offline";
  }, [someoneTyping, isOnline, other, lastSeenMap]);

  const atBottom = () => {
    const el = scrollRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !messages) return;
    const grew = messages.length > lastCount.current;
    if (grew && (atBottom() || messages[messages.length - 1]?.senderId === me.id)) {
      bottomRef.current?.scrollIntoView({ behavior: lastCount.current === 0 ? "auto" : "smooth" });
    }
    lastCount.current = messages.length;
  }, [messages, me.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevScrollHeight.current && el.scrollHeight > prevScrollHeight.current) {
      el.scrollTop += el.scrollHeight - prevScrollHeight.current;
    }
    prevScrollHeight.current = 0;
  }, [messages]);

  // track which server ids we've already rendered so only truly new ones animate
  useEffect(() => {
    if (!messages) return;
    const id = requestAnimationFrame(() => {
      for (const m of messages) if (m.id) seenIds.current.add(m.id);
    });
    return () => cancelAnimationFrame(id);
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el || !conversation) return;
    setShowFab(el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight);
    if (el.scrollTop < 80 && cursor?.hasMore && !cursor.loading) {
      prevScrollHeight.current = el.scrollHeight;
      onLoadOlder(conversation.id);
    }
  }

  const jumpTo = useCallback((id: string) => {
    const node = rowRefs.current.get(id);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.remove("animate-highlight-fade");
    void node.offsetWidth;
    node.classList.add("animate-highlight-fade");
  }, []);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    if (conversation) socket.joinConversation(conversation.id);
  };

  const grouped = useMemo(() => groupMessages(messages ?? []), [messages]);
  const unreadAnchorId = useMemo(() => {
    if (!conversation || !messages) return null;
    const cut = new Date(conversation.myLastReadAt).getTime();
    const first = messages.find((m) => m.senderId !== me.id && new Date(m.createdAt).getTime() > cut);
    return first?.id ?? null;
  }, [conversation, messages, me.id]);

  if (!conversation || !other) return <NoConversationSelected />;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="surface-blur z-10 flex items-center gap-3 border-b border-surface-border px-4 py-2.5">
        <button onClick={onBack} className="btn-ghost h-9 w-9 !px-0 md:hidden" aria-label="Back">
          ‹
        </button>
        <Avatar name={other.displayName} color={other.avatarColor} online={isOnline} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{other.displayName}</p>
          <p className={`text-xs ${someoneTyping || isOnline ? "text-brand" : "text-ink-faint"}`}>
            {presenceText}
          </p>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {!messages ? (
          <MessageListSkeleton />
        ) : (
          <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
            {cursor?.hasMore && (
              <div className="mb-2 text-center text-xs text-ink-faint">
                {cursor.loading ? "Loading earlier messages…" : "Scroll up for earlier messages"}
              </div>
            )}
            {!cursor?.hasMore && messages.length > 0 && (
              <div className="mb-3 text-center text-xs text-ink-faint">Beginning of your conversation</div>
            )}
            {messages.length === 0 && (
              <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
                Say hi to {other.displayName} 👋
              </div>
            )}

            {grouped.map((group) => (
              <div key={group.label}>
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-surface-overlay px-2.5 py-1 text-[11px] font-medium text-ink-muted">
                    {group.label}
                  </span>
                </div>
                {group.items.map((entry) => (
                  <div key={entry.m.id || entry.m.clientId}>
                    {unreadAnchorId === entry.m.id && (
                      <div className="my-3 flex items-center gap-3 text-[11px] font-medium text-brand">
                        <span className="h-px flex-1 bg-brand/30" />
                        New messages
                        <span className="h-px flex-1 bg-brand/30" />
                      </div>
                    )}
                    <div
                      ref={(node) => {
                        if (node) rowRefs.current.set(entry.m.id || entry.m.clientId, node);
                      }}
                    >
                      <MessageItem
                        message={entry.m}
                        mine={entry.m.senderId === me.id}
                        showTail={entry.tail}
                        grouped={entry.grouped}
                        meId={me.id}
                        isNew={Boolean(entry.m.id) && !seenIds.current.has(entry.m.id)}
                        onRetry={() => socket.retryMessage(conversation.id, entry.m.clientId)}
                        onReact={(emoji) => entry.m.id && socket.reactToMessage(entry.m.id, emoji)}
                        onReply={() => setReplyTo(entry.m)}
                        onEdit={() => setEditing(entry.m)}
                        onDelete={(scope) => socket.deleteMessage(entry.m, scope)}
                        onJumpTo={jumpTo}
                        onOpenImage={setLightbox}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {someoneTyping && (
              <div className="mt-1 flex items-center gap-2 px-1">
                <Avatar name={other.displayName} color={other.avatarColor} size={26} />
                <TypingDots />
              </div>
            )}
            <div ref={bottomRef} className="h-1" />
          </div>
        )}

        <ScrollToBottom show={showFab} unread={conversation.unreadCount} onClick={scrollToBottom} />
      </div>

      <Composer conversationId={conversation.id} socket={socket} />
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

type Entry = { m: LocalMessage; tail: boolean; grouped: boolean };

function groupMessages(messages: LocalMessage[]): { label: string; items: Entry[] }[] {
  const groups: { label: string; items: Entry[] }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const label = dayLabel(m.createdAt);
    const last = groups[groups.length - 1];

    const groupedWithPrev =
      !!prev &&
      prev.senderId === m.senderId &&
      dayLabel(prev.createdAt) === label &&
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS &&
      !m.replyTo;
    const groupedWithNext =
      !!next &&
      next.senderId === m.senderId &&
      dayLabel(next.createdAt) === label &&
      new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() < GROUP_WINDOW_MS &&
      !next.replyTo;

    const entry: Entry = { m, tail: !groupedWithNext, grouped: groupedWithPrev };
    if (last && last.label === label) last.items.push(entry);
    else groups.push({ label, items: [entry] });
  }
  return groups;
}
