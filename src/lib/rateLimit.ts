/**
 * In-memory sliding-window rate limiter.
 *
 * Sufficient for a single-node deployment (this assignment). For a horizontally
 * scaled deployment, swap the Map for Redis (INCR + EXPIRE) — the call sites and
 * the `RateLimitResult` contract stay identical.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
};

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { ok: true, remaining: limit - existing.count, retryAfterMs: 0 };
}

// Opportunistic cleanup so the Map cannot grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref?.();

export const RATE_LIMITS = {
  send: { limit: 30, windowMs: 10_000 },
  upload: { limit: 10, windowMs: 60_000 },
  auth: { limit: 10, windowMs: 60_000 },
  giphy: { limit: 60, windowMs: 60_000 },
  conversationCreate: { limit: 20, windowMs: 60_000 },
  reaction: { limit: 40, windowMs: 10_000 },
  messageEdit: { limit: 20, windowMs: 60_000 },
  messageDelete: { limit: 30, windowMs: 60_000 },
} as const;
