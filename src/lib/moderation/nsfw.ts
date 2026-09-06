/**
 * Server-side nudity / explicit-content detection.
 *
 * Model:     NSFWJS MobileNetV2 (open-source, github.com/infinitered/nsfwjs, MIT)
 * Size:      ~2.6 MB weights + ~126 KB graph  (quantised, 224x224 input)
 * Runtime:   @tensorflow/tfjs pure-JS CPU backend, in-process on the Node app
 *            server. No GPU, no native addons, no external API.
 * Latency:   ~150-500 ms per image after warm-up (first call ~1-2 s while the
 *            model loads once and is cached for the process lifetime).
 *
 * Decision rule (image is rejected if ANY of these is true):
 *   - P(Porn)   >= 0.30                          hard gate
 *   - P(Hentai) >= 0.30                          hard gate
 *   - P(Sexy)   >= 0.55                          hard gate (swimwear / lingerie)
 *   - P(Porn) + P(Hentai) + 0.5*P(Sexy) >= NSFW_THRESHOLD (default 0.45)
 * The per-class gates mean one strong signal is enough even when the combined
 * score is under threshold; the combined score catches "a bit of everything".
 *
 * This runs *only* on the server (upload route). The browser never gets to
 * decide — an unsafe image is rejected before it is stored or delivered.
 */
import * as tf from "@tensorflow/tfjs";
import * as nsfw from "nsfwjs";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { env } from "../env";

let modelPromise: Promise<nsfw.NSFWJS> | null = null;

function loadModel() {
  if (!modelPromise) {
    // Served as static files by Next from /public/models/nsfw.
    const url = `${env.APP_ORIGIN}/models/nsfw/model.json`;
    modelPromise = nsfw.load(url, { size: 224 }).catch((err) => {
      modelPromise = null; // allow a later retry
      throw err;
    });
  }
  return modelPromise;
}

/** Decode a jpeg/png buffer into an RGB [h,w,3] uint8 tensor. */
function decodeToTensor(buffer: Buffer, mime: string): tf.Tensor3D {
  if (mime === "image/png") {
    const png = PNG.sync.read(buffer);
    const rgb = new Uint8Array((png.data.length / 4) * 3);
    for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
      rgb[j] = png.data[i];
      rgb[j + 1] = png.data[i + 1];
      rgb[j + 2] = png.data[i + 2];
    }
    return tf.tensor3d(rgb, [png.height, png.width, 3], "int32");
  }
  // jpeg
  const raw = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: false });
  return tf.tensor3d(raw.data, [raw.height, raw.width, 3], "int32");
}

// Per-class hard gates — a single strong signal rejects the image.
const GATE = { porn: 0.3, hentai: 0.3, sexy: 0.55 } as const;

export type NsfwVerdict = {
  safe: boolean;
  score: number;
  threshold: number;
  reason: string | null;
  predictions: Record<string, number>;
};

export async function classifyImage(buffer: Buffer, mime: string): Promise<NsfwVerdict> {
  const model = await loadModel();
  const image = decodeToTensor(buffer, mime);
  try {
    const results = await model.classify(image);
    const p: Record<string, number> = {};
    for (const r of results) p[r.className] = r.probability;

    const porn = p["Porn"] ?? 0;
    const hentai = p["Hentai"] ?? 0;
    const sexy = p["Sexy"] ?? 0;

    const score = porn + hentai + 0.5 * sexy;
    const threshold = env.NSFW_THRESHOLD;

    let reason: string | null = null;
    if (porn >= GATE.porn) reason = `P(Porn)=${porn.toFixed(3)} >= ${GATE.porn}`;
    else if (hentai >= GATE.hentai) reason = `P(Hentai)=${hentai.toFixed(3)} >= ${GATE.hentai}`;
    else if (sexy >= GATE.sexy) reason = `P(Sexy)=${sexy.toFixed(3)} >= ${GATE.sexy}`;
    else if (score >= threshold) reason = `score=${score.toFixed(3)} >= ${threshold}`;

    return {
      safe: reason === null,
      score: Number(score.toFixed(4)),
      threshold,
      reason,
      predictions: Object.fromEntries(
        Object.entries(p).map(([k, v]) => [k, Number(v.toFixed(4))])
      ),
    };
  } finally {
    image.dispose();
  }
}
