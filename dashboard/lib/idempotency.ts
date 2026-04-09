/**
 * Idempotency key support for financial operations.
 *
 * Prevents duplicate payroll runs, invoice sends, and journal entry postings
 * when a user double-clicks or retries after a timeout.
 *
 * Usage (in route handler):
 *   const idemKey = request.headers.get("x-idempotency-key");
 *   if (idemKey) {
 *     const cached = checkIdempotency(idemKey);
 *     if (cached) return NextResponse.json(cached.body, { status: cached.status });
 *   }
 *   // ... do work ...
 *   if (idemKey) saveIdempotency(idemKey, { status: 200, body: result });
 */

interface CachedResponse {
  status: number;
  body: unknown;
  createdAt: number;
}

// In-memory store (good enough for single-instance Vercel functions).
// For multi-instance, move to Supabase or Redis.
const store = new Map<string, CachedResponse>();

const TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a response was already generated for this idempotency key.
 * Returns the cached response or null.
 */
export function checkIdempotency(key: string): CachedResponse | null {
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(key);
    return null;
  }

  return entry;
}

/**
 * Cache a response for an idempotency key.
 */
export function saveIdempotency(
  key: string,
  response: { status: number; body: unknown },
): void {
  store.set(key, { ...response, createdAt: Date.now() });
}

// Periodic cleanup
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.createdAt > TTL_MS) store.delete(key);
  }
}, 60_000);
if (typeof cleanup === "object" && "unref" in cleanup) {
  cleanup.unref();
}
