/**
 * Send push notifications to chat thread members.
 * Fire-and-forget — errors are logged but never thrown.
 */

import { getSupabase } from "./supabase";

interface ChatPushPayload {
  threadId: string;
  entityType: string;
  entityId?: string | null;
  senderName: string;
  senderUserId: string;
  messagePreview: string;
}

export async function sendChatPushNotifications(payload: ChatPushPayload): Promise<void> {
  try {
    const sb = getSupabase();

    // Get all thread members except the sender
    const { data: members } = await sb
      .from("chat_thread_members")
      .select("user_id")
      .eq("thread_id", payload.threadId)
      .neq("user_id", payload.senderUserId);

    if (!members || members.length === 0) return;

    const userIds = members.map((m) => m.user_id);

    // Fetch push tokens for these users
    const { data: tokens } = await sb
      .from("push_tokens")
      .select("expo_token")
      .in("user_id", userIds);

    if (!tokens || tokens.length === 0) return;

    const messages = tokens.map((t) => ({
      to: t.expo_token,
      title: `${payload.senderName} in chat`,
      body: payload.messagePreview.substring(0, 100),
      data: {
        type: "team_chat",
        threadId: payload.threadId,
        entityType: payload.entityType,
        entityId: payload.entityId ?? undefined,
        senderName: payload.senderName,
      },
      sound: "default" as const,
    }));

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      console.error("[TEAM-CHAT-LOG] push error:", response.status);
    } else {
      console.log("[TEAM-CHAT-LOG] push sent to", tokens.length, "devices");
    }
  } catch (err) {
    console.error("[TEAM-CHAT-LOG] push error:", err);
  }
}
