import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ROUTE_PERMISSIONS, hasRole, canSeeAllTrucks } from "./auth";

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
 * Operators can only access their assigned truck (set in Clerk public metadata).
 * All other roles can access any truck.
 * Returns a 403 NextResponse if denied, or null if access is granted.
 */
export async function requireTruckAccess(requestedTruckId: string | null) {
  if (!requestedTruckId) return null;

  const { userId, orgRole } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (orgRole && canSeeAllTrucks(orgRole)) return null;

  const user = await currentUser();
  const assignedTruckId = (user?.publicMetadata as Record<string, unknown>)?.truck_id as string | undefined;

  if (assignedTruckId && assignedTruckId !== requestedTruckId) {
    return NextResponse.json(
      { error: "Forbidden", message: "You do not have access to this truck" },
      { status: 403 },
    );
  }

  return null;
}
