import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ROUTE_PERMISSIONS, hasRole, canSeeAllTrucks } from "./auth";
import { getSupabase } from "./supabase";

/**
 * Check if the current user has the required role for a route.
 * Returns a 401/403 NextResponse if denied, or null if access is granted.
 */
export async function requireRole(pathname: string) {
  const { userId, orgRole } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requiredRoles = ROUTE_PERMISSIONS[pathname];
  if (requiredRoles && !hasRole(orgRole ?? undefined, requiredRoles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

/**
 * Check if the current user can access a specific truck.
 * Operators can only access trucks assigned to them in the truck_assignments table.
 * Developer/manager/mechanic can access any truck.
 * Returns a 403 NextResponse if denied, or null if access is granted.
 */
export async function requireTruckAccess(requestedTruckId: string | null) {
  if (!requestedTruckId) return null;

  const { userId, orgRole } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (orgRole && canSeeAllTrucks(orgRole)) return null;

  try {
    const sb = getSupabase();
    const { data } = await sb
      .from("truck_assignments")
      .select("id")
      .eq("user_id", userId)
      .eq("truck_id", requestedTruckId)
      .limit(1);

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "Forbidden", message: "You do not have access to this truck" },
        { status: 403 },
      );
    }
  } catch (err) {
    console.error("[API-ERROR]", "requireTruckAccess", err);
    // If Supabase is down, fail open for non-operators to avoid blocking the fleet
    // Operators still get denied since we couldn't verify their assignment
    return NextResponse.json(
      { error: "Service unavailable", message: "Could not verify truck access" },
      { status: 503 },
    );
  }

  return null;
}
