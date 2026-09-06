"use client";

import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useChat } from "@/store/chat";
import { useTheme } from "@/components/ThemeProvider";
import { notificationPrefs, ensureNotificationPermission } from "@/lib/client/notifications";
import { disconnectSocket } from "@/lib/client/socket";
import { toast } from "@/store/toast";
import type { ParticipantDTO } from "@/lib/types";
import "./command-palette.css";

export default function CommandPalette({
  open,
  onClose,
  meId,
  onOpenConversation,
}: {
  open: boolean;
  onClose: () => void;
  meId: string;
  onOpenConversation: (id: string) => void;
}) {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const conversations = useChat((s) => s.conversations);
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<ParticipantDTO[]>([]);
  const [sound, setSound] = useState(true);
  const [notifs, setNotifs] = useState(true);

  useEffect(() => {
    if (open) {
      setQ("");
      setSound(notificationPrefs.sound);
      setNotifs(notificationPrefs.notifications);
    }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 1) {
      setPeople([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/users?q=${encodeURIComponent(q)}`);
      if (res.ok) setPeople((await res.json()).users);
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const convItems = useMemo(
    () =>
      conversations.map((c) => {
        const o = c.participants.find((p) => p.id !== meId) ?? c.participants[0];
        return { id: c.id, name: o.displayName, username: o.username };
      }),
    [conversations, meId]
  );

  async function startWith(userId: string) {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      toast.error("Couldn't start that conversation.");
      return;
    }
    const { conversation } = await res.json();
    const list = await (await fetch("/api/conversations")).json();
    useChat.getState().setConversations(list.conversations);
    onOpenConversation(conversation.id);
    onClose();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    disconnectSocket();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      label="Command palette"
      className="cmdk-dialog"
    >
      <Command.Input value={q} onValueChange={setQ} placeholder="Search conversations, people, actions…" />
      <Command.List>
        <Command.Empty>No results.</Command.Empty>

        <Command.Group heading="Conversations">
          {convItems.map((c) => (
            <Command.Item
              key={c.id}
              value={`conv ${c.name} ${c.username}`}
              onSelect={() => {
                onOpenConversation(c.id);
                onClose();
              }}
            >
              <span className="cmdk-dot" />
              {c.name}
              <span className="cmdk-hint">@{c.username}</span>
            </Command.Item>
          ))}
        </Command.Group>

        {people.length > 0 && (
          <Command.Group heading="Start a conversation">
            {people.map((p) => (
              <Command.Item key={p.id} value={`person ${p.displayName} ${p.username}`} onSelect={() => startWith(p.id)}>
                <span className="cmdk-plus">+</span>
                {p.displayName}
                <span className="cmdk-hint">@{p.username}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Actions">
          <Command.Item value="action toggle theme dark light" onSelect={() => { toggle(); onClose(); }}>
            {theme === "dark" ? "☀" : "☾"} Switch to {theme === "dark" ? "light" : "dark"} theme
          </Command.Item>
          <Command.Item
            value="action notification sound mute"
            onSelect={() => {
              const next = !sound;
              notificationPrefs.setSound(next);
              setSound(next);
            }}
          >
            {sound ? "🔔" : "🔕"} {sound ? "Mute" : "Unmute"} message sound
          </Command.Item>
          <Command.Item
            value="action desktop notifications"
            onSelect={async () => {
              const next = !notifs;
              notificationPrefs.setNotifications(next);
              setNotifs(next);
              if (next) await ensureNotificationPermission();
            }}
          >
            {notifs ? "💬" : "🚫"} {notifs ? "Disable" : "Enable"} desktop notifications
          </Command.Item>
          <Command.Item value="action sign out logout" onSelect={logout}>
            ⎋ Sign out
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
