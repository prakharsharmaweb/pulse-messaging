"use client";

import { AnimatePresence, m } from "framer-motion";
import clsx from "clsx";
import type { ReactionGroup } from "@/lib/types";

export default function MessageReactions({
  reactions,
  meId,
  mine,
  onToggle,
}: {
  reactions: ReactionGroup[];
  meId: string;
  mine: boolean;
  onToggle: (emoji: string) => void;
}) {
  if (reactions.length === 0) return null;
  return (
    <div className={clsx("mt-1 flex flex-wrap gap-1", mine ? "justify-end" : "justify-start")}>
      <AnimatePresence initial={false}>
        {reactions.map((r) => {
          const reacted = r.userIds.includes(meId);
          return (
            <m.button
              key={r.emoji}
              layout
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              onClick={() => onToggle(r.emoji)}
              className={clsx(
                "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition",
                reacted
                  ? "border-brand/40 bg-brand/15 text-ink"
                  : "border-surface-border bg-surface-raised text-ink-muted hover:bg-surface-overlay"
              )}
            >
              <span>{r.emoji}</span>
              <span className="tabular-nums">{r.count}</span>
            </m.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
