"use client";

import { AnimatePresence, m } from "framer-motion";
import { useChat } from "@/store/chat";

export default function ConnectionBanner() {
  const connection = useChat((s) => s.connection);

  return (
    <AnimatePresence>
      {connection !== "online" && (
        <m.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="overflow-hidden bg-warn/15 text-center text-xs text-warn"
        >
          <div className="px-4 py-1.5">
            {connection === "connecting"
              ? "Connecting…"
              : "You're offline — messages will send automatically when the connection is back."}
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
