import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

/**
 * Returns the Clerk user's role. Defaults to "operator" if unavailable.
 */
async function getUserRole(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return ((user.publicMetadata as Record<string, unknown>)?.role as string) || "operator";
  } catch {
    return "operator";
  }
}

/**
 * GET /api/pto/admin
 * Manager/developer only. Returns all PTO requests plus summary statistics:
 *   - pending_count: total pending requests awaiting review
 *   - approved_this_month: requests approved in the current calendar month
 *   - by_employee: per-employee breakdown (pending, approved hours, etc.)
 *   - upcoming: approved PTO in the next 30 days (for calendar display)
 *
 * Query params: ?status= (optional filter)
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(userId);
  if (role !== "developer" && role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const status = params.get("status");

  try {
    const sb = getSupabase();

    // Fetch all PTO requests (optionally filtered by status)
    let query = sb
      .from("pto_requests")
      .select("*")
      .order("start_date", { ascending: false })
      .limit(500);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;

    const requests = data ?? [];

    // --- Build summary statistics ---
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .split("T")[0];

    let pendingCount = 0;
    let approvedThisMonth = 0;

    const byEmployee: Record<
      string,
      {
        name: string;
        pending: number;
        approved_hours: number;
        total_requests: number;
      }
    > = {};

    for (const req of requests) {
      const uid = req.user_id as string;

      // Initialize per-employee accumulator
      if (!byEmployee[uid]) {
        byEmployee[uid] = {
          name: req.user_name as string,
          pending: 0,
          approved_hours: 0,
          total_requests: 0,
        };
      }
      byEmployee[uid].total_requests++;

      if (req.status === "pending") {
        pendingCount++;
        byEmployee[uid].pending++;
      }

      if (req.status === "approved") {
        byEmployee[uid].approved_hours += Number(req.hours) || 0;

        // Check if approved within current month
        const reviewedAt = (req.reviewed_at as string) ?? "";
        if (reviewedAt >= currentMonthStart && reviewedAt <= currentMonthEnd + "T23:59:59") {
          approvedThisMonth++;
        }
      }
    }

    // --- Upcoming approved PTO (next 30 days, for calendar view) ---
    const today = now.toISOString().split("T")[0];
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const upcoming = requests.filter(
      (r) =>
        r.status === "approved" &&
        (r.end_date as string) >= today &&
        (r.start_date as string) <= thirtyDaysOut,
    );

    return NextResponse.json({
      requests,
      summary: {
        total: requests.length,
        pending_count: pendingCount,
        approved_this_month: approvedThisMonth,
        by_employee: Object.entries(byEmployee).map(([id, info]) => ({
          user_id: id,
          ...info,
        })),
      },
      upcoming,
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/pto/admin GET", err);
    return NextResponse.json(
      { error: "Failed to fetch PTO admin overview" },
      { status: 502 },
    );
  }
}
