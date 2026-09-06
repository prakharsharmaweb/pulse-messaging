import { initials } from "@/lib/format";
import clsx from "clsx";

export default function Avatar({
  name,
  color,
  size = 40,
  online,
}: {
  name: string;
  color: string;
  size?: number;
  online?: boolean;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full select-none items-center justify-center rounded-full font-semibold text-white ring-1 ring-black/5"
        style={{ backgroundColor: color, fontSize: size * 0.36 }}
      >
        {initials(name)}
      </div>
      {online !== undefined && (
        <span
          className={clsx(
            "absolute bottom-0 right-0 rounded-full border-2 border-surface-raised",
            online ? "bg-online animate-pulse-ring" : "bg-ink-faint"
          )}
          style={{ width: Math.max(8, size * 0.26), height: Math.max(8, size * 0.26) }}
        />
      )}
    </div>
  );
}
