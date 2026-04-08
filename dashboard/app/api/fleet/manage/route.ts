import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";
import { reloadFleetConfig } from "@/lib/machines";

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

const VALID_STATUSES = ["active", "inactive", "maintenance", "decommissioned"];

/**
 * GET /api/fleet/manage
 * List all trucks. Any authenticated user.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("fleet_trucks")
      .select("*")
      .order("id", { ascending: true });

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/fleet/manage GET", err);
    return NextResponse.json(
      { error: "Failed to fetch trucks" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/fleet/manage
 * Create a new truck. Manager/developer only.
 * Required: id, name.
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

  const { id, name } = body;

  if (!id || !name) {
    return NextResponse.json(
      { error: "Missing required fields: id, name" },
      { status: 400 },
    );
  }

  if (body.status && !VALID_STATUSES.includes(body.status as string)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabase();

    // Check for duplicate ID
    const { data: existing } = await sb
      .from("fleet_trucks")
      .select("id")
      .eq("id", id as string)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "A truck with this ID already exists" },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();

    const { data, error } = await sb
      .from("fleet_trucks")
      .insert({
        id: id as string,
        name: name as string,
        vin: (body.vin as string) || null,
        year: body.year ? Number(body.year) : null,
        make: (body.make as string) || "Mack",
        model: (body.model as string) || "Granite",
        license_plate: (body.license_plate as string) || null,
        viam_part_id: (body.viam_part_id as string) || "",
        viam_machine_address: (body.viam_machine_address as string) || "",
        home_base: (body.home_base as string) || "Shepherdsville, KY",
        status: (body.status as string) || "active",
        has_tps: body.has_tps !== undefined ? Boolean(body.has_tps) : true,
        has_cell: body.has_cell !== undefined ? Boolean(body.has_cell) : false,
        has_j1939: body.has_j1939 !== undefined ? Boolean(body.has_j1939) : true,
        notes: (body.notes as string) || null,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "fleet_truck_created",
      truckId: data.id,
      details: {
        operation: "create",
        truck_id: data.id,
        name: data.name,
      },
    });

    reloadFleetConfig();
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/fleet/manage POST", err);
    return NextResponse.json(
      { error: "Failed to create truck" },
      { status: 502 },
    );
  }
}

/**
 * PATCH /api/fleet/manage
 * Update a truck. Manager/developer only.
 * Required: id in body.
 */
export async function PATCH(request: NextRequest) {
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

  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json(
      { error: "Missing required field: id" },
      { status: 400 },
    );
  }

  if (updates.status && !VALID_STATUSES.includes(updates.status as string)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  // Build safe update payload — only allow known columns
  const allowedFields = [
    "name", "vin", "year", "make", "model", "license_plate",
    "viam_part_id", "viam_machine_address", "home_base", "status",
    "has_tps", "has_cell", "has_j1939", "notes",
  ];

  const safeUpdates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in updates) {
      safeUpdates[key] = updates[key];
    }
  }

  if (Object.keys(safeUpdates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  safeUpdates.updated_at = new Date().toISOString();

  try {
    const sb = getSupabase();

    const { data, error } = await sb
      .from("fleet_trucks")
      .update(safeUpdates)
      .eq("id", id as string)
      .select()
      .single();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { error: "Truck not found" },
        { status: 404 },
      );
    }

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "fleet_truck_updated",
      truckId: data.id,
      details: {
        operation: "update",
        truck_id: data.id,
        fields_updated: Object.keys(safeUpdates).filter((k) => k !== "updated_at"),
      },
    });

    reloadFleetConfig();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", "/api/fleet/manage PATCH", err);
    return NextResponse.json(
      { error: "Failed to update truck" },
      { status: 502 },
    );
  }
}

/**
 * DELETE /api/fleet/manage
 * Soft-deactivate a truck (set status = 'decommissioned'). Manager/developer only.
 * Takes id from query params.
 */
export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager =
    userInfo.role === "developer" || userInfo.role === "manager";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "Missing required query param: id" },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabase();

    const { data, error } = await sb
      .from("fleet_trucks")
      .update({
        status: "decommissioned",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { error: "Truck not found" },
        { status: 404 },
      );
    }

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "fleet_truck_decommissioned",
      truckId: data.id,
      details: {
        operation: "decommission",
        truck_id: data.id,
        name: data.name,
      },
    });

    reloadFleetConfig();
    return NextResponse.json({ success: true, truck: data });
  } catch (err) {
    console.error("[API-ERROR]", "/api/fleet/manage DELETE", err);
    return NextResponse.json(
      { error: "Failed to decommission truck" },
      { status: 502 },
    );
  }
}
