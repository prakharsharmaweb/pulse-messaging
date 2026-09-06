"use client";

import { useState } from "react";
import clsx from "clsx";
import { m } from "framer-motion";
import type { LocalMessage } from "@/store/chat";
import { messageTime } from "@/lib/format";
import MessageReactions from "./MessageReactions";

const QUICK = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

function Ticks({ status }: { status: LocalMessage["status"] }) {
  if (status === "READ") return <span className="text-[13px] leading-none text-sky-300">✓✓</span>;
  if (status === "DELIVERED") return <span className="text-[13px] leading-none text-white/55">✓✓</span>;
  return <span className="text-[13px] leading-none text-white/55">✓</span>;
}

export default function MessageItem({
  message,
  mine,
  showTail,
  grouped,
  meId,
  onRetry,
  onReact,
  onReply,
  onJumpTo,
  onOpenImage,
  isNew,
}: {
  message: LocalMessage;
  mine: boolean;
  showTail: boolean;
  grouped: boolean;
  meId: string;
  onRetry: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onJumpTo: (id: string) => void;
  onOpenImage: (url: string) => void;
  isNew: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const local = message.local?.status ?? "sent";
  const failed = local === "failed";
  const pending = local === "pending";
  const meta = message.metadata ?? {};
  const isBubble = message.kind === "TEXT" || message.kind === "IMAGE";

  return (
    <m.div
      initial={isNew ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className={clsx("group/msg flex flex-col", mine ? "items-end" : "items-start", grouped ? "mt-0.5" : "mt-3", showTail ? "mb-0.5" : "")}
    >
      <div className={clsx("relative flex items-end gap-2", mine && "flex-row-reverse")}>
        {/* hover actions */}
        <div
          className={clsx(
            "flex items-center gap-0.5 self-center opacity-0 transition group-hover/msg:opacity-100",
            pickerOpen && "opacity-100"
          )}
        >
          <button
            onClick={onReply}
            aria-label="Reply"
            className="grid h-7 w-7 place-items-center rounded-full text-ink-faint hover:bg-surface-overlay hover:text-ink"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
              <path d="M10 9V5l-7 7 7 7v-4c5 0 8 2 10 5-.5-6-4-10-10-11z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="relative">
            <button
              onClick={() => setPickerOpen((v) => !v)}
              aria-label="React"
              className="grid h-7 w-7 place-items-center rounded-full text-ink-faint hover:bg-surface-overlay hover:text-ink"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                <path d="M8.5 14c.8 1.2 2 2 3.5 2s2.7-.8 3.5-2M9 10h.01M15 10h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            {pickerOpen && (
              <m.div
                initial={{ opacity: 0, scale: 0.9, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className={clsx(
                  "absolute bottom-9 z-30 flex gap-1 rounded-full border border-surface-border bg-surface-raised p-1 shadow-xl",
                  mine ? "right-0" : "left-0"
                )}
              >
                {QUICK.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      onReact(e);
                      setPickerOpen(false);
                    }}
                    className="grid h-8 w-8 place-items-center rounded-full text-lg transition hover:scale-125 hover:bg-surface-overlay"
                  >
                    {e}
                  </button>
                ))}
              </m.div>
            )}
          </div>
        </div>

        <div
          className={clsx(
            "max-w-[78vw] overflow-hidden text-sm shadow-sm sm:max-w-[26rem]",
            message.kind === "GIF" || message.kind === "STICKER"
              ? "bg-transparent shadow-none"
              : mine
              ? "bg-aurora text-white"
              : "bg-bubble text-ink",
            "rounded-2xl",
            isBubble && mine && showTail && "rounded-br-md",
            isBubble && !mine && showTail && "rounded-bl-md",
            pending && "opacity-70"
          )}
        >
          {message.replyTo && (
            <button
              onClick={() => onJumpTo(message.replyTo!.id)}
              className={clsx(
                "flex w-full flex-col items-start gap-0.5 border-l-2 px-3 pt-2 text-left text-xs",
                mine ? "border-white/50 text-white/80" : "border-brand text-ink-muted"
              )}
            >
              <span className="font-medium opacity-90">
                {message.replyTo.senderId === meId ? "You" : "Reply"}
              </span>
              <span className="line-clamp-2 opacity-80">{message.replyTo.preview}</span>
            </button>
          )}

          {message.kind === "TEXT" && (
            <p className="whitespace-pre-wrap break-words px-3.5 py-2">{message.body}</p>
          )}

          {message.kind === "IMAGE" && meta.url && (
            <button
              onClick={() => onOpenImage(meta.url!)}
              className="block"
              style={{ aspectRatio: meta.width && meta.height ? `${meta.width}/${meta.height}` : undefined }}
            >
              <img
                src={meta.url}
                alt={message.body || "Shared image"}
                loading="lazy"
                decoding="async"
                className="max-h-80 w-full cursor-zoom-in object-cover"
              />
              {message.body && <p className="px-3.5 py-2 text-left text-white/90">{message.body}</p>}
            </button>
          )}

          {message.kind === "GIF" && meta.url && (
            <img
              src={meta.url}
              alt={meta.title || "GIF"}
              loading="lazy"
              decoding="async"
              className="max-h-64 rounded-2xl"
              style={{ width: meta.width ? Math.min(meta.width, 240) : undefined }}
            />
          )}

          {message.kind === "STICKER" && meta.url && (
            <img src={meta.url} alt={meta.title || "Sticker"} loading="lazy" className="h-28 w-28" />
          )}
        </div>
      </div>

      <MessageReactions
        reactions={message.reactions}
        meId={meId}
        mine={mine}
        onToggle={onReact}
      />

      <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-ink-faint">
        {failed ? (
          <button onClick={onRetry} className="font-medium text-danger hover:underline">
            {message.local?.error ? `${message.local.error} · Retry` : "Failed · Retry"}
          </button>
        ) : (
          <>
            <span className={clsx(grouped && !showTail && "opacity-0 transition group-hover/msg:opacity-100")}>
              {pending ? "sending…" : messageTime(message.createdAt)}
            </span>
            {mine && !pending && <Ticks status={message.status} />}
          </>
        )}
      </div>
    </m.div>
  );
}
