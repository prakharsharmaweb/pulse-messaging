/** Generates the "Blobs" sticker pack as static SVGs in public/stickers/blobs. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "public/stickers/blobs");

const face = (bg: string, inner: string) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.25"/></filter></defs>
  <circle cx="60" cy="60" r="46" fill="${bg}" filter="url(#s)"/>
  ${inner}
</svg>`.trim();

const eye = (x: number) => `<circle cx="${x}" cy="52" r="6" fill="#2a2118"/>`;
const smile = `<path d="M40 72 Q60 92 80 72" stroke="#2a2118" stroke-width="6" fill="none" stroke-linecap="round"/>`;
const flat = `<path d="M44 76 H76" stroke="#2a2118" stroke-width="6" fill="none" stroke-linecap="round"/>`;

const defs: Record<string, string> = {
  grin: face("#ffd45e", `${eye(44)}${eye(76)}<path d="M38 68 Q60 96 82 68 Z" fill="#2a2118"/><path d="M42 70 Q60 82 78 70 Z" fill="#ff7a7a"/>`),
  love: face("#ff9db2", `<path d="M38 46 l8 -8 8 8 -8 10 z" fill="#c0264b"/><path d="M66 46 l8 -8 8 8 -8 10 z" fill="#c0264b"/>${smile}`),
  wink: face("#ffd45e", `<path d="M38 52 Q44 46 50 52" stroke="#2a2118" stroke-width="6" fill="none" stroke-linecap="round"/>${eye(76)}${smile}`),
  cry: face("#8fc9ff", `${eye(44)}${eye(76)}<path d="M44 60 q-4 18 0 26" stroke="#4aa3ff" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M40 78 Q60 68 80 78" stroke="#2a2118" stroke-width="6" fill="none" stroke-linecap="round"/>`),
  cool: face("#ffce54", `<rect x="30" y="44" width="60" height="16" rx="6" fill="#2a2118"/><path d="M46 78 Q60 90 76 76" stroke="#2a2118" stroke-width="6" fill="none" stroke-linecap="round"/>`),
  think: face("#c9d4e0", `${eye(44)}${eye(76)}<path d="M42 80 H70" stroke="#2a2118" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="88" cy="86" r="6" fill="#2a2118"/>`),
  sleep: face("#b7a8e0", `<path d="M38 52 H50 M70 52 H82" stroke="#2a2118" stroke-width="6" stroke-linecap="round"/>${flat}<text x="86" y="44" font-size="16" fill="#2a2118">z</text>`),
  party: face("#7ed9a6", `${eye(44)}${eye(76)}${smile}<path d="M18 30 l10 26 -26 -10 z" fill="#ff7a7a"/><circle cx="96" cy="34" r="5" fill="#5b8def"/>`),
  shock: face("#ffd45e", `<circle cx="44" cy="52" r="8" fill="#fff"/><circle cx="44" cy="52" r="4" fill="#2a2118"/><circle cx="76" cy="52" r="8" fill="#fff"/><circle cx="76" cy="52" r="4" fill="#2a2118"/><ellipse cx="60" cy="82" rx="9" ry="12" fill="#2a2118"/>`),
  angry: face("#ff8a6b", `<path d="M36 46 L52 54 M84 46 L68 54" stroke="#2a2118" stroke-width="6" stroke-linecap="round"/>${eye(46)}${eye(74)}<path d="M42 84 Q60 74 78 84" stroke="#2a2118" stroke-width="6" fill="none" stroke-linecap="round"/>`),
  shy: face("#ffc0cb", `<path d="M38 54 Q44 50 50 54 M70 54 Q76 50 82 54" stroke="#2a2118" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="40" cy="66" r="6" fill="#ff8fae"/><circle cx="80" cy="66" r="6" fill="#ff8fae"/>${flat}`),
  thumbsup: face("#8fd07a", `${eye(48)}${eye(78)}<path d="M44 74 Q58 86 72 74" stroke="#2a2118" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M20 78 h10 v18 h-10z M30 76 c6 -2 10 -14 14 -14 c4 0 3 8 1 12 c6 0 12 0 12 6 c0 8 -4 14 -12 14 h-15z" fill="#f4b860" stroke="#2a2118" stroke-width="2"/>`),
};

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const [name, svg] of Object.entries(defs)) {
    await writeFile(path.join(OUT, `${name}.svg`), svg + "\n", "utf8");
  }
  console.log(`✓ wrote ${Object.keys(defs).length} stickers to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
