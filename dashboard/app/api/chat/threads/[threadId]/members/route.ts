import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";
import { canManageFleet } from "@/lib/auth";
import { postMemberJoined } from "@/lib/chat-system-messages";

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

type RouteContext = { params: Promise<{ threadId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await context.params;
  const sb = getSupabase();

  try {
    const { data: members, error } = await sb
      .from("chat_thread_members")
      .select("*")
      .eq("thread_id", threadId);

    if (error) throw error;

    // Enrich with Clerk user data
    const client = await clerkClient();
    const enriched = await Promise.all(
      (members ?? []).map(async (m) => {
        try {
          const user = await client.users.getUser(m.user_id);
          return {
            ...m,
            userName: user.firstName
              ? `${user.firstName} ${user.lastName ?? ""}`.trim()
              : user.emailAddresses?.[0]?.emailAddress ?? "Unknown",
            userRole: (user.publicMetadata as Record<string, unknown>)?.role || "operator",
          };
        } catch {
          return { ...m, userName: "Unknown", userRole: "operator" };
        }
      }),
    );

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "GET members error:", err);
    return NextResponse.json(
      { error: "Failed to fetch members", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const currentUserId = await getAuthUserId();
  if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await context.params;
  const role = await getUserRole(currentUserId);
  const sb = getSupabase();

  // Check permission: manager/developer or thread creator
  const { data: thread } = await sb
    .from("chat_threads")
    .select("created_by, entity_type")
    .eq("id", threadId)
    .single();

  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  const isCreator = thread.created_by === currentUserId;
  const isDmCreator = isCreator && thread.entity_type === "direct";
  if (!canManageFleet(role) && !isDmCreator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { userId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 422 });
  }

  try {
    const { error } = await sb.from("chat_thread_members").upsert(
      { thread_id: threadId, user_id: body.userId },
      { onConflict: "thread_id,user_id" },
    );
    if (error) throw error;

    const memberName = await getUserName(body.userId);
    postMemberJoined(threadId, memberName);

    console.log("[TEAM-CHAT-LOG]", "Member added", { threadId, userId: body.userId });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "Add member error:", err);
    return NextResponse.json(
      { error: "Failed to add member", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const currentUserId = await getAuthUserId();
  if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await context.params;
  const role = await getUserRole(currentUserId);

  if (!canManageFleet(role)) {
    return NextResponse.json({ error: "Forbidden — managers/developers only" }, { status: 403 });
  }

  const targetUserId = request.nextUrl.searchParams.get("userId");
  if (!targetUserId) {
    return NextResponse.json({ error: "Missing userId query param" }, { status: 422 });
  }

  const sb = getSupabase();

  // Check we're not removing the last member
  const { count } = await sb
    .from("chat_thread_members")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId);

  if ((count ?? 0) <= 1) {
    return NextResponse.json({ error: "Cannot remove last member" }, { status: 422 });
  }

  try {
    const { error } = await sb
      .from("chat_thread_members")
      .delete()
      .eq("thread_id", threadId)
      .eq("user_id", targetUserId);

    if (error) throw error;

    console.log("[TEAM-CHAT-LOG]", "Member removed", { threadId, userId: targetUserId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "Remove member error:", err);
    return NextResponse.json(
      { error: "Failed to remove member", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
