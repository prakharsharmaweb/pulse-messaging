import clsx from "clsx";

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-xl bg-aurora text-white shadow-lg shadow-brand/30"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" width={size * 0.62} height={size * 0.62} fill="none">
        <path
          d="M9 10h14a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-8l-5 4v-4H9a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

export default function Brand({
  size = 32,
  className,
  showWordmark = true,
}: {
  size?: number;
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <BrandMark size={size} />
      {showWordmark && (
        <span className="text-aurora text-lg font-bold tracking-tight">Pulse</span>
      )}
    </span>
  );
}
