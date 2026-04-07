import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";
import { canManageFleet } from "@/lib/auth";
import {
  ChatEntityType,
  CreateThreadPayload,
  dbRowToThread,
  dbRowToMessage,
} from "@/lib/chat";

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

export async function GET(request: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(userId);
  const entityType = request.nextUrl.searchParams.get("entity_type") as ChatEntityType | null;
  const entityId = request.nextUrl.searchParams.get("entity_id");

  const sb = getSupabase();

  try {
    // Managers/developers see all entity threads; others only their memberships
    const isManager = canManageFleet(role);

    let query = sb
      .from("chat_threads")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (entityType) query = query.eq("entity_type", entityType);
    if (entityId) query = query.eq("entity_id", entityId);

    const { data: threads, error } = await query;
    if (error) throw error;

    // Filter to threads user is a member of (or all entity threads for managers)
    const { data: memberships } = await sb
      .from("chat_thread_members")
      .select("thread_id")
      .eq("user_id", userId);

    const memberThreadIds = new Set((memberships ?? []).map((m) => m.thread_id));

    const visibleThreads = (threads ?? []).filter((t) => {
      if (memberThreadIds.has(t.id)) return true;
      if (isManager && t.entity_type !== "direct") return true;
      return false;
    });

    // Enrich with last message, unread count, member count
    const enriched = await Promise.all(
      visibleThreads.map(async (t) => {
        const thread = dbRowToThread(t);

        // Last message
        const { data: lastMsgs } = await sb
          .from("chat_messages")
          .select("*")
          .eq("thread_id", t.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1);

        const lastMessage = lastMsgs?.[0] ? dbRowToMessage(lastMsgs[0]) : null;

        // Member count
        const { count: memberCount } = await sb
          .from("chat_thread_members")
          .select("id", { count: "exact", head: true })
          .eq("thread_id", t.id);

        // Unread count: messages after user's last_read_at
        let unreadCount = 0;
        const membership = (memberships ?? []).find((m) => m.thread_id === t.id);
        if (membership) {
          const { data: memberRow } = await sb
            .from("chat_thread_members")
            .select("last_read_at")
            .eq("thread_id", t.id)
            .eq("user_id", userId)
            .single();

          if (memberRow) {
            const { count } = await sb
              .from("chat_messages")
              .select("id", { count: "exact", head: true })
              .eq("thread_id", t.id)
              .is("deleted_at", null)
              .gt("created_at", memberRow.last_read_at)
              .neq("sender_id", userId);

            unreadCount = count ?? 0;
          }
        }

        return {
          ...thread,
          lastMessage,
          unreadCount,
          memberCount: memberCount ?? 0,
        };
      }),
    );

    // Sort by most recent message
    enriched.sort((a, b) => {
      const aTime = a.lastMessage?.createdAt || a.createdAt;
      const bTime = b.lastMessage?.createdAt || b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    console.log("[TEAM-CHAT-LOG]", "GET /api/chat/threads", { userId, count: enriched.length });
    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "GET /api/chat/threads error:", err);
    return NextResponse.json(
      { error: "Failed to fetch threads", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: CreateThreadPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { entityType, entityId, title, memberIds } = body;
  if (!entityType) {
    return NextResponse.json({ error: "Missing entityType" }, { status: 422 });
  }

  const sb = getSupabase();
  const userName = await getUserName(userId);
  const role = await getUserRole(userId);

  try {
    // For entity threads (not direct), check if one already exists
    if (entityType !== "direct" && entityId) {
      const { data: existing } = await sb
        .from("chat_threads")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .is("deleted_at", null)
        .limit(1);

      if (existing && existing.length > 0) {
        // Ensure creator is a member
        await sb.from("chat_thread_members").upsert(
          { thread_id: existing[0].id, user_id: userId },
          { onConflict: "thread_id,user_id" },
        );
        console.log("[TEAM-CHAT-LOG]", "POST /api/chat/threads returned existing", existing[0].id);
        return NextResponse.json(dbRowToThread(existing[0]));
      }
    }

    // For DMs, check if one already exists between these users
    if (entityType === "direct" && memberIds.length === 1) {
      const otherUserId = memberIds[0];
      const { data: myThreads } = await sb
        .from("chat_thread_members")
        .select("thread_id")
        .eq("user_id", userId);

      if (myThreads) {
        for (const mt of myThreads) {
          const { data: thread } = await sb
            .from("chat_threads")
            .select("*")
            .eq("id", mt.thread_id)
            .eq("entity_type", "direct")
            .is("deleted_at", null)
            .single();

          if (!thread) continue;

          const { count } = await sb
            .from("chat_thread_members")
            .select("id", { count: "exact", head: true })
            .eq("thread_id", thread.id);

          if (count === 2) {
            const { data: otherMember } = await sb
              .from("chat_thread_members")
              .select("user_id")
              .eq("thread_id", thread.id)
              .eq("user_id", otherUserId)
              .single();

            if (otherMember) {
              console.log("[TEAM-CHAT-LOG]", "POST /api/chat/threads returned existing DM", thread.id);
              return NextResponse.json(dbRowToThread(thread));
            }
          }
        }
      }
    }

    // Generate title
    let threadTitle = title;
    if (!threadTitle) {
      if (entityType === "truck") {
        threadTitle = `Truck ${entityId}`;
      } else if (entityType === "work_order") {
        threadTitle = `WO-${entityId}`;
      } else if (entityType === "dtc") {
        threadTitle = `DTC ${entityId}`;
      } else if (entityType === "direct" && memberIds.length === 1) {
        const otherName = await getUserName(memberIds[0]);
        threadTitle = `${userName} & ${otherName}`;
      } else {
        threadTitle = "New conversation";
      }
    }

    // Create thread
    const { data: thread, error: createErr } = await sb
      .from("chat_threads")
      .insert({
        entity_type: entityType,
        entity_id: entityId || null,
        title: threadTitle,
        created_by: userId,
      })
      .select()
      .single();

    if (createErr) throw createErr;

    // Add creator as member
    await sb.from("chat_thread_members").insert({
      thread_id: thread.id,
      user_id: userId,
    });

    // Add specified members
    for (const mid of memberIds) {
      if (mid !== userId) {
        await sb.from("chat_thread_members").upsert(
          { thread_id: thread.id, user_id: mid },
          { onConflict: "thread_id,user_id" },
        );
      }
    }

    // For truck threads, auto-add assigned users
    if (entityType === "truck" && entityId) {
      const { data: assignments } = await sb
        .from("truck_assignments")
        .select("user_id")
        .eq("truck_id", entityId);

      for (const a of assignments ?? []) {
        await sb.from("chat_thread_members").upsert(
          { thread_id: thread.id, user_id: a.user_id },
          { onConflict: "thread_id,user_id" },
        );
      }
    }

    console.log("[TEAM-CHAT-LOG]", "POST /api/chat/threads created", {
      id: thread.id,
      entityType,
      entityId,
      createdBy: userId,
    });

    return NextResponse.json(dbRowToThread(thread), { status: 201 });
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "POST /api/chat/threads error:", err);
    return NextResponse.json(
      { error: "Failed to create thread", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
