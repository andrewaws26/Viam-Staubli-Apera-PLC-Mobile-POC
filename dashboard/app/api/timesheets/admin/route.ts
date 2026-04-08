import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

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
 * GET /api/timesheets/admin
 * Manager/developer overview — aggregated timesheet stats and pending approvals.
 * Query params: week_ending, status
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
  const weekEnding = params.get("week_ending");
  const status = params.get("status");

  try {
    const sb = getSupabase();

    // Fetch all timesheets with logs for the overview
    let query = sb
      .from("timesheets")
      .select("*, timesheet_daily_logs(*)")
      .order("week_ending", { ascending: false })
      .limit(500);

    if (weekEnding) query = query.eq("week_ending", weekEnding);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;

    const timesheets = (data ?? []).map((ts: Record<string, unknown>) => {
      const logs = (ts.timesheet_daily_logs as Record<string, unknown>[]) ?? [];
      let totalHours = 0;
      let totalTravel = 0;
      for (const log of logs) {
        totalHours += Number(log.hours_worked) || 0;
        totalTravel += Number(log.travel_hours) || 0;
      }
      return {
        ...ts,
        daily_logs: logs.sort(
          (a, b) => (a.sort_order as number) - (b.sort_order as number),
        ),
        timesheet_daily_logs: undefined,
        total_hours: totalHours,
        total_travel_hours: totalTravel,
      } as Record<string, unknown>;
    });

    // Build summary stats
    const byStatus = { draft: 0, submitted: 0, approved: 0, rejected: 0 };
    let totalHoursAll = 0;
    let totalNightsOut = 0;
    const byEmployee: Record<string, { name: string; hours: number; count: number; status: string }> = {};

    for (const ts of timesheets) {
      const s = ts.status as string;
      if (s in byStatus) byStatus[s as keyof typeof byStatus]++;
      const hours = ts.total_hours as number;
      totalHoursAll += hours;
      totalNightsOut += (ts.nights_out as number) || 0;

      const uid = ts.user_id as string;
      if (!byEmployee[uid]) {
        byEmployee[uid] = { name: ts.user_name as string, hours: 0, count: 0, status: s };
      }
      byEmployee[uid].hours += hours;
      byEmployee[uid].count++;
      byEmployee[uid].status = s;
    }

    return NextResponse.json({
      timesheets,
      summary: {
        total: timesheets.length,
        by_status: byStatus,
        total_hours: totalHoursAll,
        total_nights_out: totalNightsOut,
        by_employee: Object.entries(byEmployee).map(([id, info]) => ({
          user_id: id,
          ...info,
        })),
      },
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/timesheets/admin GET", err);
    return NextResponse.json(
      { error: "Failed to fetch admin overview" },
      { status: 502 },
    );
  }
}
