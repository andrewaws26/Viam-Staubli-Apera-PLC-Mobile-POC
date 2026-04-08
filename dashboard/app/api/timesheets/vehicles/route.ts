import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

/**
 * GET /api/timesheets/vehicles
 * Return active company vehicles grouped by type for timesheet dropdowns.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("company_vehicles")
      .select("*")
      .eq("is_active", true)
      .order("vehicle_number", { ascending: true });

    if (error) throw error;

    const vehicles = data ?? [];
    const chase = vehicles
      .filter((v) => v.vehicle_type === "chase")
      .map((v) => v.vehicle_number);
    const semi = vehicles
      .filter((v) => v.vehicle_type === "semi")
      .map((v) => v.vehicle_number);
    const other = vehicles
      .filter((v) => v.vehicle_type === "other")
      .map((v) => v.vehicle_number);

    return NextResponse.json({ chase, semi, other, all: vehicles });
  } catch (err) {
    console.error("[API-ERROR]", "/api/timesheets/vehicles GET", err);
    return NextResponse.json(
      { error: "Failed to fetch vehicles" },
      { status: 502 },
    );
  }
}
