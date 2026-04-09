import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";

async function getUserInfo(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const name = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
    const email = user.emailAddresses?.[0]?.emailAddress ?? "";
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator";
    return { name, email, role };
  } catch {
    return { name: "Unknown", email: "", role: "operator" };
  }
}

function computeTotals(logs: Record<string, unknown>[]) {
  let totalHours = 0;
  let totalTravel = 0;
  for (const log of logs) {
    totalHours += Number(log.hours_worked) || 0;
    totalTravel += Number(log.travel_hours) || 0;
  }
  return { total_hours: totalHours, total_travel_hours: totalTravel };
}

/**
 * GET /api/timesheets
 * Returns the current user's timesheets. Manager/developer see all if ?all=true.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const showAll = params.get("all") === "true";
  const status = params.get("status");

  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";

  try {
    const sb = getSupabase();
    // Join ALL sub-section tables so the response includes the full timesheet
    // with every section embedded (migration_007 added 10 new sub-section tables).
    let query = sb
      .from("timesheets")
      .select(
        "*, timesheet_daily_logs(*), timesheet_railroad_timecards(*), " +
        "timesheet_inspections(*), timesheet_ifta_entries(*), timesheet_expenses(*), " +
        "timesheet_maintenance_time(*), timesheet_shop_time(*), timesheet_mileage_pay(*), " +
        "timesheet_flight_pay(*), timesheet_holiday_pay(*), timesheet_vacation_pay(*)"
      )
      .order("week_ending", { ascending: false })
      .limit(100);

    // Only managers can see all timesheets
    if (!showAll || !isManager) {
      query = query.eq("user_id", userId);
    }

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;

    // Cast rows to Record — Supabase can't infer joined sub-section table types
    // from the expanded select string, so the SDK returns a generic error type.
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const result = rows.map((ts) => {
      const logs = (ts.timesheet_daily_logs as Record<string, unknown>[]) ?? [];
      const totals = computeTotals(logs);
      return {
        ...ts,
        // Rename daily_logs from Supabase join key to TS-friendly name
        daily_logs: logs.sort(
          (a, b) => (a.sort_order as number) - (b.sort_order as number),
        ),
        timesheet_daily_logs: undefined,
        // Rename all sub-section join keys to match TypeScript interface names
        railroad_timecards: ts.timesheet_railroad_timecards ?? [],
        timesheet_railroad_timecards: undefined,
        inspections: ts.timesheet_inspections ?? [],
        timesheet_inspections: undefined,
        ifta_entries: ts.timesheet_ifta_entries ?? [],
        timesheet_ifta_entries: undefined,
        expenses: ts.timesheet_expenses ?? [],
        timesheet_expenses: undefined,
        maintenance_time: ts.timesheet_maintenance_time ?? [],
        timesheet_maintenance_time: undefined,
        shop_time: ts.timesheet_shop_time ?? [],
        timesheet_shop_time: undefined,
        mileage_pay: ts.timesheet_mileage_pay ?? [],
        timesheet_mileage_pay: undefined,
        flight_pay: ts.timesheet_flight_pay ?? [],
        timesheet_flight_pay: undefined,
        holiday_pay: ts.timesheet_holiday_pay ?? [],
        timesheet_holiday_pay: undefined,
        vacation_pay: ts.timesheet_vacation_pay ?? [],
        timesheet_vacation_pay: undefined,
        ...totals,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[API-ERROR]", "/api/timesheets GET", err);
    return NextResponse.json(
      { error: "Failed to fetch timesheets" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/timesheets
 * Create a new timesheet for the current user.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Destructure all timesheet-level fields including new migration_007 columns:
  // norfolk_southern_job_code, ifta_odometer_start, ifta_odometer_end
  const {
    week_ending, railroad_working_on, norfolk_southern_job_code, job_id,
    chase_vehicles, semi_trucks, work_location, nights_out, layovers,
    coworkers, ifta_odometer_start, ifta_odometer_end, notes, daily_logs,
  } = body as Record<string, unknown>;

  if (!week_ending) {
    return NextResponse.json({ error: "Missing week_ending" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // Check for duplicate
    const { data: existing } = await sb
      .from("timesheets")
      .select("id")
      .eq("user_id", userId)
      .eq("week_ending", week_ending as string)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "Timesheet already exists for this week", existing_id: existing.id },
        { status: 409 },
      );
    }

    const { data, error } = await sb
      .from("timesheets")
      .insert({
        user_id: userId,
        user_name: userInfo.name,
        user_email: userInfo.email,
        week_ending,
        railroad_working_on: railroad_working_on || null,
        // New migration_007 field: NS job code for Norfolk Southern work
        norfolk_southern_job_code: norfolk_southern_job_code || null,
        job_id: job_id || null,
        chase_vehicles: chase_vehicles || [],
        semi_trucks: semi_trucks || [],
        work_location: work_location || null,
        nights_out: nights_out ?? 0,
        layovers: layovers ?? 0,
        coworkers: coworkers || [],
        // New migration_007 fields: IFTA odometer readings for the week
        ifta_odometer_start: ifta_odometer_start ?? null,
        ifta_odometer_end: ifta_odometer_end ?? null,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) throw error;

    // Create daily logs if provided — includes new migration_007 per-day fields:
    // lunch_minutes, semi_truck_travel, traveling_from, destination, travel_miles
    if (Array.isArray(daily_logs) && daily_logs.length > 0) {
      const logRows = (daily_logs as Record<string, unknown>[]).map((log, i) => ({
        timesheet_id: data.id,
        log_date: log.log_date,
        start_time: log.start_time || null,
        end_time: log.end_time || null,
        hours_worked: log.hours_worked ?? 0,
        travel_hours: log.travel_hours ?? 0,
        lunch_minutes: log.lunch_minutes ?? 0,
        description: log.description || null,
        semi_truck_travel: log.semi_truck_travel ?? false,
        traveling_from: log.traveling_from || null,
        destination: log.destination || null,
        travel_miles: log.travel_miles ?? null,
        sort_order: i,
      }));
      await sb.from("timesheet_daily_logs").insert(logRows);
    }

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "timesheet_created",
      details: {
        timesheet_id: data.id,
        week_ending: week_ending as string,
      },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/timesheets POST", err);
    return NextResponse.json(
      { error: "Failed to create timesheet" },
      { status: 502 },
    );
  }
}
