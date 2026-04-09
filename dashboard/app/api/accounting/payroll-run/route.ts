import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";
import {
  r2,
  periodsPerYear,
  getTaxValue,
  calcFederalWithholding,
  calcSocialSecurity,
  calcMedicare,
  calcFuta,
  calcSuta,
  type TaxRateRow,
  type TaxProfileRow,
} from "@/lib/payroll-tax";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function isManager(role: string): boolean {
  return role === "developer" || role === "manager";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PayrollLine {
  user_id: string;
  employee_name: string;
  regular_hours: number;
  overtime_hours: number;
  holiday_hours: number;
  vacation_hours: number;
  hourly_rate: number;
  regular_pay: number;
  overtime_pay: number;
  holiday_pay: number;
  vacation_pay: number;
  per_diem: number;
  mileage_pay: number;
  other_pay: number;
  gross_pay: number;
  federal_wh: number;
  state_wh: number;
  ss_employee: number;
  medicare_employee: number;
  benefits_deduction: number;
  other_deductions: number;
  total_deductions: number;
  net_pay: number;
  ss_employer: number;
  medicare_employer: number;
  futa: number;
  suta: number;
  total_employer_tax: number;
  timesheet_id: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Preview / Tax Calculation Engine
// ---------------------------------------------------------------------------

async function buildPreview(
  periodStart: string,
  periodEnd: string,
): Promise<PayrollLine[]> {
  const sb = getSupabase();

  // 1. Fetch approved timesheets in the period
  const { data: timesheets, error: tsErr } = await sb
    .from("timesheets")
    .select(
      "id, user_id, user_name, week_ending, nights_out, layovers, " +
        "timesheet_daily_logs(hours_worked, travel_hours), " +
        "timesheet_mileage_pay(miles), " +
        "timesheet_holiday_pay(holiday_date), " +
        "timesheet_vacation_pay(total_hours)",
    )
    .eq("status", "approved")
    .gte("week_ending", periodStart)
    .lte("week_ending", periodEnd)
    .order("user_name", { ascending: true })
    .limit(2000);

  if (tsErr) throw tsErr;
  if (!timesheets || timesheets.length === 0) return [];

  // Cast to generic rows — Supabase's joined select return type is opaque
  const tsRows = timesheets as unknown as Record<string, unknown>[];

  // Gather unique user IDs
  const userIdSet = new Set<string>();
  for (const t of tsRows) userIdSet.add(t.user_id as string);
  const userIds = Array.from(userIdSet);

  // 2. Fetch per diem entries for the period
  const { data: perDiemData } = await sb
    .from("per_diem_entries")
    .select("user_id, timesheet_id, amount")
    .gte("entry_date", periodStart)
    .lte("entry_date", periodEnd)
    .limit(5000);

  // Index per diem by timesheet_id
  const perDiemByTs: Record<string, number> = {};
  for (const e of perDiemData ?? []) {
    const tsId = e.timesheet_id as string;
    if (tsId) perDiemByTs[tsId] = (perDiemByTs[tsId] || 0) + Number(e.amount || 0);
  }

  // 3. Fetch employee tax profiles
  const { data: profiles } = await sb
    .from("employee_tax_profiles")
    .select("*")
    .in("user_id", userIds);

  const profileByUser: Record<string, TaxProfileRow> = {};
  for (const p of (profiles ?? []) as unknown as TaxProfileRow[]) {
    profileByUser[p.user_id] = p;
  }

  // 4. Fetch 2026 tax rate tables
  const { data: taxRatesRaw } = await sb
    .from("tax_rate_tables")
    .select("*")
    .eq("tax_year", 2026);

  const taxRates = (taxRatesRaw ?? []) as unknown as TaxRateRow[];

  // Extract specific rates
  const ssRate = getTaxValue(taxRates, "ss_rate");
  const ssWageBase = getTaxValue(taxRates, "ss_wage_base", "flat_amount");
  const medicareRate = getTaxValue(taxRates, "medicare_rate");
  const additionalMedicareRate = getTaxValue(taxRates, "medicare_additional_rate");
  const additionalMedicareThreshold = getTaxValue(
    taxRates,
    "medicare_additional_threshold",
    "flat_amount",
  );
  const futaRate = getTaxValue(taxRates, "futa_rate");
  const futaWageBase = getTaxValue(taxRates, "futa_wage_base", "flat_amount");
  const futaCredit = getTaxValue(taxRates, "futa_credit");
  const sutaRate = getTaxValue(taxRates, "suta_rate");
  const sutaWageBase = getTaxValue(taxRates, "suta_wage_base", "flat_amount");

  const federalBrackets = taxRates.filter((r) => r.tax_type === "federal_bracket");
  const stdDeductions = taxRates.filter((r) => r.tax_type === "standard_deduction");

  // 5. Fetch employee benefits (pre-tax deductions)
  const { data: benefitsData } = await sb
    .from("employee_benefits")
    .select("user_id, employee_amount, benefit_plan_id, benefit_plans(is_pretax)")
    .in("user_id", userIds)
    .is("termination_date", null);

  // Sum pre-tax benefit deductions per user
  const benefitsByUser: Record<string, number> = {};
  for (const b of (benefitsData ?? []) as unknown as Record<string, unknown>[]) {
    const bUserId = b.user_id as string;
    const plan = b.benefit_plans as Record<string, unknown> | null;
    if (plan?.is_pretax) {
      benefitsByUser[bUserId] =
        (benefitsByUser[bUserId] || 0) + Number(b.employee_amount || 0);
    }
  }

  // 6. Fetch IRS mileage rate (use 2026 rate: $0.70/mile — or from per_diem_rates)
  const { data: mileageRateData } = await sb
    .from("per_diem_rates")
    .select("rate_cents")
    .eq("rate_type", "mileage")
    .eq("is_active", true)
    .limit(1);

  const mileageRateDollars =
    mileageRateData && mileageRateData.length > 0
      ? Number(mileageRateData[0].rate_cents) / 100
      : 0.7; // fallback $0.70/mile

  // 7. Build one payroll line per employee (aggregate timesheets)
  // Group timesheets by user
  const tsByUser: Record<string, Record<string, unknown>[]> = {};
  for (const ts of tsRows) {
    const uid = ts.user_id as string;
    if (!tsByUser[uid]) tsByUser[uid] = [];
    tsByUser[uid].push(ts);
  }

  const lines: PayrollLine[] = [];

  for (const uid of userIds) {
    const userTimesheets = tsByUser[uid] ?? [];
    if (userTimesheets.length === 0) continue;

    const employeeName = (userTimesheets[0].user_name as string) || "Unknown";

    // Default tax profile if none exists
    const profile: TaxProfileRow = profileByUser[uid] ?? {
      user_id: uid,
      filing_status: "single",
      dependents_credit: 0,
      other_income: 0,
      deductions: 0,
      extra_withholding: 0,
      state_withholding: 0.04,
      state_extra_wh: 0,
      pay_frequency: "weekly",
      hourly_rate: 7.25, // federal minimum wage fallback
      salary_annual: null,
      pay_type: "hourly",
      ytd_gross_pay: 0,
      ytd_federal_wh: 0,
      ytd_state_wh: 0,
      ytd_ss_employee: 0,
      ytd_medicare_employee: 0,
      ytd_ss_employer: 0,
      ytd_medicare_employer: 0,
      ytd_futa: 0,
      ytd_suta: 0,
    };

    const rate = Number(profile.hourly_rate) || 7.25;

    // Aggregate hours from all timesheets in this period
    let totalRegular = 0;
    let totalTravel = 0;
    let totalMiles = 0;
    let totalPerDiem = 0;
    let totalHolidayHours = 0;
    let totalVacationHours = 0;
    let firstTimesheetId: string | null = null;

    for (const ts of userTimesheets) {
      if (!firstTimesheetId) firstTimesheetId = ts.id as string;

      // Daily logs -> regular + travel hours
      const logs = (ts.timesheet_daily_logs as Record<string, unknown>[]) ?? [];
      for (const log of logs) {
        totalRegular += Number(log.hours_worked) || 0;
        totalTravel += Number(log.travel_hours) || 0;
      }

      // Mileage
      const mileage = (ts.timesheet_mileage_pay as Record<string, unknown>[]) ?? [];
      for (const m of mileage) {
        totalMiles += Number(m.miles) || 0;
      }

      // Per diem
      totalPerDiem += perDiemByTs[ts.id as string] || 0;

      // Holiday hours (count of holiday dates * 8 hours assumed)
      const holidays = (ts.timesheet_holiday_pay as Record<string, unknown>[]) ?? [];
      totalHolidayHours += holidays.length * 8;

      // Vacation hours
      const vacations = (ts.timesheet_vacation_pay as Record<string, unknown>[]) ?? [];
      for (const v of vacations) {
        totalVacationHours += Number(v.total_hours) || 0;
      }
    }

    // Split total hours into regular + overtime (40hr threshold per week)
    // For a period spanning multiple weeks, use 40 * number of weeks as threshold
    const totalHours = totalRegular + totalTravel;
    const weekCount = userTimesheets.length; // one timesheet per week
    const regularCap = 40 * weekCount;
    const regularHours = r2(Math.min(totalHours, regularCap));
    const overtimeHours = r2(Math.max(0, totalHours - regularCap));

    // Calculate pay components
    const regularPay = r2(regularHours * rate);
    const overtimePay = r2(overtimeHours * rate * 1.5);
    const holidayPay = r2(totalHolidayHours * rate);
    const vacationPay = r2(totalVacationHours * rate);
    const perDiem = r2(totalPerDiem);
    const mileagePay = r2(totalMiles * mileageRateDollars);

    const grossPay = r2(
      regularPay + overtimePay + holidayPay + vacationPay + perDiem + mileagePay,
    );

    // Tax calculations
    const ytdGross = Number(profile.ytd_gross_pay) || 0;

    // Federal withholding
    const federalWh = calcFederalWithholding(
      grossPay,
      profile,
      federalBrackets,
      stdDeductions,
    );

    // State withholding (KY flat rate)
    const stateWh = r2(
      grossPay * Number(profile.state_withholding) +
        Number(profile.state_extra_wh),
    );

    // Social Security (employee)
    const ssEmployee = calcSocialSecurity(grossPay, ytdGross, ssRate, ssWageBase);

    // Medicare (employee)
    const medicareEmployee = calcMedicare(
      grossPay,
      ytdGross,
      medicareRate,
      additionalMedicareRate,
      additionalMedicareThreshold,
    );

    // Employer Social Security
    const ssEmployer = calcSocialSecurity(grossPay, ytdGross, ssRate, ssWageBase);

    // Employer Medicare (no additional Medicare tax for employer)
    const medicareEmployer = r2(grossPay * medicareRate);

    // FUTA
    const futa = calcFuta(grossPay, ytdGross, futaRate, futaCredit, futaWageBase);

    // SUTA
    const suta = calcSuta(grossPay, ytdGross, sutaRate, sutaWageBase);

    // Benefits (pre-tax deduction)
    const benefitsDeduction = r2(benefitsByUser[uid] || 0);

    // Total deductions
    const totalDeductions = r2(
      federalWh + stateWh + ssEmployee + medicareEmployee + benefitsDeduction,
    );

    // Net pay
    const netPay = r2(grossPay - totalDeductions);

    // Employer tax total
    const totalEmployerTax = r2(ssEmployer + medicareEmployer + futa + suta);

    lines.push({
      user_id: uid,
      employee_name: employeeName,
      regular_hours: r2(regularHours),
      overtime_hours: r2(overtimeHours),
      holiday_hours: r2(totalHolidayHours),
      vacation_hours: r2(totalVacationHours),
      hourly_rate: r2(rate),
      regular_pay: regularPay,
      overtime_pay: overtimePay,
      holiday_pay: holidayPay,
      vacation_pay: vacationPay,
      per_diem: perDiem,
      mileage_pay: mileagePay,
      other_pay: 0,
      gross_pay: grossPay,
      federal_wh: federalWh,
      state_wh: stateWh,
      ss_employee: ssEmployee,
      medicare_employee: medicareEmployee,
      benefits_deduction: benefitsDeduction,
      other_deductions: 0,
      total_deductions: totalDeductions,
      net_pay: netPay,
      ss_employer: ssEmployer,
      medicare_employer: medicareEmployer,
      futa,
      suta,
      total_employer_tax: totalEmployerTax,
      timesheet_id: firstTimesheetId,
      notes: null,
    });
  }

  return lines;
}

// ---------------------------------------------------------------------------
// GET /api/accounting/payroll-run
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (!isManager(userInfo.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const id = params.get("id");
  const preview = params.get("preview");

  try {
    const sb = getSupabase();

    // ── Preview mode: calculate taxes without saving ──
    if (preview === "true") {
      const periodStart = params.get("period_start");
      const periodEnd = params.get("period_end");

      if (!periodStart || !periodEnd) {
        return NextResponse.json(
          { error: "Preview requires period_start and period_end (YYYY-MM-DD)" },
          { status: 400 },
        );
      }

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
      ) {
        return NextResponse.json(
          { error: "Invalid date format. Use YYYY-MM-DD." },
          { status: 400 },
        );
      }

      const lines = await buildPreview(periodStart, periodEnd);

      // Compute summary
      let totalGross = 0;
      let totalNet = 0;
      let totalEmployerTax = 0;
      let totalDeductions = 0;
      for (const l of lines) {
        totalGross += l.gross_pay;
        totalNet += l.net_pay;
        totalEmployerTax += l.total_employer_tax;
        totalDeductions += l.total_deductions;
      }

      return NextResponse.json({
        period_start: periodStart,
        period_end: periodEnd,
        employee_count: lines.length,
        total_gross: r2(totalGross),
        total_net: r2(totalNet),
        total_employer_tax: r2(totalEmployerTax),
        total_deductions: r2(totalDeductions),
        lines,
      });
    }

    // ── Single payroll run by ID ──
    if (id) {
      const { data, error } = await sb
        .from("payroll_runs")
        .select("*, payroll_run_lines(*)")
        .eq("id", id)
        .single();

      if (error) {
        if (error.code === "PGRST116")
          return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
        throw error;
      }

      return NextResponse.json(data);
    }

    // ── List all payroll runs ──
    const { data, error } = await sb
      .from("payroll_runs")
      .select("*, payroll_run_lines(count)")
      .order("pay_date", { ascending: false })
      .limit(200);

    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/payroll-run GET", err);
    return NextResponse.json(
      { error: "Failed to fetch payroll run data" },
      { status: 502 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/accounting/payroll-run
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Idempotency guard — prevent duplicate payroll runs from double-clicks
  const idemKey = request.headers.get("x-idempotency-key");
  if (idemKey) {
    const { checkIdempotency } = await import("@/lib/idempotency");
    const cached = checkIdempotency(idemKey);
    if (cached) return NextResponse.json(cached.body, { status: cached.status });
  }

  const userInfo = await getUserInfo(userId);
  if (!isManager(userInfo.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { pay_period_start, pay_period_end, pay_date, lines } = body;

  if (!pay_period_start || !pay_period_end || !pay_date) {
    return NextResponse.json(
      { error: "Missing required fields: pay_period_start, pay_period_end, pay_date" },
      { status: 400 },
    );
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json(
      { error: "lines array is required and must not be empty" },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabase();

    // Compute totals from lines
    let totalGross = 0;
    let totalNet = 0;
    let totalEmployerTax = 0;
    let totalDeductions = 0;

    for (const line of lines as PayrollLine[]) {
      totalGross += Number(line.gross_pay) || 0;
      totalNet += Number(line.net_pay) || 0;
      totalEmployerTax += Number(line.total_employer_tax) || 0;
      totalDeductions += Number(line.total_deductions) || 0;
    }

    // Insert payroll run header
    const { data: run, error: runErr } = await sb
      .from("payroll_runs")
      .insert({
        pay_period_start: pay_period_start as string,
        pay_period_end: pay_period_end as string,
        pay_date: pay_date as string,
        status: "draft",
        total_gross: r2(totalGross),
        total_net: r2(totalNet),
        total_employer_tax: r2(totalEmployerTax),
        total_deductions: r2(totalDeductions),
        employee_count: (lines as PayrollLine[]).length,
        created_by: userId,
        created_by_name: userInfo.name,
      })
      .select()
      .single();

    if (runErr) throw runErr;

    // Insert all payroll run lines
    const lineInserts = (lines as PayrollLine[]).map((line) => ({
      payroll_run_id: run.id,
      user_id: line.user_id,
      employee_name: line.employee_name,
      regular_hours: r2(Number(line.regular_hours) || 0),
      overtime_hours: r2(Number(line.overtime_hours) || 0),
      holiday_hours: r2(Number(line.holiday_hours) || 0),
      vacation_hours: r2(Number(line.vacation_hours) || 0),
      hourly_rate: r2(Number(line.hourly_rate) || 0),
      regular_pay: r2(Number(line.regular_pay) || 0),
      overtime_pay: r2(Number(line.overtime_pay) || 0),
      holiday_pay: r2(Number(line.holiday_pay) || 0),
      vacation_pay: r2(Number(line.vacation_pay) || 0),
      per_diem: r2(Number(line.per_diem) || 0),
      mileage_pay: r2(Number(line.mileage_pay) || 0),
      other_pay: r2(Number(line.other_pay) || 0),
      gross_pay: r2(Number(line.gross_pay) || 0),
      federal_wh: r2(Number(line.federal_wh) || 0),
      state_wh: r2(Number(line.state_wh) || 0),
      ss_employee: r2(Number(line.ss_employee) || 0),
      medicare_employee: r2(Number(line.medicare_employee) || 0),
      benefits_deduction: r2(Number(line.benefits_deduction) || 0),
      other_deductions: r2(Number(line.other_deductions) || 0),
      total_deductions: r2(Number(line.total_deductions) || 0),
      net_pay: r2(Number(line.net_pay) || 0),
      ss_employer: r2(Number(line.ss_employer) || 0),
      medicare_employer: r2(Number(line.medicare_employer) || 0),
      futa: r2(Number(line.futa) || 0),
      suta: r2(Number(line.suta) || 0),
      total_employer_tax: r2(Number(line.total_employer_tax) || 0),
      timesheet_id: line.timesheet_id || null,
      notes: line.notes || null,
    }));

    const { data: insertedLines, error: linesErr } = await sb
      .from("payroll_run_lines")
      .insert(lineInserts)
      .select();

    if (linesErr) throw linesErr;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "journal_entry_created" as const,
      details: {
        type: "payroll_run_created",
        payroll_run_id: run.id,
        pay_date: run.pay_date,
        employee_count: run.employee_count,
        total_gross: r2(totalGross),
        total_net: r2(totalNet),
      },
    });

    return NextResponse.json(
      { ...run, lines: insertedLines },
      { status: 201 },
    );
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/payroll-run POST", err);
    return NextResponse.json(
      { error: "Failed to create payroll run" },
      { status: 502 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/accounting/payroll-run
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (!isManager(userInfo.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, action } = body as { id?: string; action?: string };

  if (!id || !action) {
    return NextResponse.json(
      { error: "Missing required fields: id, action" },
      { status: 400 },
    );
  }

  if (!["approve", "post", "void"].includes(action)) {
    return NextResponse.json(
      { error: "action must be one of: approve, post, void" },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabase();

    // Fetch the payroll run
    const { data: run, error: runErr } = await sb
      .from("payroll_runs")
      .select("*, payroll_run_lines(*)")
      .eq("id", id)
      .single();

    if (runErr) {
      if (runErr.code === "PGRST116")
        return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
      throw runErr;
    }

    // ── APPROVE ──
    if (action === "approve") {
      if (run.status !== "draft") {
        return NextResponse.json(
          { error: `Cannot approve a payroll run with status "${run.status}". Must be "draft".` },
          { status: 400 },
        );
      }

      const { data: updated, error: updateErr } = await sb
        .from("payroll_runs")
        .update({
          status: "approved",
          approved_by: userId,
          approved_by_name: userInfo.name,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      return NextResponse.json(updated);
    }

    // ── POST ──
    if (action === "post") {
      if (run.status !== "approved") {
        return NextResponse.json(
          { error: `Cannot post a payroll run with status "${run.status}". Must be "approved".` },
          { status: 400 },
        );
      }

      const runLines = (run.payroll_run_lines ?? []) as Record<string, unknown>[];

      // Calculate totals from lines
      let totalGross = 0;
      let totalNetPay = 0;
      let totalFederalWh = 0;
      let totalStateWh = 0;
      let totalSsEmployee = 0;
      let totalMedicareEmployee = 0;
      let totalSsEmployer = 0;
      let totalMedicareEmployer = 0;
      let totalFuta = 0;
      let totalSuta = 0;

      for (const line of runLines) {
        totalGross += Number(line.gross_pay) || 0;
        totalNetPay += Number(line.net_pay) || 0;
        totalFederalWh += Number(line.federal_wh) || 0;
        totalStateWh += Number(line.state_wh) || 0;
        totalSsEmployee += Number(line.ss_employee) || 0;
        totalMedicareEmployee += Number(line.medicare_employee) || 0;
        totalSsEmployer += Number(line.ss_employer) || 0;
        totalMedicareEmployer += Number(line.medicare_employer) || 0;
        totalFuta += Number(line.futa) || 0;
        totalSuta += Number(line.suta) || 0;
      }

      totalGross = r2(totalGross);
      totalNetPay = r2(totalNetPay);
      totalFederalWh = r2(totalFederalWh);
      totalStateWh = r2(totalStateWh);
      totalSsEmployee = r2(totalSsEmployee);
      totalMedicareEmployee = r2(totalMedicareEmployee);
      totalSsEmployer = r2(totalSsEmployer);
      totalMedicareEmployer = r2(totalMedicareEmployer);
      totalFuta = r2(totalFuta);
      totalSuta = r2(totalSuta);

      const totalEmployerFica = r2(totalSsEmployer + totalMedicareEmployer);
      const totalEmployeeFica = r2(totalSsEmployee + totalMedicareEmployee);
      const totalEmployerTax = r2(totalEmployerFica + totalFuta + totalSuta);

      // Look up chart_of_accounts by account_number
      const accountNumbers = [
        "1000",
        "5000",
        "5010",
        "2100",
        "2200",
        "2210",
        "2220",
        "2230",
        "2240",
      ];
      const { data: accounts } = await sb
        .from("chart_of_accounts")
        .select("id, account_number, name")
        .in("account_number", accountNumbers)
        .eq("is_active", true);

      const acctMap: Record<string, string> = {};
      for (const a of accounts ?? []) {
        acctMap[a.account_number as string] = a.id as string;
      }

      // Create journal entry
      const entryDescription = `Payroll — ${run.pay_period_start} to ${run.pay_period_end}`;
      const totalAmount = r2(totalGross + totalEmployerTax);

      const { data: journalEntry, error: jeErr } = await sb
        .from("journal_entries")
        .insert({
          entry_date: run.pay_date,
          description: entryDescription,
          reference: `PR-${(run.id as string).slice(0, 8)}`,
          source: "payroll",
          source_id: run.id,
          status: "posted",
          total_amount: totalAmount,
          created_by: userId,
          created_by_name: userInfo.name,
          posted_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (jeErr) throw jeErr;

      // Build journal entry lines
      const jeLines: {
        journal_entry_id: string;
        account_id: string;
        debit: number;
        credit: number;
        description: string;
        line_order: number;
      }[] = [];

      let lineOrder = 1;

      // DR 5000 Payroll Expense (gross wages)
      if (acctMap["5000"] && totalGross > 0) {
        jeLines.push({
          journal_entry_id: journalEntry.id as string,
          account_id: acctMap["5000"],
          debit: totalGross,
          credit: 0,
          description: "Gross wages",
          line_order: lineOrder++,
        });
      }

      // DR 5010 Employer Payroll Tax Expense
      if (acctMap["5010"] && totalEmployerTax > 0) {
        jeLines.push({
          journal_entry_id: journalEntry.id as string,
          account_id: acctMap["5010"],
          debit: totalEmployerTax,
          credit: 0,
          description: "Employer payroll taxes",
          line_order: lineOrder++,
        });
      }

      // CR Federal Tax Payable (2200 Accrued Liabilities or 2210 if exists)
      const federalAcct = acctMap["2210"] || acctMap["2200"];
      if (federalAcct && totalFederalWh > 0) {
        jeLines.push({
          journal_entry_id: journalEntry.id as string,
          account_id: federalAcct,
          debit: 0,
          credit: totalFederalWh,
          description: "Federal income tax withholding",
          line_order: lineOrder++,
        });
      } else if (totalFederalWh > 0) {
        console.warn(
          "[PAYROLL-POST] No account found for Federal Tax Payable (2210/2200). Skipping $" +
            totalFederalWh.toFixed(2),
        );
      }

      // CR State Tax Payable (2210 or fallback)
      // If 2210 was used for federal, use 2200 for state, or same account
      const stateAcct = acctMap["2210"] || acctMap["2200"];
      if (stateAcct && totalStateWh > 0) {
        jeLines.push({
          journal_entry_id: journalEntry.id as string,
          account_id: stateAcct,
          debit: 0,
          credit: totalStateWh,
          description: "State income tax withholding (KY)",
          line_order: lineOrder++,
        });
      } else if (totalStateWh > 0) {
        console.warn(
          "[PAYROLL-POST] No account found for State Tax Payable. Skipping $" +
            totalStateWh.toFixed(2),
        );
      }

      // CR FICA Payable (employee + employer SS + Medicare) — 2220 or 2100 Payroll Payable
      const ficaTotal = r2(totalEmployeeFica + totalEmployerFica);
      const ficaAcct = acctMap["2220"] || acctMap["2100"];
      if (ficaAcct && ficaTotal > 0) {
        jeLines.push({
          journal_entry_id: journalEntry.id as string,
          account_id: ficaAcct,
          debit: 0,
          credit: ficaTotal,
          description: "FICA payable (SS + Medicare, employee + employer)",
          line_order: lineOrder++,
        });
      } else if (ficaTotal > 0) {
        console.warn(
          "[PAYROLL-POST] No account found for FICA Payable (2220/2100). Skipping $" +
            ficaTotal.toFixed(2),
        );
      }

      // CR FUTA Payable — 2230 or fallback
      const futaAcct = acctMap["2230"] || acctMap["2200"];
      if (futaAcct && totalFuta > 0) {
        jeLines.push({
          journal_entry_id: journalEntry.id as string,
          account_id: futaAcct,
          debit: 0,
          credit: totalFuta,
          description: "FUTA payable",
          line_order: lineOrder++,
        });
      } else if (totalFuta > 0) {
        console.warn(
          "[PAYROLL-POST] No account found for FUTA Payable (2230). Skipping $" +
            totalFuta.toFixed(2),
        );
      }

      // CR SUTA Payable — 2240 or fallback
      const sutaAcct = acctMap["2240"] || acctMap["2200"];
      if (sutaAcct && totalSuta > 0) {
        jeLines.push({
          journal_entry_id: journalEntry.id as string,
          account_id: sutaAcct,
          debit: 0,
          credit: totalSuta,
          description: "SUTA payable (KY)",
          line_order: lineOrder++,
        });
      } else if (totalSuta > 0) {
        console.warn(
          "[PAYROLL-POST] No account found for SUTA Payable (2240). Skipping $" +
            totalSuta.toFixed(2),
        );
      }

      // CR 1000 Cash (net pay to employees)
      if (acctMap["1000"] && totalNetPay > 0) {
        jeLines.push({
          journal_entry_id: journalEntry.id as string,
          account_id: acctMap["1000"],
          debit: 0,
          credit: totalNetPay,
          description: "Net pay disbursement",
          line_order: lineOrder++,
        });
      }

      // Ensure the journal entry balances. If some liability accounts were
      // missing, we need to shunt the remainder to an available liability
      // account so debits === credits.
      let totalJeDebits = 0;
      let totalJeCredits = 0;
      for (const jl of jeLines) {
        totalJeDebits += jl.debit;
        totalJeCredits += jl.credit;
      }
      totalJeDebits = r2(totalJeDebits);
      totalJeCredits = r2(totalJeCredits);

      const imbalance = r2(totalJeDebits - totalJeCredits);
      if (imbalance > 0) {
        // Credits are short — put the remainder in 2200 Accrued Liabilities or 2100 Payroll Payable
        const catchAllAcct = acctMap["2200"] || acctMap["2100"];
        if (catchAllAcct) {
          jeLines.push({
            journal_entry_id: journalEntry.id as string,
            account_id: catchAllAcct,
            debit: 0,
            credit: imbalance,
            description: "Payroll tax liabilities (balancing entry — missing specific accounts)",
            line_order: lineOrder++,
          });
        } else {
          console.warn(
            "[PAYROLL-POST] Journal entry is unbalanced by $" +
              imbalance.toFixed(2) +
              " — no liability account available for balancing.",
          );
        }
      }

      // Insert journal entry lines
      if (jeLines.length > 0) {
        const { error: jelErr } = await sb
          .from("journal_entry_lines")
          .insert(jeLines);

        if (jelErr) throw jelErr;
      }

      // Update account balances for each journal entry line
      for (const jl of jeLines) {
        if (jl.debit > 0) {
          await sb.rpc("increment_account_balance", {
            p_account_id: jl.account_id,
            p_amount: jl.debit,
          }).then(({ error: rpcErr }) => {
            // If RPC doesn't exist, fall back to direct update
            if (rpcErr) {
              console.warn("[PAYROLL-POST] Balance RPC failed, using direct update:", rpcErr.message);
            }
          });
        }
        if (jl.credit > 0) {
          await sb.rpc("increment_account_balance", {
            p_account_id: jl.account_id,
            p_amount: -jl.credit,
          }).then(({ error: rpcErr }) => {
            if (rpcErr) {
              console.warn("[PAYROLL-POST] Balance RPC failed, using direct update:", rpcErr.message);
            }
          });
        }
      }

      // Update payroll run status
      const { data: updatedRun, error: updateErr } = await sb
        .from("payroll_runs")
        .update({
          status: "posted",
          journal_entry_id: journalEntry.id,
          posted_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Update employee YTD accumulators
      for (const line of runLines) {
        const lineUserId = line.user_id as string;
        const { data: existingProfile } = await sb
          .from("employee_tax_profiles")
          .select("id")
          .eq("user_id", lineUserId)
          .single();

        if (existingProfile) {
          // Supabase JS doesn't support atomic increment natively on update,
          // so we fetch current values then update with the new totals
          const { data: profileRaw } = await sb
            .from("employee_tax_profiles")
            .select("*")
            .eq("user_id", lineUserId)
            .single();

          const profile = profileRaw as Record<string, unknown> | null;
          if (profile) {
            await sb
              .from("employee_tax_profiles")
              .update({
                ytd_gross_pay: r2(Number(profile.ytd_gross_pay || 0) + Number(line.gross_pay || 0)),
                ytd_federal_wh: r2(Number(profile.ytd_federal_wh || 0) + Number(line.federal_wh || 0)),
                ytd_state_wh: r2(Number(profile.ytd_state_wh || 0) + Number(line.state_wh || 0)),
                ytd_ss_employee: r2(Number(profile.ytd_ss_employee || 0) + Number(line.ss_employee || 0)),
                ytd_medicare_employee: r2(
                  Number(profile.ytd_medicare_employee || 0) + Number(line.medicare_employee || 0),
                ),
                ytd_ss_employer: r2(Number(profile.ytd_ss_employer || 0) + Number(line.ss_employer || 0)),
                ytd_medicare_employer: r2(
                  Number(profile.ytd_medicare_employer || 0) + Number(line.medicare_employer || 0),
                ),
                ytd_futa: r2(Number(profile.ytd_futa || 0) + Number(line.futa || 0)),
                ytd_suta: r2(Number(profile.ytd_suta || 0) + Number(line.suta || 0)),
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", lineUserId);
          }
        }
      }

      logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "journal_entry_posted" as const,
        details: {
          type: "payroll_run_posted",
          payroll_run_id: id,
          journal_entry_id: journalEntry.id,
          pay_date: run.pay_date,
          total_gross: totalGross,
          total_net: totalNetPay,
          total_employer_tax: totalEmployerTax,
          employee_count: runLines.length,
        },
      });

      return NextResponse.json(updatedRun);
    }

    // ── VOID ──
    if (action === "void") {
      if (run.status === "voided") {
        return NextResponse.json(
          { error: "Payroll run is already voided" },
          { status: 400 },
        );
      }

      // If posted, void the journal entry too
      if (run.journal_entry_id) {
        await sb
          .from("journal_entries")
          .update({
            status: "voided",
            voided_at: new Date().toISOString(),
            voided_by: userId,
            voided_reason: "Payroll run voided",
          })
          .eq("id", run.journal_entry_id);

        // Reverse account balance changes from the journal entry lines
        const { data: jeLines } = await sb
          .from("journal_entry_lines")
          .select("account_id, debit, credit")
          .eq("journal_entry_id", run.journal_entry_id);

        for (const jl of jeLines ?? []) {
          const debit = Number(jl.debit) || 0;
          const credit = Number(jl.credit) || 0;
          // Reverse: debits were added, credits were subtracted
          if (debit > 0) {
            await sb.rpc("increment_account_balance", {
              p_account_id: jl.account_id,
              p_amount: -debit,
            }).then(({ error: rpcErr }) => {
              if (rpcErr)
                console.warn("[PAYROLL-VOID] Balance RPC failed:", rpcErr.message);
            });
          }
          if (credit > 0) {
            await sb.rpc("increment_account_balance", {
              p_account_id: jl.account_id,
              p_amount: credit,
            }).then(({ error: rpcErr }) => {
              if (rpcErr)
                console.warn("[PAYROLL-VOID] Balance RPC failed:", rpcErr.message);
            });
          }
        }

        // Reverse YTD accumulators if the run was posted
        if (run.status === "posted") {
          const voidRunLines = (run.payroll_run_lines ?? []) as Record<string, unknown>[];
          for (const line of voidRunLines) {
            const lineUserId = line.user_id as string;
            const { data: profileRaw2 } = await sb
              .from("employee_tax_profiles")
              .select("*")
              .eq("user_id", lineUserId)
              .single();

            const profile = profileRaw2 as Record<string, unknown> | null;
            if (profile) {
              await sb
                .from("employee_tax_profiles")
                .update({
                  ytd_gross_pay: r2(
                    Math.max(0, Number(profile.ytd_gross_pay || 0) - Number(line.gross_pay || 0)),
                  ),
                  ytd_federal_wh: r2(
                    Math.max(0, Number(profile.ytd_federal_wh || 0) - Number(line.federal_wh || 0)),
                  ),
                  ytd_state_wh: r2(
                    Math.max(0, Number(profile.ytd_state_wh || 0) - Number(line.state_wh || 0)),
                  ),
                  ytd_ss_employee: r2(
                    Math.max(0, Number(profile.ytd_ss_employee || 0) - Number(line.ss_employee || 0)),
                  ),
                  ytd_medicare_employee: r2(
                    Math.max(
                      0,
                      Number(profile.ytd_medicare_employee || 0) - Number(line.medicare_employee || 0),
                    ),
                  ),
                  ytd_ss_employer: r2(
                    Math.max(0, Number(profile.ytd_ss_employer || 0) - Number(line.ss_employer || 0)),
                  ),
                  ytd_medicare_employer: r2(
                    Math.max(
                      0,
                      Number(profile.ytd_medicare_employer || 0) - Number(line.medicare_employer || 0),
                    ),
                  ),
                  ytd_futa: r2(Math.max(0, Number(profile.ytd_futa || 0) - Number(line.futa || 0))),
                  ytd_suta: r2(Math.max(0, Number(profile.ytd_suta || 0) - Number(line.suta || 0))),
                  updated_at: new Date().toISOString(),
                })
                .eq("user_id", lineUserId);
            }
          }
        }
      }

      // Update payroll run to voided
      const { data: updatedRun, error: updateErr } = await sb
        .from("payroll_runs")
        .update({ status: "voided" })
        .eq("id", id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "journal_entry_voided" as const,
        details: {
          type: "payroll_run_voided",
          payroll_run_id: id,
          journal_entry_id: run.journal_entry_id,
          previous_status: run.status,
        },
      });

      return NextResponse.json(updatedRun);
    }

    // Should not reach here due to validation above
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/payroll-run PATCH", err);
    return NextResponse.json(
      { error: "Failed to update payroll run" },
      { status: 502 },
    );
  }
}
