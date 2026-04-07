import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";
import { canManageFleet } from "@/lib/auth";
import {
  SendMessagePayload,
  ChatReaction,
  ReactionSummary,
  dbRowToMessage,
  VALID_REACTIONS,
} from "@/lib/chat";
import { sendChatPushNotifications } from "@/lib/chat-push";
import { generateThreadAiResponse, AiThreadContext } from "@/lib/ai";

async function getUserInfo(userId: string): Promise<{ name: string; role: string }> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const name = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
    const role = (user.publicMetadata as Record<string, unknown>)?.role as string || "operator";
    return { name, role };
  } catch {
    return { name: "Unknown", role: "operator" };
  }
}

async function isMemberOrManager(
  userId: string,
  threadId: string,
  role: string,
): Promise<boolean> {
  const sb = getSupabase();
  const { data: member } = await sb
    .from("chat_thread_members")
    .select("id")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .single();

  if (member) return true;

  if (canManageFleet(role)) {
    const { data: thread } = await sb
      .from("chat_threads")
      .select("entity_type")
      .eq("id", threadId)
      .single();
    return thread?.entity_type !== "direct";
  }

  return false;
}

function aggregateReactions(
  reactions: { reaction: string; user_id: string }[],
  currentUserId: string,
): ReactionSummary[] {
  const map = new Map<string, { userIds: string[] }>();
  for (const r of reactions) {
    const entry = map.get(r.reaction) || { userIds: [] };
    entry.userIds.push(r.user_id);
    map.set(r.reaction, entry);
  }
  return Array.from(map.entries()).map(([reaction, data]) => ({
    reaction: reaction as ChatReaction,
    count: data.userIds.length,
    userIds: data.userIds,
    reacted: data.userIds.includes(currentUserId),
  }));
}

type RouteContext = { params: Promise<{ threadId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await context.params;
  const { name: _n, role } = await getUserInfo(userId);

  if (!(await isMemberOrManager(userId, threadId, role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const before = request.nextUrl.searchParams.get("before");
  const after = request.nextUrl.searchParams.get("after");
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "50"), 100);

  const sb = getSupabase();

  try {
    let query = sb
      .from("chat_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) {
      // Cursor pagination: get messages before this message's created_at
      const { data: cursorMsg } = await sb
        .from("chat_messages")
        .select("created_at")
        .eq("id", before)
        .single();
      if (cursorMsg) {
        query = query.lt("created_at", cursorMsg.created_at);
      }
    }

    if (after) {
      // Get only new messages after this cursor
      const { data: cursorMsg } = await sb
        .from("chat_messages")
        .select("created_at")
        .eq("id", after)
        .single();
      if (cursorMsg) {
        query = sb
          .from("chat_messages")
          .select("*")
          .eq("thread_id", threadId)
          .gt("created_at", cursorMsg.created_at)
          .order("created_at", { ascending: true })
          .limit(limit);
      }
    }

    const { data: messages, error } = await query;
    if (error) throw error;

    // Fetch reactions for all messages
    const messageIds = (messages ?? []).map((m) => m.id);
    const { data: allReactions } = messageIds.length > 0
      ? await sb
          .from("chat_reactions")
          .select("message_id, reaction, user_id")
          .in("message_id", messageIds)
      : { data: [] };

    const reactionsByMessage = new Map<string, { reaction: string; user_id: string }[]>();
    for (const r of allReactions ?? []) {
      const list = reactionsByMessage.get(r.message_id) || [];
      list.push(r);
      reactionsByMessage.set(r.message_id, list);
    }

    const enriched = (messages ?? []).map((m) =>
      dbRowToMessage(m, aggregateReactions(reactionsByMessage.get(m.id) || [], userId)),
    );

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "GET messages error:", err);
    return NextResponse.json(
      { error: "Failed to fetch messages", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await context.params;
  const { name: senderName, role: senderRole } = await getUserInfo(userId);

  if (!(await isMemberOrManager(userId, threadId, senderRole))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: SendMessagePayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.body?.trim()) {
    return NextResponse.json({ error: "Message body required" }, { status: 422 });
  }

  const sb = getSupabase();

  try {
    // Insert the user's message
    const { data: message, error } = await sb
      .from("chat_messages")
      .insert({
        thread_id: threadId,
        sender_id: userId,
        sender_name: senderName,
        sender_role: senderRole,
        message_type: "user",
        body: body.body.trim(),
        snapshot: body.snapshot || null,
        attachments: body.attachments || [],
      })
      .select()
      .single();

    if (error) throw error;

    console.log("[TEAM-CHAT-LOG]", "POST message", {
      threadId,
      messageId: message.id,
      senderId: userId,
      hasSnapshot: !!body.snapshot,
      mentionAi: !!body.mentionAi,
    });

    // Get thread info for push
    const { data: thread } = await sb
      .from("chat_threads")
      .select("entity_type, entity_id")
      .eq("id", threadId)
      .single();

    // Send push notifications (fire-and-forget)
    sendChatPushNotifications({
      threadId,
      entityType: thread?.entity_type || "direct",
      entityId: thread?.entity_id,
      senderName,
      senderUserId: userId,
      messagePreview: body.body.trim(),
    });

    // If @ai mentioned, generate AI response
    if (body.mentionAi) {
      try {
        // Fetch recent messages for context
        const { data: recentMsgs } = await sb
          .from("chat_messages")
          .select("sender_name, sender_role, message_type, body")
          .eq("thread_id", threadId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(10);

        const aiContext: AiThreadContext = {
          recentMessages: (recentMsgs ?? []).reverse().map((m) => ({
            role: m.message_type === "ai" ? "ai" : m.message_type,
            name: m.sender_name,
            content: m.body,
          })),
          sensorSnapshot: body.snapshot as Record<string, unknown> | undefined,
          entityType: thread?.entity_type || "direct",
          entityId: thread?.entity_id || undefined,
          activeDtcs: body.snapshot?.active_dtcs as string[] | undefined,
        };

        const aiReply = await generateThreadAiResponse(body.body.trim(), aiContext);

        // Insert AI response
        await sb.from("chat_messages").insert({
          thread_id: threadId,
          sender_id: "ai",
          sender_name: "AI Mechanic",
          sender_role: "ai",
          message_type: "ai",
          body: aiReply,
        });

        console.log("[TEAM-CHAT-LOG]", "AI response posted in thread", threadId);
      } catch (aiErr) {
        console.error("[TEAM-CHAT-LOG]", "AI response error:", aiErr);
        // Don't fail the user's message if AI fails
      }
    }

    return NextResponse.json(dbRowToMessage(message), { status: 201 });
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "POST message error:", err);
    return NextResponse.json(
      { error: "Failed to send message", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
