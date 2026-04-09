/**
 * In-memory rate limiter for API routes.
 *
 * Tracks request counts per key (user ID, IP, etc.) with a sliding window.
 * Resets automatically after the window expires.
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });
 *
 *   // In route handler:
 *   const check = limiter.check(userId);
 *   if (!check.allowed) {
 *     return NextResponse.json(
 *       { error: "Rate limited", retryAfterMs: check.retryAfterMs },
 *       { status: 429 }
 *     );
 *   }
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

interface RateLimiter {
  check(key: string): RateLimitResult;
  reset(key: string): void;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const entries = new Map<string, RateLimitEntry>();

  // Periodic cleanup of expired entries (every 5 minutes)
  const cleanup = () => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (now - entry.windowStart > opts.windowMs * 2) {
        entries.delete(key);
      }
    }
  };
  const cleanupInterval = setInterval(cleanup, 5 * 60 * 1000);
  // Don't block process exit
  if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
    cleanupInterval.unref();
  }

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const entry = entries.get(key);

      if (!entry || now - entry.windowStart > opts.windowMs) {
        entries.set(key, { count: 1, windowStart: now });
        return { allowed: true, remaining: opts.max - 1, retryAfterMs: 0 };
      }

      entry.count++;

      if (entry.count > opts.max) {
        const retryAfterMs = opts.windowMs - (now - entry.windowStart);
        return { allowed: false, remaining: 0, retryAfterMs };
      }

      return { allowed: true, remaining: opts.max - entry.count, retryAfterMs: 0 };
    },

    reset(key: string): void {
      entries.delete(key);
    },
  };
}

/** Rate limiter for @ai mentions: 5 per minute per user. */
export const aiMentionLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 5,
});
