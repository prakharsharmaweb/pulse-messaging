"use client";

import { useEffect, useState } from "react";
import { m } from "framer-motion";
import type { ParticipantDTO } from "@/lib/types";
import { useChat } from "@/store/chat";
import { toast } from "@/store/toast";
import Avatar from "./Avatar";

export default function NewChatDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<ParticipantDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const setConversations = useChat((s) => s.setConversations);

  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await fetch(`/api/users?q=${encodeURIComponent(q)}`);
      if (res.ok) setUsers((await res.json()).users);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function start(userId: string) {
    setBusy(true);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Couldn't start that conversation.");
      return;
    }
    const { conversation } = await res.json();
    const list = await (await fetch("/api/conversations")).json();
    setConversations(list.conversations);
    onCreated(conversation.id);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-24 backdrop-blur-sm"
      onClick={onClose}
    >
      <m.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.16 }}
        className="card w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-surface-border p-4">
          <h2 className="mb-3 text-sm font-semibold">New conversation</h2>
          <input
            autoFocus
            className="input"
            placeholder="Search people by name or @username"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {users.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-ink-faint">No people found.</p>
          )}
          {users.map((u) => (
            <button
              key={u.id}
              disabled={busy}
              onClick={() => start(u.id)}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left hover:bg-surface-overlay disabled:opacity-50"
            >
              <Avatar name={u.displayName} color={u.avatarColor} size={36} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{u.displayName}</p>
                <p className="truncate text-xs text-ink-faint">@{u.username}</p>
              </div>
            </button>
          ))}
        </div>
      </m.div>
    </div>
  );
}
