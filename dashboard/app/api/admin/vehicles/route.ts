import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

/**
 * Inline role resolver — matches pattern used across this codebase.
 */
async function getUserRole(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (user.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  } catch {
    return "operator";
  }
}

/**
 * GET /api/admin/vehicles
 * List ALL company vehicles (active + inactive) for admin management.
 * Requires manager or developer role.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(userId);
  const isManager = role === "manager" || role === "developer";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("company_vehicles")
      .select("*")
      .order("vehicle_type", { ascending: true })
      .order("vehicle_number", { ascending: true });

    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[ADMIN-VEHICLES]", "GET failed", err);
    return NextResponse.json(
      { error: "Failed to fetch vehicles", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

/**
 * POST /api/admin/vehicles
 * Add a new company vehicle.
 * Body: { vehicle_number: string, vehicle_type: "chase" | "semi" | "other" }
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(userId);
  const isManager = role === "manager" || role === "developer";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { vehicle_number?: string; vehicle_type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { vehicle_number, vehicle_type } = body;
  if (!vehicle_number || !vehicle_type) {
    return NextResponse.json(
      { error: "Missing vehicle_number or vehicle_type" },
      { status: 400 },
    );
  }

  const validTypes = ["chase", "semi", "other"];
  if (!validTypes.includes(vehicle_type)) {
    return NextResponse.json(
      { error: `vehicle_type must be one of: ${validTypes.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("company_vehicles")
      .insert({ vehicle_number: vehicle_number.trim(), vehicle_type, is_active: true })
      .select()
      .single();

    if (error) throw error;

    console.log("[ADMIN-VEHICLES]", "created", { vehicle_number, vehicle_type, by: userId });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[ADMIN-VEHICLES]", "POST failed", err);
    return NextResponse.json(
      { error: "Failed to create vehicle", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

/**
 * PATCH /api/admin/vehicles
 * Update a vehicle (toggle is_active, change vehicle_type).
 * Body: { id: string, is_active?: boolean, vehicle_type?: string }
 */
export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(userId);
  const isManager = role === "manager" || role === "developer";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { id?: string; is_active?: boolean; vehicle_type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "Missing vehicle id" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.is_active === "boolean") updates.is_active = body.is_active;
  if (body.vehicle_type) {
    const validTypes = ["chase", "semi", "other"];
    if (!validTypes.includes(body.vehicle_type)) {
      return NextResponse.json(
        { error: `vehicle_type must be one of: ${validTypes.join(", ")}` },
        { status: 400 },
      );
    }
    updates.vehicle_type = body.vehicle_type;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("company_vehicles")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    console.log("[ADMIN-VEHICLES]", "updated", { id, updates, by: userId });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[ADMIN-VEHICLES]", "PATCH failed", err);
    return NextResponse.json(
      { error: "Failed to update vehicle", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

/**
 * DELETE /api/admin/vehicles?id=<uuid>
 * Hard-delete a vehicle from the database.
 */
export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(userId);
  const isManager = role === "manager" || role === "developer";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const vehicleId = request.nextUrl.searchParams.get("id");
  if (!vehicleId) {
    return NextResponse.json({ error: "Missing vehicle id" }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    const { error } = await sb
      .from("company_vehicles")
      .delete()
      .eq("id", vehicleId);

    if (error) throw error;

    console.log("[ADMIN-VEHICLES]", "deleted", { id: vehicleId, by: userId });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[ADMIN-VEHICLES]", "DELETE failed", err);
    return NextResponse.json(
      { error: "Failed to delete vehicle", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
