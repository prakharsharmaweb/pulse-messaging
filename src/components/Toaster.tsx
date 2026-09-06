"use client";

import { AnimatePresence, m } from "framer-motion";
import { useToasts } from "@/store/toast";
import clsx from "clsx";

export default function Toaster() {
  const { toasts, dismiss } = useToasts();

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => (
          <m.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={() => dismiss(t.id)}
            className={clsx(
              "pointer-events-auto max-w-sm cursor-pointer rounded-xl border px-4 py-2.5 text-sm shadow-xl backdrop-blur-md",
              t.variant === "error" && "border-danger/30 bg-danger/10 text-danger",
              t.variant === "success" && "border-online/30 bg-online/10 text-online",
              t.variant === "info" && "border-surface-border bg-surface-overlay/90 text-ink"
            )}
          >
            {t.message}
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
