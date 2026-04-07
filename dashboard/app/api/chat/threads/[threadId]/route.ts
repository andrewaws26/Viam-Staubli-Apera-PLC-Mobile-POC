import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";
import { canManageFleet } from "@/lib/auth";
import { dbRowToThread, dbRowToMember, dbRowToMessage } from "@/lib/chat";
import { postMessagePinned } from "@/lib/chat-system-messages";

async function getUserRole(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (user.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  } catch {
    return "operator";
  }
}

async function getUserName(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

async function canAccessThread(
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

  // Managers/developers can access entity threads
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

type RouteContext = { params: Promise<{ threadId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await context.params;
  const role = await getUserRole(userId);

  if (!(await canAccessThread(userId, threadId, role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sb = getSupabase();

  try {
    const { data: thread, error } = await sb
      .from("chat_threads")
      .select("*")
      .eq("id", threadId)
      .is("deleted_at", null)
      .single();

    if (error || !thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Members
    const { data: members } = await sb
      .from("chat_thread_members")
      .select("*")
      .eq("thread_id", threadId);

    // Pinned message
    let pinnedMessage = null;
    if (thread.pinned_message_id) {
      const { data: pinned } = await sb
        .from("chat_messages")
        .select("*")
        .eq("id", thread.pinned_message_id)
        .single();
      if (pinned) pinnedMessage = dbRowToMessage(pinned);
    }

    console.log("[TEAM-CHAT-LOG]", "GET thread", threadId);
    return NextResponse.json({
      ...dbRowToThread(thread),
      members: (members ?? []).map(dbRowToMember),
      pinnedMessage,
    });
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "GET thread error:", err);
    return NextResponse.json(
      { error: "Failed to fetch thread", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await context.params;
  const role = await getUserRole(userId);

  const sb = getSupabase();

  // Only thread creator or manager/developer can update
  const { data: thread } = await sb
    .from("chat_threads")
    .select("created_by")
    .eq("id", threadId)
    .single();

  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  if (thread.created_by !== userId && !canManageFleet(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { pinnedMessageId?: string | null; title?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const updates: Record<string, unknown> = {};
    if ("pinnedMessageId" in body) updates.pinned_message_id = body.pinnedMessageId;
    if ("title" in body) updates.title = body.title;

    const { data: updated, error } = await sb
      .from("chat_threads")
      .update(updates)
      .eq("id", threadId)
      .select()
      .single();

    if (error) throw error;

    if ("pinnedMessageId" in body && body.pinnedMessageId) {
      const userName = await getUserName(userId);
      postMessagePinned(threadId, userName);
    }

    console.log("[TEAM-CHAT-LOG]", "PATCH thread", threadId, updates);
    return NextResponse.json(dbRowToThread(updated));
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "PATCH thread error:", err);
    return NextResponse.json(
      { error: "Failed to update thread", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await context.params;
  const role = await getUserRole(userId);

  if (!canManageFleet(role)) {
    return NextResponse.json({ error: "Forbidden — managers/developers only" }, { status: 403 });
  }

  const sb = getSupabase();

  try {
    const { error } = await sb
      .from("chat_threads")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", threadId);

    if (error) throw error;

    console.log("[TEAM-CHAT-LOG]", "DELETE (soft) thread", threadId, "by", userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "DELETE thread error:", err);
    return NextResponse.json(
      { error: "Failed to delete thread", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
