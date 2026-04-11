import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { ROUTE_PERMISSIONS, hasRole, canSeeAllTrucks } from "./auth";
import { getSupabase } from "./supabase";

/**
 * Get the authenticated user ID.
 * Tries Clerk session auth first (web browser), then falls back to
 * Bearer token verification (mobile app in Clerk dev mode).
 */
export async function getAuthUserId(): Promise<string | null> {
  // Try standard Clerk auth (works in browser with session cookies)
  const { userId } = await auth();
  if (userId) return userId;

  // Fall back to Bearer token for mobile app (Clerk dev mode doesn't
  // populate auth() from Bearer tokens without the dev browser cookie)
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  try {
    // Decode Clerk session JWT — the "sub" claim contains the user ID
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    );
    if (payload.sub && typeof payload.sub === "string" && payload.sub.startsWith("user_")) {
      // Verify the user actually exists in Clerk
      const client = await clerkClient();
      await client.users.getUser(payload.sub);
      return payload.sub;
    }
  } catch {
    // Invalid token or user not found
  }
  return null;
}

/**
 * Fetch the user's role from Clerk publicMetadata.
 * Returns null when Clerk is unreachable (callers should treat as 503).
 * Returns "operator" only as a legitimate default for new users with no role set.
 */
async function getUserRole(userId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (user.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  } catch {
    return null;
  }
}

/**
 * Check if the current user has the required role for a route.
 * Returns a 401/403 NextResponse if denied, or null if access is granted.
 */
export async function requireRole(pathname: string) {
  const userId = await getAuthUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requiredRoles = ROUTE_PERMISSIONS[pathname];
  if (requiredRoles) {
    const role = await getUserRole(userId);
    if (role === null) {
      return NextResponse.json({ error: "Auth service unavailable" }, { status: 503 });
    }
    if (!hasRole(role, requiredRoles)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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

  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(userId);
  if (role === null) {
    return NextResponse.json({ error: "Auth service unavailable" }, { status: 503 });
  }
  if (canSeeAllTrucks(role)) return null;

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
    return NextResponse.json(
      { error: "Service unavailable", message: "Could not verify truck access" },
      { status: 503 },
    );
  }

  return null;
}
