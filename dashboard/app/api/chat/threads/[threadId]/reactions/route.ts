import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";
import { ChatReaction, ReactionSummary, VALID_REACTIONS } from "@/lib/chat";

type RouteContext = { params: Promise<{ threadId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await context.params;

  let body: { messageId?: string; reaction?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { messageId, reaction } = body;
  if (!messageId || !reaction) {
    return NextResponse.json({ error: "Missing messageId or reaction" }, { status: 422 });
  }

  if (!VALID_REACTIONS.includes(reaction as ChatReaction)) {
    return NextResponse.json(
      { error: "Invalid reaction. Must be one of: " + VALID_REACTIONS.join(", ") },
      { status: 422 },
    );
  }

  const sb = getSupabase();

  // Verify message belongs to this thread
  const { data: msg } = await sb
    .from("chat_messages")
    .select("id")
    .eq("id", messageId)
    .eq("thread_id", threadId)
    .single();

  if (!msg) return NextResponse.json({ error: "Message not found in this thread" }, { status: 404 });

  try {
    // Check if reaction exists — toggle
    const { data: existing } = await sb
      .from("chat_reactions")
      .select("id")
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .eq("reaction", reaction)
      .single();

    if (existing) {
      await sb.from("chat_reactions").delete().eq("id", existing.id);
      console.log("[TEAM-CHAT-LOG]", "Reaction removed", { messageId, reaction, userId });
    } else {
      await sb.from("chat_reactions").insert({
        message_id: messageId,
        user_id: userId,
        reaction,
      });
      console.log("[TEAM-CHAT-LOG]", "Reaction added", { messageId, reaction, userId });
    }

    // Return updated reactions for this message
    const { data: allReactions } = await sb
      .from("chat_reactions")
      .select("reaction, user_id")
      .eq("message_id", messageId);

    const map = new Map<string, string[]>();
    for (const r of allReactions ?? []) {
      const list = map.get(r.reaction) || [];
      list.push(r.user_id);
      map.set(r.reaction, list);
    }

    const summary: ReactionSummary[] = Array.from(map.entries()).map(([r, userIds]) => ({
      reaction: r as ChatReaction,
      count: userIds.length,
      userIds,
      reacted: userIds.includes(userId),
    }));

    return NextResponse.json(summary);
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "Reaction error:", err);
    return NextResponse.json(
      { error: "Failed to toggle reaction", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
