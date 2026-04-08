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

interface PayrollRow {
  employee_name: string;
  employee_id: string;
  week_ending: string;
  regular_hours: number;
  travel_hours: number;
  total_hours: number;
  per_diem_amount: number;
  mileage_miles: number;
  reimbursable_expenses: number;
  maintenance_hours: number;
  shop_hours: number;
  railroad: string;
  nights_out: number;
  layovers: number;
}

/**
 * GET /api/payroll/export
 *
 * Exports approved timesheet data for payroll processing.
 * Manager/developer only.
 *
 * Query params:
 *   from   (required) — start date YYYY-MM-DD
 *   to     (required) — end date YYYY-MM-DD
 *   format (optional) — "csv" or "json" (default "json")
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
  const from = params.get("from");
  const to = params.get("to");
  const format = params.get("format") || "json";

  if (!from || !to) {
    return NextResponse.json(
      { error: "Missing required query params: from, to (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  // Basic date validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { error: "Invalid date format. Use YYYY-MM-DD." },
      { status: 400 },
    );
  }

  if (new Date(to) < new Date(from)) {
    return NextResponse.json(
      { error: "'to' date cannot be before 'from' date" },
      { status: 400 },
    );
  }

  if (format !== "json" && format !== "csv") {
    return NextResponse.json(
      { error: "format must be 'json' or 'csv'" },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabase();

    // Single query: fetch approved timesheets with all payroll-relevant sub-sections joined.
    const { data, error } = await sb
      .from("timesheets")
      .select(
        "id, user_id, user_name, week_ending, railroad_working_on, nights_out, layovers, " +
        "timesheet_daily_logs(hours_worked, travel_hours), " +
        "timesheet_expenses(amount, needs_reimbursement), " +
        "timesheet_mileage_pay(miles), " +
        "timesheet_maintenance_time(hours_worked), " +
        "timesheet_shop_time(hours_worked)"
      )
      .eq("status", "approved")
      .gte("week_ending", from)
      .lte("week_ending", to)
      .order("week_ending", { ascending: true })
      .limit(2000);

    if (error) throw error;

    const rows = (data ?? []) as unknown as Record<string, unknown>[];

    // Fetch per diem entries for the same date range — these are separate from timesheets,
    // linked by timesheet_id or user+date. We query by date range matching the timesheet period.
    const { data: perDiemData, error: perDiemError } = await sb
      .from("per_diem_entries")
      .select("user_id, timesheet_id, amount")
      .gte("entry_date", from)
      .lte("entry_date", to)
      .limit(5000);

    if (perDiemError) throw perDiemError;

    // Index per diem totals by timesheet_id for fast lookup
    const perDiemByTimesheet: Record<string, number> = {};
    for (const entry of (perDiemData ?? [])) {
      const tsId = entry.timesheet_id as string;
      if (tsId) {
        perDiemByTimesheet[tsId] = (perDiemByTimesheet[tsId] || 0) + (Number(entry.amount) || 0);
      }
    }

    // Build payroll rows — one per timesheet (per employee per week)
    const payrollRows: PayrollRow[] = [];

    for (const ts of rows) {
      const logs = (ts.timesheet_daily_logs as Record<string, unknown>[]) ?? [];
      const expenses = (ts.timesheet_expenses as Record<string, unknown>[]) ?? [];
      const mileage = (ts.timesheet_mileage_pay as Record<string, unknown>[]) ?? [];
      const maintenance = (ts.timesheet_maintenance_time as Record<string, unknown>[]) ?? [];
      const shopTime = (ts.timesheet_shop_time as Record<string, unknown>[]) ?? [];

      let regularHours = 0;
      let travelHours = 0;
      for (const log of logs) {
        regularHours += Number(log.hours_worked) || 0;
        travelHours += Number(log.travel_hours) || 0;
      }

      let reimbursableExpenses = 0;
      for (const exp of expenses) {
        if (exp.needs_reimbursement) {
          reimbursableExpenses += Number(exp.amount) || 0;
        }
      }

      let mileageMiles = 0;
      for (const m of mileage) {
        mileageMiles += Number(m.miles) || 0;
      }

      let maintenanceHours = 0;
      for (const m of maintenance) {
        maintenanceHours += Number(m.hours_worked) || 0;
      }

      let shopHours = 0;
      for (const s of shopTime) {
        shopHours += Number(s.hours_worked) || 0;
      }

      const perDiemAmount = perDiemByTimesheet[ts.id as string] || 0;

      payrollRows.push({
        employee_name: (ts.user_name as string) || "Unknown",
        employee_id: (ts.user_id as string) || "",
        week_ending: (ts.week_ending as string) || "",
        regular_hours: round2(regularHours),
        travel_hours: round2(travelHours),
        total_hours: round2(regularHours + travelHours),
        per_diem_amount: round2(perDiemAmount),
        mileage_miles: round2(mileageMiles),
        reimbursable_expenses: round2(reimbursableExpenses),
        maintenance_hours: round2(maintenanceHours),
        shop_hours: round2(shopHours),
        railroad: (ts.railroad_working_on as string) || "",
        nights_out: Number(ts.nights_out) || 0,
        layovers: Number(ts.layovers) || 0,
      });
    }

    // Build summary
    let totalHours = 0;
    let totalPerDiem = 0;
    let totalExpenses = 0;
    const employeeIds = new Set<string>();

    for (const row of payrollRows) {
      totalHours += row.total_hours;
      totalPerDiem += row.per_diem_amount;
      totalExpenses += row.reimbursable_expenses;
      employeeIds.add(row.employee_id);
    }

    const summary = {
      total_hours: round2(totalHours),
      total_per_diem: round2(totalPerDiem),
      total_expenses: round2(totalExpenses),
      employee_count: employeeIds.size,
    };

    // --- CSV response ---
    if (format === "csv") {
      const csvHeaders = [
        "employee_name",
        "employee_id",
        "week_ending",
        "regular_hours",
        "travel_hours",
        "total_hours",
        "per_diem_amount",
        "mileage_miles",
        "reimbursable_expenses",
        "maintenance_hours",
        "shop_hours",
        "railroad",
        "nights_out",
        "layovers",
      ];

      const csvLines = [csvHeaders.join(",")];
      for (const row of payrollRows) {
        csvLines.push(
          csvHeaders
            .map((h) => {
              const val = row[h as keyof PayrollRow];
              // Quote strings that may contain commas
              if (typeof val === "string") return `"${val.replace(/"/g, '""')}"`;
              return String(val);
            })
            .join(","),
        );
      }

      const csvBody = csvLines.join("\n");
      const filename = `payroll_export_${from}_to_${to}.csv`;

      return new NextResponse(csvBody, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // --- JSON response ---
    return NextResponse.json({
      export_date: new Date().toISOString().split("T")[0],
      period: { from, to },
      employees: payrollRows,
      summary,
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/payroll/export GET", err);
    return NextResponse.json(
      { error: "Failed to generate payroll export" },
      { status: 502 },
    );
  }
}

/** Round to 2 decimal places to avoid floating-point dust in output. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
