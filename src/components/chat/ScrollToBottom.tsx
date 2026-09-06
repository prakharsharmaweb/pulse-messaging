"use client";

import { AnimatePresence, m } from "framer-motion";

export default function ScrollToBottom({
  show,
  unread,
  onClick,
}: {
  show: boolean;
  unread: number;
  onClick: () => void;
}) {
  return (
    <AnimatePresence>
      {show && (
        <m.button
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.9 }}
          transition={{ duration: 0.15 }}
          onClick={onClick}
          className="absolute bottom-24 right-5 z-20 flex items-center gap-2 rounded-full border border-surface-border bg-surface-raised px-3 py-2 text-xs font-medium text-ink shadow-xl hover:bg-surface-overlay"
        >
          {unread > 0 && (
            <span className="grid min-w-[18px] place-items-center rounded-full bg-aurora px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </m.button>
      )}
    </AnimatePresence>
  );
}
