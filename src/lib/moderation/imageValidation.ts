import { fileTypeFromBuffer } from "file-type";
import { env } from "../env";

const ALLOWED = new Set(["image/jpeg", "image/png"]);

export type ImageValidation =
  | { ok: true; mime: "image/jpeg" | "image/png"; ext: string }
  | { ok: false; reason: string };

/**
 * Validates an uploaded image by inspecting its actual byte signature — the
 * client-supplied filename and Content-Type are never trusted.
 */
export async function validateImage(
  buffer: Buffer,
  declaredSize: number
): Promise<ImageValidation> {
  if (buffer.length === 0) return { ok: false, reason: "Empty file." };
  if (buffer.length > env.MAX_UPLOAD_BYTES || declaredSize > env.MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: `File exceeds the ${(env.MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB limit.`,
    };
  }

  const type = await fileTypeFromBuffer(buffer);
  if (!type || !ALLOWED.has(type.mime)) {
    return {
      ok: false,
      reason: "Only JPEG and PNG images are accepted.",
    };
  }

  return { ok: true, mime: type.mime as "image/jpeg" | "image/png", ext: type.ext };
}
