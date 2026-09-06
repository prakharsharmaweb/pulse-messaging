/**
 * Generates a short, soft "pop" notification sound as a 16-bit PCM WAV.
 * No third-party asset / licence — synthesised from scratch.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SR = 44100;
const dur = 0.16;
const n = Math.floor(SR * dur);
const data = Buffer.alloc(n * 2);

for (let i = 0; i < n; i++) {
  const t = i / SR;
  // two quick sine blips (E5 -> A5) with a fast exponential decay
  const f = t < 0.06 ? 659.25 : 880.0;
  const env = Math.exp(-t * 34) * (1 - Math.exp(-t * 400));
  const s = Math.sin(2 * Math.PI * f * t) * env * 0.35;
  data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2);
}

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const out = path.resolve(process.cwd(), "public/sounds");
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "pop.wav"), wav(data));
console.log(`✓ wrote public/sounds/pop.wav (${((44 + data.length) / 1024).toFixed(1)} KB)`);
