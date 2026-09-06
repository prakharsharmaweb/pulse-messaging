export function ConversationListSkeleton() {
  return (
    <div className="space-y-1 px-2 py-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl px-2.5 py-2.5">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-surface-overlay" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-overlay" />
            <div className="h-2.5 w-2/3 animate-pulse rounded bg-surface-overlay" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageListSkeleton() {
  return (
    <div className="flex flex-1 flex-col justify-end gap-3 p-4">
      {[0.5, 0.7, 0.4, 0.6, 0.3].map((w, i) => (
        <div key={i} className={i % 2 ? "flex justify-end" : "flex"}>
          <div
            className="h-9 animate-pulse rounded-2xl bg-surface-overlay"
            style={{ width: `${w * 100}%`, maxWidth: 320 }}
          />
        </div>
      ))}
    </div>
  );
}
