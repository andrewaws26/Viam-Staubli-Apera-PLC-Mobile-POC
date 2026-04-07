import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";
import { canManageFleet } from "@/lib/auth";
import { dbRowToMessage } from "@/lib/chat";

async function getUserRole(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (user.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  } catch {
    return "operator";
  }
}

type RouteContext = { params: Promise<{ threadId: string; messageId: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId, messageId } = await context.params;
  const sb = getSupabase();

  const { data: msg } = await sb
    .from("chat_messages")
    .select("sender_id")
    .eq("id", messageId)
    .eq("thread_id", threadId)
    .single();

  if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (msg.sender_id !== userId) {
    return NextResponse.json({ error: "Can only edit your own messages" }, { status: 403 });
  }

  let body: { body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.body?.trim()) {
    return NextResponse.json({ error: "Message body required" }, { status: 422 });
  }

  try {
    const { data: updated, error } = await sb
      .from("chat_messages")
      .update({ body: body.body.trim(), edited_at: new Date().toISOString() })
      .eq("id", messageId)
      .select()
      .single();

    if (error) throw error;

    console.log("[TEAM-CHAT-LOG]", "PUT message edited", messageId, "by", userId);
    return NextResponse.json(dbRowToMessage(updated));
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "PUT message error:", err);
    return NextResponse.json(
      { error: "Failed to edit message", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId, messageId } = await context.params;
  const role = await getUserRole(userId);
  const sb = getSupabase();

  const { data: msg } = await sb
    .from("chat_messages")
    .select("sender_id")
    .eq("id", messageId)
    .eq("thread_id", threadId)
    .single();

  if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (msg.sender_id !== userId && !canManageFleet(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { error } = await sb
      .from("chat_messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", messageId);

    if (error) throw error;

    console.log("[TEAM-CHAT-LOG]", "DELETE (soft) message", messageId, "by", userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "DELETE message error:", err);
    return NextResponse.json(
      { error: "Failed to delete message", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
