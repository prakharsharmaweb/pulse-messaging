import { apiError, json, requireUser } from "@/lib/api";
import { rateLimit, RATE_LIMITS } from "@/lib/rateLimit";
import { env } from "@/lib/env";

/**
 * Server-side GIPHY proxy. Keeps the API key off the client and lets us apply
 * auth + rate limiting to media search.
 */
export async function GET(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const rl = rateLimit(`giphy:${auth.user.id}`, RATE_LIMITS.giphy.limit, RATE_LIMITS.giphy.windowMs);
  if (!rl.ok) return apiError(429, "Slow down a moment.");

  if (!env.GIPHY_API_KEY) {
    return apiError(503, "GIF search is not configured.", { code: "NO_KEY" });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 24), 40);

  const endpoint = q
    ? `https://api.giphy.com/v1/gifs/search?api_key=${env.GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${env.GIPHY_API_KEY}&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`;

  try {
    const res = await fetch(endpoint, { next: { revalidate: 0 } });
    if (!res.ok) return apiError(502, "GIF service unavailable.");
    const data = (await res.json()) as { data: GiphyRaw[] };
    const gifs = data.data.map((g) => ({
      id: g.id,
      title: g.title,
      url: g.images.fixed_width.url,
      previewUrl: g.images.fixed_width_downsampled?.url ?? g.images.fixed_width.url,
      width: Number(g.images.fixed_width.width),
      height: Number(g.images.fixed_width.height),
    }));
    return json({ gifs });
  } catch {
    return apiError(502, "GIF service unavailable.");
  }
}

type GiphyRaw = {
  id: string;
  title: string;
  images: {
    fixed_width: { url: string; width: string; height: string };
    fixed_width_downsampled?: { url: string };
  };
};
