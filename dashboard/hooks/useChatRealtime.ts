"use client";

import { useEffect, useRef, useCallback } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Subscribe to Supabase Realtime for chat messages in a thread.
 *
 * When NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY are set,
 * listens for INSERT events on chat_messages and calls onNewMessage.
 *
 * When env vars are missing, falls back to polling at the given interval.
 *
 * @param threadId - The thread to subscribe to
 * @param onNewMessage - Called when a new message is detected (either via Realtime or poll)
 * @param pollFn - Fallback poll function (only used when Realtime unavailable)
 * @param pollIntervalMs - Polling interval in ms (default 3000)
 */
export function useChatRealtime(
  threadId: string | null,
  onNewMessage: () => void,
  pollFn: () => void,
  pollIntervalMs = 3000,
) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const usingRealtimeRef = useRef(false);

  const stableOnNew = useCallback(onNewMessage, [onNewMessage]);
  const stablePoll = useCallback(pollFn, [pollFn]);

  useEffect(() => {
    if (!threadId) return;

    const sb = getSupabaseBrowser();

    if (sb) {
      // Realtime mode — subscribe to INSERT on chat_messages for this thread
      const channel = sb
        .channel(`chat-thread-${threadId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
            filter: `thread_id=eq.${threadId}`,
          },
          () => {
            stableOnNew();
          },
        )
        .subscribe();

      channelRef.current = channel;
      usingRealtimeRef.current = true;

      return () => {
        channel.unsubscribe();
        channelRef.current = null;
        usingRealtimeRef.current = false;
      };
    }

    // Fallback: polling mode
    usingRealtimeRef.current = false;
    const interval = setInterval(stablePoll, pollIntervalMs);
    return () => clearInterval(interval);
  }, [threadId, pollIntervalMs, stableOnNew, stablePoll]);

  return { usingRealtime: usingRealtimeRef.current };
}

/**
 * Subscribe to Supabase Realtime for thread list updates.
 *
 * Listens for changes on chat_threads and chat_messages tables
 * to keep the thread list fresh without polling.
 */
export function useThreadListRealtime(
  onUpdate: () => void,
  pollFn: () => void,
  pollIntervalMs = 5000,
) {
  const stableOnUpdate = useCallback(onUpdate, [onUpdate]);
  const stablePoll = useCallback(pollFn, [pollFn]);

  useEffect(() => {
    const sb = getSupabaseBrowser();

    if (sb) {
      const channel = sb
        .channel("chat-thread-list")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "chat_messages" },
          () => stableOnUpdate(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "chat_threads" },
          () => stableOnUpdate(),
        )
        .subscribe();

      return () => {
        channel.unsubscribe();
      };
    }

    // Fallback: polling
    const interval = setInterval(stablePoll, pollIntervalMs);
    return () => clearInterval(interval);
  }, [pollIntervalMs, stableOnUpdate, stablePoll]);
}
