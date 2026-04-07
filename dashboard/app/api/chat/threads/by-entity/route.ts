import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";
import { ChatEntityType, dbRowToThread } from "@/lib/chat";

async function getUserRole(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (user.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  } catch {
    return "operator";
  }
}

export async function GET(request: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const entityType = request.nextUrl.searchParams.get("entity_type") as ChatEntityType | null;
  const entityId = request.nextUrl.searchParams.get("entity_id");

  if (!entityType || !entityId) {
    return NextResponse.json({ error: "Missing entity_type or entity_id" }, { status: 422 });
  }

  const sb = getSupabase();

  try {
    // Check for existing thread
    const { data: existing } = await sb
      .from("chat_threads")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .is("deleted_at", null)
      .limit(1);

    if (existing && existing.length > 0) {
      // Ensure requester is a member
      await sb.from("chat_thread_members").upsert(
        { thread_id: existing[0].id, user_id: userId },
        { onConflict: "thread_id,user_id" },
      );

      console.log("[TEAM-CHAT-LOG]", "by-entity returned existing", existing[0].id);
      return NextResponse.json(dbRowToThread(existing[0]));
    }

    // Auto-create
    let title = "";
    if (entityType === "truck") {
      title = `Truck ${entityId}`;
    } else if (entityType === "work_order") {
      // Try to fetch work order title
      const { data: wo } = await sb
        .from("work_orders")
        .select("title")
        .eq("id", entityId)
        .single();
      title = wo ? `WO: ${wo.title}` : `WO-${entityId}`;
    } else if (entityType === "dtc") {
      title = `DTC ${entityId}`;
    } else {
      title = `${entityType} ${entityId}`;
    }

    const { data: thread, error: createErr } = await sb
      .from("chat_threads")
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        title,
        created_by: userId,
      })
      .select()
      .single();

    if (createErr) throw createErr;

    // Add creator
    await sb.from("chat_thread_members").insert({
      thread_id: thread.id,
      user_id: userId,
    });

    // Auto-add assigned users for truck threads
    if (entityType === "truck") {
      const { data: assignments } = await sb
        .from("truck_assignments")
        .select("user_id")
        .eq("truck_id", entityId);

      for (const a of assignments ?? []) {
        if (a.user_id !== userId) {
          await sb.from("chat_thread_members").upsert(
            { thread_id: thread.id, user_id: a.user_id },
            { onConflict: "thread_id,user_id" },
          );
        }
      }
    }

    console.log("[TEAM-CHAT-LOG]", "by-entity created", {
      id: thread.id,
      entityType,
      entityId,
    });

    return NextResponse.json(dbRowToThread(thread), { status: 201 });
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "by-entity error:", err);
    return NextResponse.json(
      { error: "Failed to get/create thread", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
