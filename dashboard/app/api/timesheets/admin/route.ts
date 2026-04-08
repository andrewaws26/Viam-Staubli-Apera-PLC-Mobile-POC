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

    // Fetch all timesheets with logs + expenses + mileage for the admin overview.
    // Expenses and mileage_pay are joined so we can compute financial totals
    // without extra round-trips (migration_007 sub-section tables).
    let query = sb
      .from("timesheets")
      .select("*, timesheet_daily_logs(*), timesheet_expenses(*), timesheet_mileage_pay(*)")
      .order("week_ending", { ascending: false })
      .limit(500);

    if (weekEnding) query = query.eq("week_ending", weekEnding);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;

    // Cast rows — Supabase can't infer joined sub-section types from the select string
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const timesheets = rows.map((ts) => {
      const logs = (ts.timesheet_daily_logs as Record<string, unknown>[]) ?? [];
      const expenses = (ts.timesheet_expenses as Record<string, unknown>[]) ?? [];
      const mileage = (ts.timesheet_mileage_pay as Record<string, unknown>[]) ?? [];

      let totalHours = 0;
      let totalTravel = 0;
      for (const log of logs) {
        totalHours += Number(log.hours_worked) || 0;
        totalTravel += Number(log.travel_hours) || 0;
      }

      // Sum expense amounts for financial overview (migration_007)
      let totalExpenses = 0;
      for (const exp of expenses) {
        totalExpenses += Number(exp.amount) || 0;
      }

      // Sum mileage pay miles for the summary (migration_007)
      let totalMileage = 0;
      for (const m of mileage) {
        totalMileage += Number(m.miles) || 0;
      }

      return {
        ...ts,
        daily_logs: logs.sort(
          (a, b) => (a.sort_order as number) - (b.sort_order as number),
        ),
        timesheet_daily_logs: undefined,
        // Rename joined sub-section keys for consistency
        expenses,
        timesheet_expenses: undefined,
        mileage_pay: mileage,
        timesheet_mileage_pay: undefined,
        total_hours: totalHours,
        total_travel_hours: totalTravel,
        total_expenses: totalExpenses,
        total_mileage: totalMileage,
      } as Record<string, unknown>;
    });

    // Build summary stats — includes total_expenses and total_mileage from migration_007
    const byStatus = { draft: 0, submitted: 0, approved: 0, rejected: 0 };
    let totalHoursAll = 0;
    let totalNightsOut = 0;
    let totalExpensesAll = 0;
    let totalMileageAll = 0;
    const byEmployee: Record<string, {
      name: string; hours: number; count: number; status: string;
      expenses: number; mileage: number;
    }> = {};

    for (const ts of timesheets) {
      const s = ts.status as string;
      if (s in byStatus) byStatus[s as keyof typeof byStatus]++;
      const hours = ts.total_hours as number;
      const expenses = ts.total_expenses as number;
      const mileage = ts.total_mileage as number;
      totalHoursAll += hours;
      totalNightsOut += (ts.nights_out as number) || 0;
      totalExpensesAll += expenses;
      totalMileageAll += mileage;

      const uid = ts.user_id as string;
      if (!byEmployee[uid]) {
        byEmployee[uid] = {
          name: ts.user_name as string,
          hours: 0, count: 0, status: s,
          expenses: 0, mileage: 0,
        };
      }
      byEmployee[uid].hours += hours;
      byEmployee[uid].expenses += expenses;
      byEmployee[uid].mileage += mileage;
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
        // Financial totals from migration_007 sub-sections
        total_expenses: totalExpensesAll,
        total_mileage: totalMileageAll,
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
