"use client";

import { useEffect, useState } from "react";
import { m } from "framer-motion";
import clsx from "clsx";
import type { Sticker, StickerPack } from "@/lib/stickers";

type Gif = {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
};

export default function GifStickerPicker({
  onGif,
  onSticker,
  onClose,
}: {
  onGif: (gif: Gif) => void;
  onSticker: (sticker: Sticker) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"gif" | "sticker">("gif");

  return (
    <m.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.16 }}
      className="card mb-2 overflow-hidden"
    >
      <div className="flex items-center gap-1 border-b border-surface-border p-1.5">
        <TabButton active={tab === "gif"} onClick={() => setTab("gif")}>
          GIFs
        </TabButton>
        <TabButton active={tab === "sticker"} onClick={() => setTab("sticker")}>
          Stickers
        </TabButton>
        <button onClick={onClose} className="btn-ghost ml-auto h-8 w-8 !px-0" aria-label="Close">
          ✕
        </button>
      </div>
      {tab === "gif" ? <GifTab onPick={onGif} /> : <StickerTab onPick={onSticker} />}
    </m.div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
        active ? "bg-surface-overlay text-ink" : "text-ink-faint hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

function GifTab({ onPick }: { onPick: (g: Gif) => void }) {
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(true);
  const [unconfigured, setUnconfigured] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/giphy?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (res.status === 503 && data.code === "NO_KEY") {
          setUnconfigured(true);
          setGifs([]);
          return;
        }
        setUnconfigured(false);
        setGifs(res.ok ? data.gifs : []);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div>
      <div className="p-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search GIPHY…"
          className="input py-2"
        />
      </div>
      <div className="max-h-64 overflow-y-auto px-2 pb-2">
        {loading && <p className="py-6 text-center text-xs text-ink-faint">Loading…</p>}
        {!loading && unconfigured && (
          <p className="px-4 py-6 text-center text-xs leading-relaxed text-ink-faint">
            GIF search needs a free GIPHY API key. Create one at developers.giphy.com and set{" "}
            <code className="text-ink-muted">GIPHY_API_KEY</code> in <code className="text-ink-muted">.env</code>.
          </p>
        )}
        {!loading && !unconfigured && gifs.length === 0 && (
          <p className="py-6 text-center text-xs text-ink-faint">No GIFs found.</p>
        )}
        <div className="columns-3 gap-2 [&>*]:mb-2">
          {gifs.map((g) => (
            <button
              key={g.id}
              onClick={() => onPick(g)}
              className="block w-full overflow-hidden rounded-lg border border-transparent transition hover:border-brand"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.previewUrl} alt={g.title} loading="lazy" className="w-full" />
            </button>
          ))}
        </div>
      </div>
      <p className="border-t border-surface-border px-3 py-1.5 text-[10px] text-ink-faint">Powered by GIPHY</p>
    </div>
  );
}

function StickerTab({ onPick }: { onPick: (s: Sticker) => void }) {
  const [packs, setPacks] = useState<StickerPack[]>([]);

  useEffect(() => {
    fetch("/api/stickers")
      .then((r) => r.json())
      .then((d) => setPacks(d.packs ?? []))
      .catch(() => setPacks([]));
  }, []);

  return (
    <div className="max-h-72 overflow-y-auto p-3">
      {packs.map((pack) => (
        <div key={pack.id}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{pack.name}</p>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
            {pack.stickers.map((s) => (
              <button
                key={s.id}
                onClick={() => onPick(s)}
                title={s.name}
                className="rounded-xl p-1 transition hover:scale-110 hover:bg-surface-overlay"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.name} loading="lazy" className="mx-auto h-11 w-11" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
