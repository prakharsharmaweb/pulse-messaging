export default function TypingDots() {
  return (
    <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-bubble px-3.5 py-3">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-ink-muted animate-typing-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}
