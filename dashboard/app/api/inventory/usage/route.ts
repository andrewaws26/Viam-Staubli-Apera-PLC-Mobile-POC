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
 * GET /api/inventory/usage
 * List usage entries. Optional: part_id, truck_id, from, to.
 * Joins part name/number. Ordered by usage_date DESC.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const partId = params.get("part_id");
  const truckId = params.get("truck_id");
  const from = params.get("from");
  const to = params.get("to");

  try {
    const sb = getSupabase();
    let query = sb
      .from("part_usage")
      .select("*, parts:part_id(part_number, name)")
      .order("usage_date", { ascending: false })
      .limit(200);

    if (partId) query = query.eq("part_id", partId);
    if (truckId) query = query.eq("truck_id", truckId);
    if (from) query = query.gte("usage_date", from);
    if (to) query = query.lte("usage_date", to);

    const { data, error } = await query;
    if (error) throw error;

    // Flatten the joined part data into the usage entries
    const result = (data ?? []).map((entry) => {
      const parts = entry.parts as { part_number: string; name: string } | null;
      return {
        ...entry,
        part_number: parts?.part_number ?? null,
        part_name: parts?.name ?? null,
        parts: undefined,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[API-ERROR]", "/api/inventory/usage GET", err);
    return NextResponse.json(
      { error: "Failed to fetch usage entries" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/inventory/usage
 * Log part usage. Deducts quantity_on_hand, updates last_used, re-computes status.
 * Required: part_id, quantity_used, usage_type, usage_date.
 * Optional: truck_id, truck_name, maintenance_entry_id, notes.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { part_id, quantity_used, usage_type, usage_date } = body;

  if (!part_id || quantity_used === undefined || !usage_type || !usage_date) {
    return NextResponse.json(
      { error: "Missing required fields: part_id, quantity_used, usage_type, usage_date" },
      { status: 400 },
    );
  }

  const qty = Number(quantity_used);
  if (qty <= 0) {
    return NextResponse.json(
      { error: "quantity_used must be a positive number" },
      { status: 400 },
    );
  }

  const validUsageTypes = ["maintenance", "repair", "replacement", "inspection", "other"];
  if (!validUsageTypes.includes(usage_type as string)) {
    return NextResponse.json(
      { error: `Invalid usage_type. Must be one of: ${validUsageTypes.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabase();

    // Fetch the part to validate and get current quantity
    const { data: part, error: partErr } = await sb
      .from("parts")
      .select("id, part_number, name, quantity_on_hand, reorder_point, status, is_active")
      .eq("id", part_id as string)
      .single();

    if (partErr) {
      if (partErr.code === "PGRST116")
        return NextResponse.json({ error: "Part not found" }, { status: 404 });
      throw partErr;
    }

    if (!part.is_active) {
      return NextResponse.json(
        { error: "Cannot log usage for a deactivated part" },
        { status: 400 },
      );
    }

    if (qty > part.quantity_on_hand) {
      return NextResponse.json(
        {
          error: "Insufficient stock",
          available: part.quantity_on_hand,
          requested: qty,
        },
        { status: 409 },
      );
    }

    // Insert the usage entry
    const { data: usageEntry, error: usageErr } = await sb
      .from("part_usage")
      .insert({
        part_id,
        quantity_used: qty,
        usage_type,
        usage_date,
        truck_id: body.truck_id || null,
        truck_name: body.truck_name || null,
        maintenance_entry_id: body.maintenance_entry_id || null,
        used_by: userId,
        used_by_name: userInfo.name,
        notes: body.notes || null,
      })
      .select()
      .single();

    if (usageErr) throw usageErr;

    // Update the part: deduct quantity, set last_used, re-compute status
    const newQty = part.quantity_on_hand - qty;
    const newStatus =
      part.status === "discontinued"
        ? "discontinued"
        : computeStatus(newQty, part.reorder_point);

    const { error: updateErr } = await sb
      .from("parts")
      .update({
        quantity_on_hand: newQty,
        last_used: usage_date as string,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", part_id as string);

    if (updateErr) throw updateErr;

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "inventory_updated",
      details: {
        operation: "usage_logged",
        usage_id: usageEntry.id,
        part_id: part_id as string,
        part_number: part.part_number,
        quantity_used: qty,
        new_quantity: newQty,
        new_status: newStatus,
        usage_type: usage_type as string,
      },
    });

    return NextResponse.json(
      { ...usageEntry, part_number: part.part_number, part_name: part.name },
      { status: 201 },
    );
  } catch (err) {
    console.error("[API-ERROR]", "/api/inventory/usage POST", err);
    return NextResponse.json(
      { error: "Failed to log part usage" },
      { status: 502 },
    );
  }
}
