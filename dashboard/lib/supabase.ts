import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  }

  _client = createClient(url, key);
  return _client;
}

/**
 * Retry wrapper with exponential backoff for Supabase operations.
 * Retries on network errors and 5xx responses, NOT on 4xx (client errors).
 *
 * Usage:
 *   const { data, error } = await withRetry(() =>
 *     getSupabase().from("table").select("*").eq("id", id)
 *   );
 */
export async function withRetry<T>(
  fn: () => PromiseLike<{ data: T; error: { message: string; code?: string } | null }>,
  opts?: { maxRetries?: number; baseDelayMs?: number },
): Promise<{ data: T; error: { message: string; code?: string } | null }> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelay = opts?.baseDelayMs ?? 200;

  let lastResult: { data: T; error: { message: string; code?: string } | null };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      lastResult = await fn();

      // Don't retry on success or client errors (4xx)
      if (!lastResult.error) return lastResult;

      const code = lastResult.error.code;
      const isRetryable =
        !code ||
        code.startsWith("5") ||
        code === "PGRST301" || // connection error
        code === "08006" ||    // connection failure
        code === "08001" ||    // unable to connect
        code === "57P01";      // admin shutdown

      if (!isRetryable) return lastResult;
    } catch (err) {
      // Network-level errors (fetch failures, timeouts)
      if (attempt === maxRetries) throw err;
    }

    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return lastResult!;
}
