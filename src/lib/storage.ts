import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "./env";

/**
 * Local object storage abstraction.
 *
 * The app server never buffers oversized bodies into the DB — media is written
 * to a dedicated store and referenced by URL. Swap this module for an S3 / R2
 * client (putObject / getObject) and the call sites are unchanged.
 */
const ROOT = path.resolve(process.cwd(), env.STORAGE_DIR);

export async function putImage(
  conversationId: string,
  buffer: Buffer,
  ext: string
): Promise<{ key: string; url: string }> {
  const safeConv = conversationId.replace(/[^a-z0-9_-]/gi, "");
  const dir = path.join(ROOT, safeConv);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, name), buffer);
  const key = `${safeConv}/${name}`;
  return { key, url: `/api/files/${key}` };
}

export async function getObject(key: string): Promise<{ buffer: Buffer; size: number } | null> {
  // prevent path traversal — key must be "<segment>/<segment>"
  if (!/^[a-z0-9_-]+\/[a-z0-9_-]+\.[a-z0-9]+$/i.test(key)) return null;
  const full = path.join(ROOT, key);
  if (!full.startsWith(ROOT)) return null;
  try {
    const [buffer, s] = await Promise.all([readFile(full), stat(full)]);
    return { buffer, size: s.size };
  } catch {
    return null;
  }
}
