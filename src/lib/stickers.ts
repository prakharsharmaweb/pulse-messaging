/** Bundled sticker packs. Assets live in /public/stickers as static SVGs. */

export type Sticker = { id: string; name: string; url: string };
export type StickerPack = { id: string; name: string; stickers: Sticker[] };

const blobs: string[] = [
  "grin",
  "love",
  "wink",
  "cry",
  "cool",
  "think",
  "sleep",
  "party",
  "shock",
  "angry",
  "shy",
  "thumbsup",
];

export const STICKER_PACKS: StickerPack[] = [
  {
    id: "blobs",
    name: "Blobs",
    stickers: blobs.map((id) => ({
      id: `blobs:${id}`,
      name: id,
      url: `/stickers/blobs/${id}.svg`,
    })),
  },
];

export function findSticker(stickerId: string): Sticker | null {
  for (const pack of STICKER_PACKS) {
    const s = pack.stickers.find((x) => x.id === stickerId);
    if (s) return s;
  }
  return null;
}
