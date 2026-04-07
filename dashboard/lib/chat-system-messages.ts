import { getSupabase } from "./supabase";

/**
 * Post a system message into a chat thread.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function postSystemMessage(
  threadId: string,
  body: string,
): Promise<void> {
  try {
    const sb = getSupabase();
    const { error } = await sb.from("chat_messages").insert({
      thread_id: threadId,
      sender_id: "system",
      sender_name: "System",
      sender_role: "system",
      message_type: "system",
      body,
    });
    if (error) console.error("[TEAM-CHAT-LOG] system message error:", error.message);
  } catch (err) {
    console.error("[TEAM-CHAT-LOG] system message error:", err);
  }
}

/**
 * Post a DTC alert system message.
 */
export async function postDtcAlert(
  threadId: string,
  dtcCode: string,
  description: string,
  aiAssessment?: string,
): Promise<void> {
  let body = `⚠️ DTC ${dtcCode} detected — ${description}`;
  if (aiAssessment) {
    body += `\n\nAI Assessment: ${aiAssessment}`;
  }
  await postSystemMessage(threadId, body);
}

/**
 * Post a member joined system message.
 */
export async function postMemberJoined(
  threadId: string,
  memberName: string,
): Promise<void> {
  await postSystemMessage(threadId, `${memberName} joined the conversation`);
}

/**
 * Post a work order status change system message.
 */
export async function postWorkOrderStatusChange(
  threadId: string,
  status: string,
  userName: string,
): Promise<void> {
  await postSystemMessage(threadId, `Status changed to ${status} by ${userName}`);
}

/**
 * Post a pinned message system message.
 */
export async function postMessagePinned(
  threadId: string,
  userName: string,
): Promise<void> {
  await postSystemMessage(threadId, `${userName} pinned a message`);
}
