import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";

async function getUserInfo(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const name = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
    const email = user.emailAddresses?.[0]?.emailAddress ?? "";
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator";
    return { name, email, role };
  } catch {
    return { name: "Unknown", email: "", role: "operator" };
  }
}

function computeStatus(
  quantity: number,
  reorderPoint: number,
): "in_stock" | "low_stock" | "out_of_stock" {
  if (quantity <= 0) return "out_of_stock";
  if (quantity <= reorderPoint) return "low_stock";
  return "in_stock";
}

/**
 * GET /api/inventory/[id]
 * Single part with recent usage (last 10 from part_usage table).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const sb = getSupabase();

    const { data: part, error: partError } = await sb
      .from("parts")
      .select("*")
      .eq("id", id)
      .single();

    if (partError) {
      if (partError.code === "PGRST116")
        return NextResponse.json({ error: "Part not found" }, { status: 404 });
      throw partError;
    }

    // Fetch last 10 usage entries for this part
    const { data: recentUsage, error: usageError } = await sb
      .from("part_usage")
      .select("*")
      .eq("part_id", id)
      .order("usage_date", { ascending: false })
      .limit(10);

    if (usageError) throw usageError;

    return NextResponse.json({ ...part, recent_usage: recentUsage ?? [] });
  } catch (err) {
    console.error("[API-ERROR]", `/api/inventory/${id} GET`, err);
    return NextResponse.json(
      { error: "Failed to fetch part" },
      { status: 502 },
    );
  }
}

/**
 * PATCH /api/inventory/[id]
 * Update part fields. Manager/developer only.
 * Re-computes status if quantity_on_hand changes.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager =
    userInfo.role === "developer" || userInfo.role === "manager";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Allowable update fields
  const allowedFields = [
    "name", "description", "category", "unit_cost", "unit",
    "quantity_on_hand", "reorder_point", "reorder_quantity",
    "location", "supplier", "supplier_part_number", "is_active", "notes",
  ];

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if (field === "unit_cost" || field === "quantity_on_hand" ||
          field === "reorder_point" || field === "reorder_quantity") {
        updates[field] = Number(body[field]);
      } else {
        updates[field] = body[field];
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // If quantity_on_hand or reorder_point changed, re-compute status
    if (updates.quantity_on_hand !== undefined || updates.reorder_point !== undefined) {
      // Fetch current part to get the other value if only one changed
      const { data: current, error: fetchErr } = await sb
        .from("parts")
        .select("quantity_on_hand, reorder_point, status")
        .eq("id", id)
        .single();

      if (fetchErr) {
        if (fetchErr.code === "PGRST116")
          return NextResponse.json({ error: "Part not found" }, { status: 404 });
        throw fetchErr;
      }

      const newQty = (updates.quantity_on_hand ?? current.quantity_on_hand) as number;
      const newReorder = (updates.reorder_point ?? current.reorder_point) as number;

      // Only auto-set status if not currently discontinued
      if (current.status !== "discontinued") {
        updates.status = computeStatus(newQty, newReorder);
      }
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await sb
      .from("parts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116")
        return NextResponse.json({ error: "Part not found" }, { status: 404 });
      throw error;
    }

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "inventory_updated",
      details: {
        operation: "update",
        part_id: id,
        fields_updated: Object.keys(updates).filter((k) => k !== "updated_at"),
      },
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", `/api/inventory/${id} PATCH`, err);
    return NextResponse.json(
      { error: "Failed to update part" },
      { status: 502 },
    );
  }
}

/**
 * DELETE /api/inventory/[id]
 * Soft-delete (set is_active=false). Manager/developer only.
 * Checks for pending usage before deactivating.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager =
    userInfo.role === "developer" || userInfo.role === "manager";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const sb = getSupabase();

    // Check the part exists
    const { data: part, error: fetchErr } = await sb
      .from("parts")
      .select("id, part_number, name, is_active")
      .eq("id", id)
      .single();

    if (fetchErr) {
      if (fetchErr.code === "PGRST116")
        return NextResponse.json({ error: "Part not found" }, { status: 404 });
      throw fetchErr;
    }

    if (!part.is_active) {
      return NextResponse.json({ error: "Part is already deactivated" }, { status: 400 });
    }

    // Check for recent pending usage (usage in the last 24 hours that might indicate
    // an active maintenance job referencing this part)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: pendingUsage } = await sb
      .from("part_usage")
      .select("id")
      .eq("part_id", id)
      .gte("created_at", oneDayAgo)
      .limit(1);

    if (pendingUsage && pendingUsage.length > 0) {
      return NextResponse.json(
        { error: "Cannot deactivate: part has usage logged within the last 24 hours" },
        { status: 409 },
      );
    }

    const { data, error } = await sb
      .from("parts")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "inventory_updated",
      details: {
        operation: "soft_delete",
        part_id: id,
        part_number: part.part_number,
        name: part.name,
      },
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", `/api/inventory/${id} DELETE`, err);
    return NextResponse.json(
      { error: "Failed to deactivate part" },
      { status: 502 },
    );
  }
}
