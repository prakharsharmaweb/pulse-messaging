/**
 * Downloads the NSFWJS MobileNetV2 model (open-source, ~4.2 MB total) into
 * public/models/nsfw so inference can run fully offline on the app server.
 *
 * Source: github.com/infinitered/nsfwjs (MIT) via jsDelivr CDN.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const BASE =
  "https://cdn.jsdelivr.net/gh/infinitered/nsfwjs@master/models/mobilenet_v2";
const FILES = ["model.json", "group1-shard1of1"];
const OUT = path.resolve(process.cwd(), "public/models/nsfw");

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const file of FILES) {
    const dest = path.join(OUT, file);
    if (existsSync(dest)) {
      console.log(`✓ ${file} (already present)`);
      continue;
    }
    const res = await fetch(`${BASE}/${file}`);
    if (!res.ok) throw new Error(`Failed to fetch ${file}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    console.log(`✓ ${file} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  console.log(`\nModel ready in ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
