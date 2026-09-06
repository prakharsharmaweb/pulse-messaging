"use client";

import { useCallback, useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import { getSocket } from "@/lib/client/socket";
import { outbox } from "@/lib/client/outbox";
import { useChat, type LocalMessage } from "@/store/chat";
import { toast } from "@/store/toast";
import { notifyMessage, playPop } from "@/lib/client/notifications";
import type { SendAck, SendMessageInput } from "@/lib/socket/events";
import { conversationRoom } from "@/lib/socket/events";
import type { MessageMetadata, ReplyPreview } from "@/lib/types";

const ACK_TIMEOUT = 10_000;

export function useChatSocket(meId: string) {
  const bootstrapped = useRef(false);

  const doSend = useCallback((input: SendMessageInput, isReplay = false) => {
    const socket = getSocket();
    if (!isReplay) outbox.add(input);

    if (!socket.connected) {
      useChat.getState().markLocal(input.conversationId, input.clientId, "pending");
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) useChat.getState().markLocal(input.conversationId, input.clientId, "pending");
    }, ACK_TIMEOUT);

    socket.emit("message:send", input, (ack: SendAck) => {
      settled = true;
      clearTimeout(timer);
      if (ack.ok) {
        outbox.remove(input.clientId);
        useChat.getState().addOrReplaceMessage(ack.message.conversationId, {
          ...ack.message,
          local: { status: "sent" },
        });
      } else if (ack.code === "RATE_LIMITED") {
        useChat.getState().markLocal(input.conversationId, input.clientId, "failed", ack.message);
      } else {
        outbox.remove(input.clientId);
        useChat.getState().markLocal(input.conversationId, input.clientId, "failed", ack.message);
      }
    });
  }, []);

  useEffect(() => {
    useChat.setState({ meId });
    const socket = getSocket();

    const onConnect = () => {
      useChat.getState().setConnection("online");
      for (const entry of outbox.all()) doSend(entry, true);
      const { activeId, messages } = useChat.getState();
      if (activeId) {
        const list = messages[activeId] ?? [];
        const lastServer = [...list]
          .reverse()
          .find((m) => m.local?.status !== "pending" && !m.id.startsWith("tmp_"));
        socket.emit(
          "message:sync",
          { conversationId: activeId, afterId: lastServer?.id ?? null },
          ({ messages: synced }) => {
            for (const m of synced)
              useChat.getState().addOrReplaceMessage(activeId, { ...m, local: { status: "sent" } });
          }
        );
        socket.emit("message:read", { conversationId: activeId });
      }
    };

    const onDisconnect = () => useChat.getState().setConnection("offline");
    const onConnErr = () => useChat.getState().setConnection("offline");

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnErr);

    socket.on("presence:snapshot", ({ online }) => useChat.getState().setOnline(online));
    socket.on("presence:update", ({ userId, online, lastSeen }) => {
      useChat.getState().setUserOnline(userId, online);
      if (!online) useChat.getState().setLastSeen(userId, lastSeen);
    });

    socket.on("typing:update", ({ conversationId, userId, typing }) => {
      if (userId !== meId) useChat.getState().setTyping(conversationId, userId, typing);
    });

    socket.on("message:new", (msg) => {
      const s = useChat.getState();
      s.addOrReplaceMessage(msg.conversationId, { ...msg, local: { status: "sent" } });
      s.bumpUnread(msg.conversationId, msg);
      outbox.remove(msg.clientId);

      const incoming = msg.senderId !== meId;
      if (incoming && s.activeId === msg.conversationId) {
        getSocket().emit("message:read", { conversationId: msg.conversationId });
      }
      if (incoming && (s.activeId !== msg.conversationId || document.hidden)) {
        const convo = s.conversations.find((c) => c.id === msg.conversationId);
        const sender = convo?.participants.find((p) => p.id === msg.senderId);
        playPop();
        void notifyMessage({
          title: sender?.displayName ?? "New message",
          body:
            msg.kind === "TEXT" ? msg.body : msg.kind === "IMAGE" ? "📷 Photo" : msg.kind === "GIF" ? "Sent a GIF" : "Sent a sticker",
          onClick: () => useChat.getState().setActive(msg.conversationId),
        });
      }
    });

    socket.on("message:status", ({ conversationId, messageIds, status, by }) => {
      if (by === meId) return;
      useChat.getState().applyStatus(conversationId, messageIds, status, by);
    });

    socket.on("reaction:update", ({ conversationId, messageId, reactions }) => {
      useChat.getState().applyReaction(conversationId, messageId, reactions);
    });

    socket.on("conversation:new", async () => {
      try {
        const res = await fetch("/api/conversations");
        const data = await res.json();
        useChat.getState().setConversations(data.conversations);
        getSocket().emit("presence:ping");
      } catch {
        /* ignore */
      }
    });

    if (!socket.connected) socket.connect();
    bootstrapped.current = true;

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnErr);
      socket.off("presence:snapshot");
      socket.off("presence:update");
      socket.off("typing:update");
      socket.off("message:new");
      socket.off("message:status");
      socket.off("reaction:update");
      socket.off("conversation:new");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  const sendMessage = useCallback(
    (
      conversationId: string,
      kind: SendMessageInput["kind"],
      body: string,
      metadata?: MessageMetadata,
      reply?: LocalMessage | null
    ) => {
      const clientId = `tmp_${nanoid(16)}`;
      const replyTo: ReplyPreview | null = reply
        ? {
            id: reply.id,
            senderId: reply.senderId,
            kind: reply.kind,
            preview:
              reply.kind === "TEXT"
                ? reply.body.slice(0, 120)
                : reply.kind === "IMAGE"
                ? "📷 Photo"
                : reply.kind === "GIF"
                ? "GIF"
                : "Sticker",
          }
        : null;
      const optimistic: LocalMessage = {
        id: clientId,
        clientId,
        conversationId,
        senderId: meId,
        kind,
        body,
        metadata: metadata ?? null,
        status: "SENT",
        createdAt: new Date().toISOString(),
        readBy: [],
        reactions: [],
        replyTo,
        local: { status: "pending" },
      };
      useChat.getState().addOrReplaceMessage(conversationId, optimistic);
      doSend({ conversationId, clientId, kind, body, metadata, replyToId: replyTo?.id ?? null });
    },
    [doSend, meId]
  );

  const retryMessage = useCallback(
    (conversationId: string, clientId: string) => {
      const list = useChat.getState().messages[conversationId] ?? [];
      const msg = list.find((m) => m.clientId === clientId);
      if (!msg) return;
      useChat.getState().markLocal(conversationId, clientId, "pending");
      doSend({
        conversationId,
        clientId,
        kind: msg.kind,
        body: msg.body,
        metadata: msg.metadata ?? undefined,
        replyToId: msg.replyTo?.id ?? null,
      });
    },
    [doSend]
  );

  const reactToMessage = useCallback((messageId: string, emoji: string) => {
    getSocket().emit("reaction:toggle", { messageId, emoji }, (res) => {
      if (!res.ok && res.message) toast.error(res.message);
    });
  }, []);

  const joinConversation = useCallback((conversationId: string) => {
    getSocket().emit("message:read", { conversationId });
  }, []);

  const setTyping = useCallback((conversationId: string, typing: boolean) => {
    getSocket().emit(typing ? "typing:start" : "typing:stop", { conversationId });
  }, []);

  return { sendMessage, retryMessage, reactToMessage, joinConversation, setTyping };
}

export { conversationRoom };
