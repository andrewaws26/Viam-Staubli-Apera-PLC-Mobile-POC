import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-safe Supabase client for Realtime subscriptions.
 *
 * Uses the anon key (safe to expose) — NOT the service role key.
 * Returns null if env vars aren't configured (graceful degradation).
 *
 * To enable: add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 * to Vercel env vars. Chat will automatically switch from polling to Realtime.
 */

let _browserClient: SupabaseClient | null = null;
let _checked = false;

export function getSupabaseBrowser(): SupabaseClient | null {
  if (_checked) return _browserClient;
  _checked = true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  _browserClient = createClient(url, key, {
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  return _browserClient;
}
