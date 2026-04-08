import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

/**
 * Fetches display name and role from Clerk for the given user ID.
 * Falls back to safe defaults if Clerk is unreachable.
 */
async function getUserInfo(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const name = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator";
    return { name, role };
  } catch {
    return { name: "Unknown", role: "operator" };
  }
}

/**
 * GET /api/training
 * Returns training records for the current user, joined with the
 * training_requirements table to include requirement names and details.
 *
 * Managers can view any user's records by passing ?user_id=<clerk_id>.
 *
 * Each record includes a computed `compliance_status`:
 *   - "current"  — completion date + frequency hasn't expired yet
 *   - "expiring" — expires within 30 days
 *   - "expired"  — past the expiry date
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const targetUserId = params.get("user_id");

  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";

  // Only managers can view other users' training records
  const effectiveUserId = targetUserId && isManager ? targetUserId : userId;

  try {
    const sb = getSupabase();

    const { data, error } = await sb
      .from("training_records")
      .select("*, training_requirements(name, description, frequency_months, is_required)")
      .eq("user_id", effectiveUserId)
      .order("completed_date", { ascending: false });

    if (error) throw error;

    const now = new Date();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    // Compute compliance status for each record
    const records = (data ?? []).map((record) => {
      const expiryDate = record.expiry_date
        ? new Date(record.expiry_date as string)
        : null;

      let complianceStatus: "current" | "expiring" | "expired" = "current";

      if (expiryDate) {
        if (expiryDate < now) {
          complianceStatus = "expired";
        } else if (expiryDate.getTime() - now.getTime() < thirtyDaysMs) {
          complianceStatus = "expiring";
        }
      }

      return {
        ...record,
        compliance_status: complianceStatus,
      };
    });

    return NextResponse.json(records);
  } catch (err) {
    console.error("[API-ERROR]", "/api/training GET", err);
    return NextResponse.json(
      { error: "Failed to fetch training records" },
      { status: 502 },
    );
  }
}
