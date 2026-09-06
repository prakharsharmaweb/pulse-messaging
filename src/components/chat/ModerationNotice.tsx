"use client";

import { m } from "framer-motion";

export type ModerationInfo = {
  kind: "nudity" | "profanity" | "error";
  message: string;
  score?: number;
  threshold?: number;
};

export default function ModerationNotice({
  info,
  onDismiss,
}: {
  info: ModerationInfo;
  onDismiss: () => void;
}) {
  const title =
    info.kind === "nudity"
      ? "Image not sent"
      : info.kind === "profanity"
      ? "Message blocked"
      : "Couldn't send";

  return (
    <m.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-2 flex items-start gap-3 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-3 text-sm"
    >
      <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-danger/15 text-danger">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
          <path d="M12 8v5M12 16.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-danger">{title}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{info.message}</p>
        {info.kind === "nudity" && info.score !== undefined && (
          <p className="mt-1 text-[11px] text-ink-faint">
            explicit-content score {info.score.toFixed(2)} ≥ threshold{" "}
            {info.threshold?.toFixed(2)} · checked on the server, not delivered
          </p>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-1 text-ink-faint hover:bg-danger/10 hover:text-danger"
      >
        ✕
      </button>
    </m.div>
  );
}
