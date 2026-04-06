import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ROUTE_PERMISSIONS, hasRole } from "./auth";

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
