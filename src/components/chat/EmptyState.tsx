import Brand from "@/components/Brand";

export function NoConversationSelected() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-brand-soft">
        <svg viewBox="0 0 24 24" width="30" height="30" className="text-brand" fill="none">
          <path
            d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H9l-4 3v-3H7a3 3 0 0 1-3-3V7z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
      </div>
      <h2 className="text-base font-semibold">Your messages</h2>
      <p className="mt-1 max-w-xs text-sm text-ink-muted">
        Pick a conversation on the left, or press{" "}
        <kbd className="rounded border border-surface-border bg-surface-overlay px-1.5 py-0.5 text-[11px]">
          ⌘K
        </kbd>{" "}
        to jump anywhere.
      </p>
    </div>
  );
}

export function NoConversationsYet({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center px-4 py-16 text-center">
      <Brand size={30} showWordmark={false} />
      <p className="mt-4 text-sm font-medium">No conversations yet</p>
      <p className="mt-1 max-w-[16rem] text-xs text-ink-faint">
        Start chatting with someone to see it here.
      </p>
      <button onClick={onStart} className="btn-primary mt-4 !py-2 text-xs">
        Start a conversation
      </button>
    </div>
  );
}
