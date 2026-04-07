import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";
import { canManageFleet } from "@/lib/auth";
import { postWorkOrderStatusChange } from "@/lib/chat-system-messages";

async function getUserInfo(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const name = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator";
    return { name, role };
  } catch {
    return { name: "Unknown", role: "operator" };
  }
}

/**
 * GET /api/work-orders
 * Query params: status, assigned_to, truck_id
 * Returns work orders with embedded subtasks and note counts.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const assignedTo = params.get("assigned_to");
  const truckId = params.get("truck_id");

  try {
    const sb = getSupabase();
    let query = sb
      .from("work_orders")
      .select("*, work_order_subtasks(*), work_order_notes(id)")
      .order("created_at", { ascending: false })
      .limit(200);

    if (status) query = query.eq("status", status);
    if (assignedTo) query = query.eq("assigned_to", assignedTo);
    if (truckId) query = query.eq("truck_id", truckId);

    const { data, error } = await query;
    if (error) throw error;

    // Reshape: add note_count, sort subtasks
    const result = (data ?? []).map((wo: Record<string, unknown>) => {
      const notes = wo.work_order_notes as unknown[];
      const subtasks = wo.work_order_subtasks as Record<string, unknown>[];
      return {
        ...wo,
        note_count: notes?.length ?? 0,
        work_order_notes: undefined,
        subtasks: (subtasks ?? []).sort(
          (a, b) => (a.sort_order as number) - (b.sort_order as number),
        ),
        work_order_subtasks: undefined,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[API-ERROR]", "/api/work-orders GET", err);
    return NextResponse.json(
      { error: "Failed to fetch work orders" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/work-orders
 * Create a new work order.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);

  // Only manager/mechanic/developer can create work orders
  if (userInfo.role === "operator") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    truck_id,
    title,
    description,
    priority,
    assigned_to,
    assigned_to_name,
    due_date,
    truck_snapshot,
    linked_dtcs,
    subtasks,
  } = body as Record<string, unknown>;

  if (!title || !(title as string).trim()) {
    return NextResponse.json({ error: "Missing title" }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("work_orders")
      .insert({
        truck_id: truck_id || null,
        title: (title as string).trim(),
        description: description || null,
        priority: priority || "normal",
        assigned_to: assigned_to || null,
        assigned_to_name: assigned_to_name || null,
        created_by: userId,
        created_by_name: userInfo.name,
        due_date: due_date || null,
        truck_snapshot: truck_snapshot || null,
        linked_dtcs: linked_dtcs || [],
      })
      .select()
      .single();

    if (error) throw error;

    // Create subtasks if provided
    if (Array.isArray(subtasks) && subtasks.length > 0) {
      const subtaskRows = (subtasks as { title: string }[]).map((s, i) => ({
        work_order_id: data.id,
        title: s.title,
        sort_order: i,
      }));
      await sb.from("work_order_subtasks").insert(subtaskRows);
    }

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "work_order_created",
      truckId: (truck_id as string) ?? undefined,
      details: {
        work_order_id: data.id,
        title: (title as string).trim().substring(0, 100),
        assigned_to: assigned_to || "backlog",
        priority,
      },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/work-orders POST", err);
    return NextResponse.json(
      { error: "Failed to create work order" },
      { status: 502 },
    );
  }
}

/**
 * PATCH /api/work-orders?id=<uuid>
 * Update status, assignment, blocker, priority, etc.
 * Operators can only update their own assigned work orders (status + blocker).
 */
export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const userInfo = await getUserInfo(userId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // Fetch current work order
    const { data: existing, error: fetchErr } = await sb
      .from("work_orders")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchErr || !existing) {
      return NextResponse.json(
        { error: "Work order not found" },
        { status: 404 },
      );
    }

    // Operators can only update work orders assigned to them (status + blocker only)
    if (userInfo.role === "operator") {
      if (existing.assigned_to !== userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // Restrict fields operators can update
      const allowed = ["status", "blocker_reason"];
      for (const key of Object.keys(body)) {
        if (!allowed.includes(key)) delete body[key];
      }
    }

    // Build update payload
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const allowedFields = [
      "title", "description", "status", "priority",
      "blocker_reason", "assigned_to", "assigned_to_name",
      "due_date", "truck_id",
    ];
    for (const field of allowedFields) {
      if (field in body) update[field] = body[field];
    }

    // Auto-set completed_at
    if (body.status === "done" && !existing.completed_at) {
      update.completed_at = new Date().toISOString();
    }
    if (body.status && body.status !== "done") {
      update.completed_at = null;
    }

    // Clear blocker_reason when moving out of blocked status
    if (body.status && body.status !== "blocked" && existing.status === "blocked") {
      update.blocker_reason = null;
    }

    const { data, error } = await sb
      .from("work_orders")
      .update(update)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    // Handle subtask updates if provided
    if (body.toggle_subtask_id) {
      const { data: subtask } = await sb
        .from("work_order_subtasks")
        .select("is_done")
        .eq("id", body.toggle_subtask_id)
        .eq("work_order_id", id)
        .single();
      if (subtask) {
        await sb
          .from("work_order_subtasks")
          .update({ is_done: !subtask.is_done })
          .eq("id", body.toggle_subtask_id);
      }
    }

    // Add a note if provided (e.g., "reassigned to Jake")
    if (body.note && (body.note as string).trim()) {
      await sb.from("work_order_notes").insert({
        work_order_id: id,
        author_id: userId,
        author_name: userInfo.name,
        body: (body.note as string).trim(),
      });
    }

    // Post system message to work order chat thread on status change
    if (body.status && body.status !== existing.status) {
      const sb2 = getSupabase();
      const { data: thread } = await sb2
        .from("chat_threads")
        .select("id")
        .eq("entity_type", "work_order")
        .eq("entity_id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (thread) {
        postWorkOrderStatusChange(thread.id, body.status as string, userInfo.name);
      }
    }

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "work_order_updated",
      truckId: existing.truck_id ?? undefined,
      details: {
        work_order_id: id,
        changes: Object.keys(update).filter((k) => k !== "updated_at"),
        new_status: body.status,
      },
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", "/api/work-orders PATCH", err);
    return NextResponse.json(
      { error: "Failed to update work order" },
      { status: 502 },
    );
  }
}

/**
 * DELETE /api/work-orders?id=<uuid>
 * Only manager/developer can delete.
 */
export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (!canManageFleet(userInfo.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const sb = getSupabase();
    const { error } = await sb.from("work_orders").delete().eq("id", id);
    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "work_order_deleted",
      details: { work_order_id: id },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[API-ERROR]", "/api/work-orders DELETE", err);
    return NextResponse.json(
      { error: "Failed to delete work order" },
      { status: 502 },
    );
  }
}
