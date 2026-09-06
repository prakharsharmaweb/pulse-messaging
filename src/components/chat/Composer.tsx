"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { nanoid } from "nanoid";
import type { useChatSocket } from "@/hooks/useChatSocket";
import { useChat } from "@/store/chat";
import { toast } from "@/store/toast";
import GifStickerPicker from "./GifStickerPicker";
import ModerationNotice, { type ModerationInfo } from "./ModerationNotice";

type SocketApi = ReturnType<typeof useChatSocket>;

export default function Composer({
  conversationId,
  socket,
}: {
  conversationId: string;
  socket: SocketApi;
}) {
  const [text, setText] = useState("");
  const [panel, setPanel] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<ModerationInfo | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const typingRef = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout>>();

  const meId = useChat((s) => s.meId);
  const replyTo = useChat((s) => s.replyTo);
  const setReplyTo = useChat((s) => s.setReplyTo);
  const editing = useChat((s) => s.editing);
  const setEditing = useChat((s) => s.setEditing);
  const participants = useChat((s) => s.conversations.find((c) => c.id === conversationId)?.participants);

  useEffect(() => {
    setText("");
    setNotice(null);
    setPanel(false);
    setEditing(null);
  }, [conversationId, setEditing]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  useEffect(() => {
    if (editing) {
      setText(editing.body);
      areaRef.current?.focus();
    } else if (replyTo) {
      areaRef.current?.focus();
    }
  }, [editing, replyTo]);

  function onType(value: string) {
    setText(value);
    if (editing) return; // editing shouldn't broadcast typing
    if (!typingRef.current) {
      typingRef.current = true;
      socket.setTyping(conversationId, true);
    }
    clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      typingRef.current = false;
      socket.setTyping(conversationId, false);
    }, 1800);
  }

  function stopTyping() {
    clearTimeout(stopTimer.current);
    if (typingRef.current) {
      typingRef.current = false;
      socket.setTyping(conversationId, false);
    }
  }

  function submit() {
    const body = text.trim();
    if (!body) return;

    if (editing) {
      if (body !== editing.body) socket.editMessage(editing, body);
      setEditing(null);
      setText("");
      return;
    }

    socket.sendMessage(conversationId, "TEXT", body, undefined, replyTo);
    setText("");
    setReplyTo(null);
    stopTyping();
  }

  function cancelEditing() {
    setEditing(null);
    setText("");
  }

  async function sendImage(file: File) {
    setNotice(null);
    setPanel(false);
    if (editing) setEditing(null);
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      setNotice({ kind: "error", message: "Only JPEG and PNG images are supported." });
      return;
    }
    setUploading(true);
    const clientId = `tmp_${nanoid(16)}`;
    const form = new FormData();
    form.append("file", file);
    form.append("conversationId", conversationId);
    form.append("clientId", clientId);
    if (text.trim()) form.append("caption", text.trim());
    if (replyTo) form.append("replyToId", replyTo.id);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setNotice({
          kind: data.moderation === "nudity" ? "nudity" : data.moderation === "profanity" ? "profanity" : "error",
          message: data.error ?? "Upload failed.",
          score: data.score,
          threshold: data.threshold,
        });
        return;
      }
      useChat.getState().addOrReplaceMessage(conversationId, { ...data.message, local: { status: "sent" } });
      setText("");
      setReplyTo(null);
    } catch {
      toast.error("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  const replySender = replyTo
    ? replyTo.senderId === meId
      ? "yourself"
      : participants?.find((p) => p.id === replyTo.senderId)?.displayName ?? "message"
    : null;

  return (
    <div
      className="relative border-t border-surface-border px-3 py-2.5"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) sendImage(f);
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-xl border-2 border-dashed border-brand bg-brand/10 text-sm font-medium text-brand">
          Drop an image to send
        </div>
      )}

      <AnimatePresence>{notice && <ModerationNotice info={notice} onDismiss={() => setNotice(null)} />}</AnimatePresence>

      <AnimatePresence>
        {editing && (
          <m.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2 flex items-center gap-2 overflow-hidden rounded-lg border-l-2 border-brand bg-surface-overlay px-3 py-1.5 text-xs"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-brand">Editing message</p>
              <p className="truncate text-ink-muted">{editing.body}</p>
            </div>
            <button onClick={cancelEditing} aria-label="Cancel editing" className="text-ink-faint hover:text-ink">
              ✕
            </button>
          </m.div>
        )}
        {!editing && replyTo && (
          <m.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2 flex items-center gap-2 overflow-hidden rounded-lg border-l-2 border-brand bg-surface-overlay px-3 py-1.5 text-xs"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-brand">Replying to {replySender}</p>
              <p className="truncate text-ink-muted">
                {replyTo.kind === "TEXT"
                  ? replyTo.body
                  : replyTo.kind === "IMAGE"
                  ? "📷 Photo"
                  : replyTo.kind === "GIF"
                  ? "GIF"
                  : "Sticker"}
              </p>
            </div>
            <button onClick={() => setReplyTo(null)} aria-label="Cancel reply" className="text-ink-faint hover:text-ink">
              ✕
            </button>
          </m.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panel && !editing && (
          <GifStickerPicker
            onGif={(gif) => {
              socket.sendMessage(conversationId, "GIF", "", {
                url: gif.url,
                previewUrl: gif.previewUrl,
                width: gif.width,
                height: gif.height,
                title: gif.title,
              }, replyTo);
              setReplyTo(null);
              setPanel(false);
            }}
            onSticker={(sticker) => {
              socket.sendMessage(conversationId, "STICKER", "", {
                url: sticker.url,
                title: sticker.name,
                packId: sticker.id.split(":")[0],
                stickerId: sticker.id,
              }, replyTo);
              setReplyTo(null);
              setPanel(false);
            }}
            onClose={() => setPanel(false)}
          />
        )}
      </AnimatePresence>

      <div className="flex items-end gap-1.5">
        <button
          onClick={() => setPanel((v) => !v)}
          disabled={!!editing}
          className="btn-ghost h-10 w-10 !px-0 text-lg"
          aria-label="GIFs and stickers"
        >
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8.5 14.5c.8 1 2 1.5 3.5 1.5s2.7-.5 3.5-1.5M9 10h.01M15 10h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || !!editing}
          className="btn-ghost h-10 w-10 !px-0"
          aria-label="Send an image"
        >
          {uploading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-faint border-t-transparent" />
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" />
              <path d="M4 17l5-5 4 4 3-3 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) sendImage(f);
            e.target.value = "";
          }}
        />

        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => onType(e.target.value)}
          onBlur={stopTyping}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") {
              if (editing) cancelEditing();
              else if (replyTo) setReplyTo(null);
            }
          }}
          rows={1}
          placeholder={editing ? "Edit your message…" : "Write a message…"}
          className="input max-h-36 flex-1 resize-none py-2.5"
        />

        <m.button
          onClick={submit}
          disabled={!text.trim()}
          whileTap={{ scale: 0.94 }}
          className="btn-primary h-10 w-10 !px-0"
          aria-label={editing ? "Save edit" : "Send"}
        >
          {editing ? (
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
              <path d="M5 12l5 5 9-11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
              <path d="M4 12l16-8-6 8 6 8-16-8z" fill="currentColor" />
            </svg>
          )}
        </m.button>
      </div>
    </div>
  );
}
