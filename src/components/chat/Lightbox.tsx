"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m } from "framer-motion";

export default function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [src]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {src && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={onClose}
        >
          <div className="absolute right-4 top-4 flex gap-2">
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
            >
              Open original ↗
            </a>
            <button
              onClick={onClose}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
            >
              Close ✕
            </button>
          </div>
          <m.img
            key={src}
            src={src}
            alt={alt ?? "Image"}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              cursor: zoom > 1 ? "grab" : "zoom-in",
            }}
            className="max-h-[88vh] max-w-[92vw] select-none rounded-lg shadow-2xl"
            onClick={(e) => {
              e.stopPropagation();
              setZoom((z) => (z > 1 ? 1 : 2));
              setPan({ x: 0, y: 0 });
            }}
            onWheel={(e) => {
              setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY * 0.002)));
            }}
            onMouseDown={(e) => {
              if (zoom <= 1) return;
              drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            }}
            onMouseMove={(e) => {
              if (!drag.current) return;
              setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
            }}
            onMouseUp={() => (drag.current = null)}
            onMouseLeave={() => (drag.current = null)}
          />
        </m.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
