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

/**
 * Compute part status from quantity vs reorder_point.
 */
function computeStatus(
  quantity: number,
  reorderPoint: number,
): "in_stock" | "low_stock" | "out_of_stock" {
  if (quantity <= 0) return "out_of_stock";
  if (quantity <= reorderPoint) return "low_stock";
  return "in_stock";
}

/**
 * GET /api/inventory
 * List all parts. Optional filters: category, status, location, active_only (default true), search.
 * Ordered by category, then part_number.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const category = params.get("category");
  const status = params.get("status");
  const location = params.get("location");
  const activeOnly = params.get("active_only") !== "false"; // default true
  const search = params.get("search");

  try {
    const sb = getSupabase();
    let query = sb
      .from("parts")
      .select("*")
      .order("category", { ascending: true })
      .order("part_number", { ascending: true });

    if (activeOnly) query = query.eq("is_active", true);
    if (category) query = query.eq("category", category);
    if (status) query = query.eq("status", status);
    if (location) query = query.eq("location", location);
    if (search) {
      query = query.or(
        `name.ilike.%${search}%,part_number.ilike.%${search}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/inventory GET", err);
    return NextResponse.json(
      { error: "Failed to fetch inventory" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/inventory
 * Create a new part. Manager/developer only.
 * Required: part_number, name, category, unit_cost.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager =
    userInfo.role === "developer" || userInfo.role === "manager";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { part_number, name, category, unit_cost } = body;

  if (!part_number || !name || !category || unit_cost === undefined) {
    return NextResponse.json(
      { error: "Missing required fields: part_number, name, category, unit_cost" },
      { status: 400 },
    );
  }

  const validCategories = [
    "hydraulic", "electrical", "engine", "transmission", "brake",
    "suspension", "body", "safety", "consumable", "tool", "other",
  ];
  if (!validCategories.includes(category as string)) {
    return NextResponse.json(
      { error: `Invalid category. Must be one of: ${validCategories.join(", ")}` },
      { status: 400 },
    );
  }

  if (Number(unit_cost) < 0) {
    return NextResponse.json(
      { error: "unit_cost must be non-negative" },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabase();

    // Check unique part_number
    const { data: existing } = await sb
      .from("parts")
      .select("id")
      .eq("part_number", part_number as string)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "A part with this part_number already exists", existing_id: existing[0].id },
        { status: 409 },
      );
    }

    const quantityOnHand = Number(body.quantity_on_hand ?? 0);
    const reorderPoint = Number(body.reorder_point ?? 0);

    const { data, error } = await sb
      .from("parts")
      .insert({
        part_number,
        name,
        description: body.description || null,
        category,
        unit_cost: Number(unit_cost),
        unit: body.unit || "each",
        quantity_on_hand: quantityOnHand,
        reorder_point: reorderPoint,
        reorder_quantity: Number(body.reorder_quantity ?? 0),
        location: body.location || "shop",
        supplier: body.supplier || null,
        supplier_part_number: body.supplier_part_number || null,
        status: computeStatus(quantityOnHand, reorderPoint),
        is_active: true,
        notes: body.notes || null,
      })
      .select()
      .single();

    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "inventory_updated",
      details: {
        operation: "create",
        part_id: data.id,
        part_number: part_number as string,
        name: name as string,
      },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/inventory POST", err);
    return NextResponse.json(
      { error: "Failed to create part" },
      { status: 502 },
    );
  }
}
