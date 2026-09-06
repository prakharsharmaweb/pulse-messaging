import { json, requireUser } from "@/lib/api";
import { STICKER_PACKS } from "@/lib/stickers";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  return json({ packs: STICKER_PACKS });
}
