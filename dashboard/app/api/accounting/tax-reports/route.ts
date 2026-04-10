import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { getTaxValue, type TaxRateRow } from "@/lib/payroll-tax";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function getUserInfo(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator";
    return { role };
  } catch {
    return { role: "operator" };
  }
}

function isManager(role: string): boolean {
  return role === "developer" || role === "manager";
}

/** Quarter start/end dates (YYYY-MM-DD). */
function quarterDates(year: number, quarter: number) {
  const starts = [`${year}-01-01`, `${year}-04-01`, `${year}-07-01`, `${year}-10-01`];
  const ends = [`${year}-03-31`, `${year}-06-30`, `${year}-09-30`, `${year}-12-31`];
  return { start: starts[quarter - 1], end: ends[quarter - 1] };
}

/** Month range within a quarter (1-indexed month numbers). */
function quarterMonths(quarter: number): number[] {
  return [(quarter - 1) * 3 + 1, (quarter - 1) * 3 + 2, (quarter - 1) * 3 + 3];
}

// ---------------------------------------------------------------------------
// Tax rate loader — reads from DB instead of hardcoded constants
// ---------------------------------------------------------------------------

interface TaxConstants {
  SS_WAGE_BASE: number;
  SS_COMBINED_RATE: number;
  MEDICARE_COMBINED_RATE: number;
  ADDITIONAL_MEDICARE_THRESHOLD: number;
  ADDITIONAL_MEDICARE_RATE: number;
  FUTA_WAGE_BASE: number;
  FUTA_RATE_AFTER_CREDIT: number;
}

async function loadTaxConstants(taxYear: number): Promise<TaxConstants> {
  const sb = getSupabase();
  const { data: taxRatesRaw } = await sb
    .from("tax_rate_tables")
    .select("*")
    .eq("tax_year", taxYear);

  const rates = (taxRatesRaw ?? []) as unknown as TaxRateRow[];

  const ssRate = getTaxValue(rates, "ss_rate");
  const medicareRate = getTaxValue(rates, "medicare_rate");
  const futaRate = getTaxValue(rates, "futa_rate");
  const futaCredit = getTaxValue(rates, "futa_credit");

  return {
    SS_WAGE_BASE: getTaxValue(rates, "ss_wage_base", "flat_amount") || 176100,
    SS_COMBINED_RATE: ssRate ? ssRate * 2 : 0.124,
    MEDICARE_COMBINED_RATE: medicareRate ? medicareRate * 2 : 0.029,
    ADDITIONAL_MEDICARE_THRESHOLD: getTaxValue(rates, "medicare_additional_threshold", "flat_amount") || 200000,
    ADDITIONAL_MEDICARE_RATE: getTaxValue(rates, "medicare_additional_rate") || 0.009,
    FUTA_WAGE_BASE: getTaxValue(rates, "futa_wage_base", "flat_amount") || 7000,
    FUTA_RATE_AFTER_CREDIT: (futaRate && futaCredit) ? (futaRate - futaCredit) : 0.006,
  };
}

// ---------------------------------------------------------------------------
// Report: Form 941 (Quarterly)
// ---------------------------------------------------------------------------

async function build941(year: number, quarter: number) {
  const sb = getSupabase();
  const { start, end } = quarterDates(year, quarter);
  const months = quarterMonths(quarter);
  const tc = await loadTaxConstants(year);

  // Fetch all posted payroll runs in the quarter
  const { data: runs, error: runsErr } = await sb
    .from("payroll_runs")
    .select("id, pay_date, status")
    .in("status", ["posted", "approved"])
    .gte("pay_date", start)
    .lte("pay_date", end)
    .order("pay_date");

  if (runsErr) throw runsErr;
  if (!runs || runs.length === 0) {
    return {
      year,
      quarter,
      period: { start, end },
      no_data: true,
      message: "No posted payroll runs found for this quarter.",
    };
  }

  const runIds = runs.map((r: { id: string }) => r.id);

  // Fetch all lines for those runs
  const { data: lines, error: linesErr } = await sb
    .from("payroll_run_lines")
    .select(
      "payroll_run_id, user_id, employee_name, gross_pay, federal_wh, state_wh, ss_employee, medicare_employee, ss_employer, medicare_employer, futa, suta"
    )
    .in("payroll_run_id", runIds);

  if (linesErr) throw linesErr;
  if (!lines || lines.length === 0) {
    return {
      year,
      quarter,
      period: { start, end },
      no_data: true,
      message: "No payroll line items found for this quarter.",
    };
  }

  // Also need pay_date per run for monthly breakdown
  const runDateMap: Record<string, string> = {};
  for (const run of runs) {
    runDateMap[run.id] = run.pay_date;
  }

  // Aggregate per-employee YTD gross for SS wage base cap
  // We need all lines for the year up to end of this quarter
  const { data: ytdLines, error: ytdErr } = await sb
    .from("payroll_run_lines")
    .select("user_id, gross_pay, payroll_run_id")
    .in(
      "payroll_run_id",
      (
        await sb
          .from("payroll_runs")
          .select("id")
          .in("status", ["posted", "approved"])
          .gte("pay_date", `${year}-01-01`)
          .lte("pay_date", end)
      ).data?.map((r: { id: string }) => r.id) ?? []
    );

  if (ytdErr) throw ytdErr;

  // Build YTD gross per employee (all quarters up to and including this one)
  const ytdGrossByEmployee: Record<string, number> = {};
  for (const line of ytdLines ?? []) {
    ytdGrossByEmployee[line.user_id] =
      (ytdGrossByEmployee[line.user_id] || 0) + Number(line.gross_pay);
  }

  // Build prior-quarters gross per employee (quarters before this one)
  const priorQuarterRunIds = new Set<string>();
  for (const run of runs) {
    // These are current quarter runs — we need to exclude them
  }
  // Get all run IDs for prior quarters
  const priorEnd = quarter > 1 ? quarterDates(year, quarter - 1).end : null;
  const priorGrossByEmployee: Record<string, number> = {};

  if (priorEnd) {
    const { data: priorRuns } = await sb
      .from("payroll_runs")
      .select("id")
      .in("status", ["posted", "approved"])
      .gte("pay_date", `${year}-01-01`)
      .lte("pay_date", priorEnd);

    const priorRunIds = (priorRuns ?? []).map((r: { id: string }) => r.id);
    if (priorRunIds.length > 0) {
      const { data: priorLines } = await sb
        .from("payroll_run_lines")
        .select("user_id, gross_pay")
        .in("payroll_run_id", priorRunIds);

      for (const line of priorLines ?? []) {
        priorGrossByEmployee[line.user_id] =
          (priorGrossByEmployee[line.user_id] || 0) + Number(line.gross_pay);
      }
    }
  }

  // ── Compute 941 lines ──

  // Line 1: distinct employees
  const uniqueEmployees = new Set(lines.map((l: { user_id: string }) => l.user_id));
  const line1 = uniqueEmployees.size;

  // Line 2: total wages
  const line2 = r2(lines.reduce((s: number, l: { gross_pay: number }) => s + Number(l.gross_pay), 0));

  // Line 3: federal income tax withheld
  const line3 = r2(lines.reduce((s: number, l: { federal_wh: number }) => s + Number(l.federal_wh), 0));

  // Line 5a: Taxable SS wages (capped at wage base per employee)
  // For each employee, their taxable SS wages this quarter =
  //   min(gross_this_quarter, max(0, SS_WAGE_BASE - prior_quarters_gross))
  let taxableSS = 0;
  const employeeQuarterGross: Record<string, number> = {};
  for (const line of lines) {
    employeeQuarterGross[line.user_id] =
      (employeeQuarterGross[line.user_id] || 0) + Number(line.gross_pay);
  }

  for (const empId of uniqueEmployees) {
    const priorGross = priorGrossByEmployee[empId] || 0;
    const qGross = employeeQuarterGross[empId] || 0;
    const remainingBase = Math.max(0, tc.SS_WAGE_BASE - priorGross);
    taxableSS += Math.min(qGross, remainingBase);
  }
  const line5a = r2(taxableSS);
  const line5a_ii = r2(taxableSS * tc.SS_COMBINED_RATE);

  // Line 5c: taxable Medicare wages (no cap)
  const line5c = line2; // all wages are Medicare taxable
  const line5c_ii = r2(line5c * tc.MEDICARE_COMBINED_RATE);

  // Line 5d: Additional Medicare Tax (wages over $200k)
  let additionalMedicare = 0;
  for (const empId of uniqueEmployees) {
    const ytdGross = ytdGrossByEmployee[empId] || 0;
    const priorGross = priorGrossByEmployee[empId] || 0;
    const qGross = employeeQuarterGross[empId] || 0;

    // Only wages above threshold in this quarter
    if (ytdGross > tc.ADDITIONAL_MEDICARE_THRESHOLD) {
      const priorAbove = Math.max(0, priorGross - tc.ADDITIONAL_MEDICARE_THRESHOLD);
      const ytdAbove = Math.max(0, ytdGross - tc.ADDITIONAL_MEDICARE_THRESHOLD);
      additionalMedicare += ytdAbove - priorAbove;
    }
  }
  const line5d = r2(additionalMedicare * tc.ADDITIONAL_MEDICARE_RATE);

  // Line 5e: total SS + Medicare + additional Medicare
  const line5e = r2(line5a_ii + line5c_ii + line5d);

  // Line 6: total taxes before adjustments
  const line6 = r2(line3 + line5e);

  // Lines 7-9: adjustments (0 for now)
  const line7 = 0;
  const line8 = 0;
  const line9 = 0;

  // Line 10: total taxes after adjustments
  const line10 = r2(line6 + line7 - line8 + line9);

  // Line 11: qualified small business payroll tax credit
  const line11 = 0;

  // Line 12: total taxes after adjustments and credits
  const line12 = r2(line10 - line11);

  // Monthly breakdown
  const monthlyLiability: Record<number, number> = {};
  for (const m of months) {
    monthlyLiability[m] = 0;
  }

  for (const line of lines) {
    const payDate = runDateMap[line.payroll_run_id];
    if (!payDate) continue;
    const month = new Date(payDate + "T12:00:00").getMonth() + 1; // 1-indexed
    const fedWh = Number(line.federal_wh);
    const ssEe = Number(line.ss_employee);
    const ssEr = Number(line.ss_employer);
    const medEe = Number(line.medicare_employee);
    const medEr = Number(line.medicare_employer);
    monthlyLiability[month] = r2(
      (monthlyLiability[month] || 0) + fedWh + ssEe + ssEr + medEe + medEr
    );
  }

  const monthNames = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const monthly_breakdown = months.map((m) => ({
    month: m,
    month_name: monthNames[m],
    tax_liability: r2(monthlyLiability[m] || 0),
  }));

  return {
    year,
    quarter,
    period: { start, end },
    no_data: false,
    payroll_runs_count: runs.length,
    worksheet: {
      line_1_employee_count: line1,
      line_2_total_wages: line2,
      line_3_federal_wh: line3,
      line_5a_taxable_ss_wages: line5a,
      line_5a_ii_ss_tax: line5a_ii,
      line_5c_taxable_medicare_wages: line5c,
      line_5c_ii_medicare_tax: line5c_ii,
      line_5d_additional_medicare: line5d,
      line_5e_total_ss_medicare: line5e,
      line_6_total_taxes: line6,
      line_7_current_quarter_adjustment: line7,
      line_8_sick_pay: line8,
      line_9_tips_group_life: line9,
      line_10_total_after_adjustments: line10,
      line_11_qualified_sb_credit: line11,
      line_12_total_after_credits: line12,
    },
    monthly_breakdown,
    rates: {
      ss_wage_base: tc.SS_WAGE_BASE,
      ss_combined_rate: tc.SS_COMBINED_RATE,
      medicare_combined_rate: tc.MEDICARE_COMBINED_RATE,
      additional_medicare_threshold: tc.ADDITIONAL_MEDICARE_THRESHOLD,
      additional_medicare_rate: tc.ADDITIONAL_MEDICARE_RATE,
    },
  };
}

// ---------------------------------------------------------------------------
// Report: KY State Withholding (Quarterly)
// ---------------------------------------------------------------------------

async function buildStateWithholding(year: number, quarter: number) {
  const sb = getSupabase();
  const { start, end } = quarterDates(year, quarter);
  const months = quarterMonths(quarter);

  const { data: runs, error: runsErr } = await sb
    .from("payroll_runs")
    .select("id, pay_date")
    .in("status", ["posted", "approved"])
    .gte("pay_date", start)
    .lte("pay_date", end)
    .order("pay_date");

  if (runsErr) throw runsErr;
  if (!runs || runs.length === 0) {
    return {
      year,
      quarter,
      period: { start, end },
      no_data: true,
      message: "No posted payroll runs found for this quarter.",
    };
  }

  const runIds = runs.map((r: { id: string }) => r.id);
  const runDateMap: Record<string, string> = {};
  for (const run of runs) {
    runDateMap[run.id] = run.pay_date;
  }

  const { data: lines, error: linesErr } = await sb
    .from("payroll_run_lines")
    .select("payroll_run_id, user_id, gross_pay, state_wh")
    .in("payroll_run_id", runIds);

  if (linesErr) throw linesErr;

  const monthNames = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  // Aggregate by month
  const monthlyData: Record<number, { wages: number; withholding: number; employees: Set<string> }> = {};
  for (const m of months) {
    monthlyData[m] = { wages: 0, withholding: 0, employees: new Set() };
  }

  for (const line of lines ?? []) {
    const payDate = runDateMap[line.payroll_run_id];
    if (!payDate) continue;
    const month = new Date(payDate + "T12:00:00").getMonth() + 1;
    if (monthlyData[month]) {
      monthlyData[month].wages += Number(line.gross_pay);
      monthlyData[month].withholding += Number(line.state_wh);
      monthlyData[month].employees.add(line.user_id);
    }
  }

  const monthly = months.map((m) => ({
    month: m,
    month_name: monthNames[m],
    total_wages: r2(monthlyData[m].wages),
    state_withholding: r2(monthlyData[m].withholding),
    employee_count: monthlyData[m].employees.size,
  }));

  const totalWages = r2(monthly.reduce((s, m) => s + m.total_wages, 0));
  const totalWithholding = r2(monthly.reduce((s, m) => s + m.state_withholding, 0));
  const uniqueEmps = new Set((lines ?? []).map((l: { user_id: string }) => l.user_id));

  return {
    year,
    quarter,
    period: { start, end },
    no_data: false,
    state: "KY",
    state_name: "Kentucky",
    summary: {
      total_wages: totalWages,
      total_state_withholding: totalWithholding,
      employee_count: uniqueEmps.size,
    },
    monthly,
  };
}

// ---------------------------------------------------------------------------
// Report: Form 940 (Annual FUTA)
// ---------------------------------------------------------------------------

async function build940(year: number) {
  const sb = getSupabase();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const tc = await loadTaxConstants(year);

  const { data: runs, error: runsErr } = await sb
    .from("payroll_runs")
    .select("id, pay_date")
    .in("status", ["posted", "approved"])
    .gte("pay_date", start)
    .lte("pay_date", end)
    .order("pay_date");

  if (runsErr) throw runsErr;
  if (!runs || runs.length === 0) {
    return {
      year,
      period: { start, end },
      no_data: true,
      message: "No posted payroll runs found for this year.",
    };
  }

  const runIds = runs.map((r: { id: string }) => r.id);

  const { data: lines, error: linesErr } = await sb
    .from("payroll_run_lines")
    .select("user_id, employee_name, gross_pay, futa, payroll_run_id")
    .in("payroll_run_id", runIds);

  if (linesErr) throw linesErr;

  // Per-employee FUTA tracking
  const employeeData: Record<
    string,
    { name: string; total_wages: number; futa_taxable: number; futa_tax: number }
  > = {};

  for (const line of lines ?? []) {
    if (!employeeData[line.user_id]) {
      employeeData[line.user_id] = {
        name: line.employee_name,
        total_wages: 0,
        futa_taxable: 0,
        futa_tax: 0,
      };
    }
    employeeData[line.user_id].total_wages += Number(line.gross_pay);
    employeeData[line.user_id].futa_tax += Number(line.futa);
  }

  // Compute taxable FUTA wages (first $7k per employee)
  for (const empId of Object.keys(employeeData)) {
    employeeData[empId].futa_taxable = Math.min(
      employeeData[empId].total_wages,
      tc.FUTA_WAGE_BASE
    );
    employeeData[empId].total_wages = r2(employeeData[empId].total_wages);
    employeeData[empId].futa_taxable = r2(employeeData[empId].futa_taxable);
    employeeData[empId].futa_tax = r2(employeeData[empId].futa_tax);
  }

  const employees = Object.entries(employeeData).map(([id, d]) => ({
    user_id: id,
    ...d,
  }));

  const totalPayments = r2(employees.reduce((s, e) => s + e.total_wages, 0));
  const totalTaxableWages = r2(employees.reduce((s, e) => s + e.futa_taxable, 0));
  const computedFutaTax = r2(totalTaxableWages * tc.FUTA_RATE_AFTER_CREDIT);
  const actualFutaDeposits = r2(employees.reduce((s, e) => s + e.futa_tax, 0));

  // Quarterly FUTA liability breakdown
  const runDateMap: Record<string, string> = {};
  for (const run of runs) {
    runDateMap[run.id] = run.pay_date;
  }

  const quarterlyFuta: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const line of lines ?? []) {
    const payDate = runDateMap[line.payroll_run_id];
    if (!payDate) continue;
    const month = new Date(payDate + "T12:00:00").getMonth() + 1;
    const q = Math.ceil(month / 3);
    quarterlyFuta[q] = r2((quarterlyFuta[q] || 0) + Number(line.futa));
  }

  return {
    year,
    period: { start, end },
    no_data: false,
    worksheet: {
      line_3_total_payments: totalPayments,
      line_4_exempt_payments: 0,
      line_5_taxable_futa_wages: totalTaxableWages,
      line_8_futa_tax: computedFutaTax,
      line_13_futa_deposits: actualFutaDeposits,
      futa_wage_base: tc.FUTA_WAGE_BASE,
      futa_rate: tc.FUTA_RATE_AFTER_CREDIT,
    },
    employees,
    quarterly_liability: [
      { quarter: 1, label: "Q1 (Jan-Mar)", futa_liability: quarterlyFuta[1] },
      { quarter: 2, label: "Q2 (Apr-Jun)", futa_liability: quarterlyFuta[2] },
      { quarter: 3, label: "Q3 (Jul-Sep)", futa_liability: quarterlyFuta[3] },
      { quarter: 4, label: "Q4 (Oct-Dec)", futa_liability: quarterlyFuta[4] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Report: Annual Summary
// ---------------------------------------------------------------------------

async function buildSummary(year: number) {
  const sb = getSupabase();

  // Compute all 4 quarters of 941
  const quarters = [];
  for (let q = 1; q <= 4; q++) {
    const { start, end } = quarterDates(year, q);

    const { data: runs } = await sb
      .from("payroll_runs")
      .select("id, pay_date, total_gross, total_employer_tax, employee_count")
      .in("status", ["posted", "approved"])
      .gte("pay_date", start)
      .lte("pay_date", end);

    const { data: lines } = await sb
      .from("payroll_run_lines")
      .select("federal_wh, state_wh, ss_employee, medicare_employee, ss_employer, medicare_employer, futa, suta, gross_pay")
      .in(
        "payroll_run_id",
        (runs ?? []).map((r: { id: string }) => r.id)
      );

    const totalGross = r2((lines ?? []).reduce((s: number, l: { gross_pay: number }) => s + Number(l.gross_pay), 0));
    const totalFederalWh = r2(
      (lines ?? []).reduce((s: number, l: { federal_wh: number }) => s + Number(l.federal_wh), 0)
    );
    const totalStateWh = r2(
      (lines ?? []).reduce((s: number, l: { state_wh: number }) => s + Number(l.state_wh), 0)
    );
    const totalSS = r2(
      (lines ?? []).reduce(
        (s: number, l: { ss_employee: number; ss_employer: number }) =>
          s + Number(l.ss_employee) + Number(l.ss_employer),
        0
      )
    );
    const totalMedicare = r2(
      (lines ?? []).reduce(
        (s: number, l: { medicare_employee: number; medicare_employer: number }) =>
          s + Number(l.medicare_employee) + Number(l.medicare_employer),
        0
      )
    );
    const totalFuta = r2(
      (lines ?? []).reduce((s: number, l: { futa: number }) => s + Number(l.futa), 0)
    );
    const totalSuta = r2(
      (lines ?? []).reduce((s: number, l: { suta: number }) => s + Number(l.suta), 0)
    );

    quarters.push({
      quarter: q,
      label: `Q${q}`,
      period: { start, end },
      total_gross: totalGross,
      federal_withholding: totalFederalWh,
      state_withholding: totalStateWh,
      social_security: totalSS,
      medicare: totalMedicare,
      futa: totalFuta,
      suta: totalSuta,
      total_tax_liability: r2(totalFederalWh + totalSS + totalMedicare + totalFuta + totalSuta),
      payroll_runs: (runs ?? []).length,
      has_data: (runs ?? []).length > 0,
    });
  }

  const ytdGross = r2(quarters.reduce((s, q) => s + q.total_gross, 0));
  const ytdTaxLiability = r2(quarters.reduce((s, q) => s + q.total_tax_liability, 0));

  // Filing deadlines
  const filings = [
    {
      form: "Form 941",
      period: "Q1",
      due_date: `${year}-04-30`,
      description: "Quarterly federal tax return",
    },
    {
      form: "KY Withholding",
      period: "Q1",
      due_date: `${year}-04-30`,
      description: "Kentucky quarterly withholding",
    },
    {
      form: "Form 941",
      period: "Q2",
      due_date: `${year}-07-31`,
      description: "Quarterly federal tax return",
    },
    {
      form: "KY Withholding",
      period: "Q2",
      due_date: `${year}-07-31`,
      description: "Kentucky quarterly withholding",
    },
    {
      form: "Form 941",
      period: "Q3",
      due_date: `${year}-10-31`,
      description: "Quarterly federal tax return",
    },
    {
      form: "KY Withholding",
      period: "Q3",
      due_date: `${year}-10-31`,
      description: "Kentucky quarterly withholding",
    },
    {
      form: "Form 941",
      period: "Q4",
      due_date: `${year + 1}-01-31`,
      description: "Quarterly federal tax return",
    },
    {
      form: "KY Withholding",
      period: "Q4",
      due_date: `${year + 1}-01-31`,
      description: "Kentucky quarterly withholding",
    },
    {
      form: "Form 940",
      period: "Annual",
      due_date: `${year + 1}-01-31`,
      description: "Annual FUTA tax return",
    },
    {
      form: "W-2 / W-3",
      period: "Annual",
      due_date: `${year + 1}-01-31`,
      description: "Employee wage statements",
    },
    {
      form: "1099-NEC",
      period: "Annual",
      due_date: `${year + 1}-01-31`,
      description: "Nonemployee compensation",
    },
  ];

  return {
    year,
    ytd_gross: ytdGross,
    ytd_tax_liability: ytdTaxLiability,
    quarters,
    filings,
  };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (!isManager(userInfo.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const report = params.get("report");
  const year = parseInt(params.get("year") || new Date().getFullYear().toString(), 10);
  const quarter = parseInt(params.get("quarter") || "1", 10);

  if (!report) {
    return NextResponse.json(
      { error: "Missing required query param: report (941, state, 940, summary)" },
      { status: 400 }
    );
  }

  try {
    switch (report) {
      case "941": {
        if (quarter < 1 || quarter > 4) {
          return NextResponse.json({ error: "Quarter must be 1-4" }, { status: 400 });
        }
        const data = await build941(year, quarter);
        return NextResponse.json(data);
      }

      case "state": {
        if (quarter < 1 || quarter > 4) {
          return NextResponse.json({ error: "Quarter must be 1-4" }, { status: 400 });
        }
        const data = await buildStateWithholding(year, quarter);
        return NextResponse.json(data);
      }

      case "940": {
        const data = await build940(year);
        return NextResponse.json(data);
      }

      case "summary": {
        const data = await buildSummary(year);
        return NextResponse.json(data);
      }

      default:
        return NextResponse.json(
          { error: `Unknown report type: ${report}. Use 941, state, 940, or summary.` },
          { status: 400 }
        );
    }
  } catch (err: unknown) {
    console.error("[TAX-REPORTS]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
