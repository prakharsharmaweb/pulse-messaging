"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { m } from "framer-motion";
import type { SessionUser } from "@/lib/auth-core";
import type { ConversationDTO } from "@/lib/types";
import { useChat } from "@/store/chat";
import { conversationTime } from "@/lib/format";
import { disconnectSocket } from "@/lib/client/socket";
import { useTheme } from "@/components/ThemeProvider";
import Avatar from "./Avatar";
import NewChatDialog from "./NewChatDialog";
import { ConversationListSkeleton } from "./Skeletons";
import { NoConversationsYet } from "./EmptyState";
import clsx from "clsx";

function other(c: ConversationDTO, meId: string) {
  return c.participants.find((p) => p.id !== meId) ?? c.participants[0];
}

export default function Sidebar({
  me,
  conversations,
  loading,
  activeId,
  onOpen,
  onOpenPalette,
}: {
  me: SessionUser;
  conversations: ConversationDTO[];
  loading: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
  onOpenPalette: () => void;
}) {
  const router = useRouter();
  const online = useChat((s) => s.online);
  const typing = useChat((s) => s.typing);
  const { theme, toggle } = useTheme();
  const [newChat, setNewChat] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((c) => {
      const o = other(c, me.id);
      return o.displayName.toLowerCase().includes(term) || o.username.toLowerCase().includes(term);
    });
  }, [conversations, q, me.id]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    disconnectSocket();
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={me.displayName} color={me.avatarColor} size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{me.displayName}</p>
            <p className="truncate text-xs text-ink-faint">@{me.username}</p>
          </div>
        </div>
        <div className="flex items-center">
          <button onClick={toggle} className="btn-ghost h-9 w-9 !px-0" aria-label="Toggle theme">
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button onClick={() => setNewChat(true)} className="btn-ghost h-9 w-9 !px-0" aria-label="New conversation">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button onClick={logout} className="btn-ghost h-9 w-9 !px-0" aria-label="Sign out">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </header>

      <div className="px-3 pb-2">
        <button
          onClick={onOpenPalette}
          className="flex w-full items-center gap-2 rounded-xl border border-surface-border bg-surface-raised px-3 py-2 text-left text-xs text-ink-faint transition hover:border-brand/40"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="M20 20l-3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Search or jump to…
          <kbd className="ml-auto rounded border border-surface-border bg-surface-overlay px-1.5 py-0.5 text-[10px]">⌘K</kbd>
        </button>
      </div>

      <div className="px-3 pb-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter conversations"
          className="input py-2 text-xs"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading && conversations.length === 0 ? (
          <ConversationListSkeleton />
        ) : conversations.length === 0 ? (
          <NoConversationsYet onStart={() => setNewChat(true)} />
        ) : filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-ink-faint">No matches.</p>
        ) : (
          filtered.map((c) => {
            const o = other(c, me.id);
            const isTyping = Object.keys(typing[c.id] ?? {}).length > 0;
            const active = activeId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => onOpen(c.id)}
                className={clsx(
                  "relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition",
                  active ? "bg-surface-overlay" : "hover:bg-surface-raised"
                )}
              >
                {active && (
                  <m.span
                    layoutId="active-conv"
                    className="absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-aurora"
                  />
                )}
                <Avatar name={o.displayName} color={o.avatarColor} online={online.has(o.id)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium">{o.displayName}</p>
                    {c.lastMessage && (
                      <span className="shrink-0 text-[11px] text-ink-faint">
                        {conversationTime(c.lastMessage.createdAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-ink-muted">
                      {isTyping ? (
                        <span className="text-brand">typing…</span>
                      ) : (
                        <Preview c={c} meId={me.id} />
                      )}
                    </p>
                    {c.unreadCount > 0 && (
                      <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-aurora px-1 text-[10px] font-semibold text-white">
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {newChat && (
        <NewChatDialog
          onClose={() => setNewChat(false)}
          onCreated={(id) => {
            setNewChat(false);
            onOpen(id);
          }}
        />
      )}
    </>
  );
}

function Preview({ c, meId }: { c: ConversationDTO; meId: string }) {
  const msg = c.lastMessage;
  if (!msg) return <span className="text-ink-faint">No messages yet</span>;
  if (msg.deletedAt) return <span className="italic text-ink-faint">This message was deleted</span>;
  const prefix = msg.senderId === meId ? "You: " : "";
  const text =
    msg.kind === "TEXT" ? msg.body : msg.kind === "IMAGE" ? "📷 Photo" : msg.kind === "GIF" ? "GIF" : "Sticker";
  return (
    <>
      {prefix}
      {text}
    </>
  );
}
