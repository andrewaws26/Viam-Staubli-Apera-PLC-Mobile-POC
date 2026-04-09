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

function quarterDates(year: number, quarter: number) {
  const starts = [`${year}-01-01`, `${year}-04-01`, `${year}-07-01`, `${year}-10-01`];
  const ends = [`${year}-03-31`, `${year}-06-30`, `${year}-09-30`, `${year}-12-31`];
  return { start: starts[quarter - 1], end: ends[quarter - 1] };
}

function quarterMonths(quarter: number): number[] {
  return [(quarter - 1) * 3 + 1, (quarter - 1) * 3 + 2, (quarter - 1) * 3 + 3];
}

/** Escape a value for CSV (wrap in quotes if it contains comma, quote, or newline). */
function csvEscape(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build CSV string from header array and row arrays. */
function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

/** Return a CSV response with correct headers for browser download. */
function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------------
// Tax rate loader (same as main tax-reports route)
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
// CSV: Form 941 (Quarterly)
// ---------------------------------------------------------------------------

async function export941Csv(year: number, quarter: number): Promise<string> {
  const sb = getSupabase();
  const { start, end } = quarterDates(year, quarter);
  const months = quarterMonths(quarter);
  const tc = await loadTaxConstants(year);

  // Fetch posted runs for the quarter
  const { data: runs, error: runsErr } = await sb
    .from("payroll_runs")
    .select("id, pay_date, status")
    .in("status", ["posted", "approved"])
    .gte("pay_date", start)
    .lte("pay_date", end)
    .order("pay_date");

  if (runsErr) throw runsErr;
  if (!runs || runs.length === 0) {
    return buildCsv(["Line", "Description", "Amount"], [["", "No posted payroll runs found for this quarter.", ""]]);
  }

  const runIds = runs.map((r: { id: string }) => r.id);

  const { data: lines, error: linesErr } = await sb
    .from("payroll_run_lines")
    .select(
      "payroll_run_id, user_id, employee_name, gross_pay, federal_wh, state_wh, ss_employee, medicare_employee, ss_employer, medicare_employer, futa, suta"
    )
    .in("payroll_run_id", runIds);

  if (linesErr) throw linesErr;
  if (!lines || lines.length === 0) {
    return buildCsv(["Line", "Description", "Amount"], [["", "No payroll line items found for this quarter.", ""]]);
  }

  // Run date map for monthly breakdown
  const runDateMap: Record<string, string> = {};
  for (const run of runs) {
    runDateMap[run.id] = run.pay_date;
  }

  // YTD lines for SS wage base capping
  const { data: ytdRuns } = await sb
    .from("payroll_runs")
    .select("id")
    .in("status", ["posted", "approved"])
    .gte("pay_date", `${year}-01-01`)
    .lte("pay_date", end);

  const ytdRunIds = (ytdRuns ?? []).map((r: { id: string }) => r.id);
  const { data: ytdLines } = await sb
    .from("payroll_run_lines")
    .select("user_id, gross_pay")
    .in("payroll_run_id", ytdRunIds);

  const ytdGrossByEmployee: Record<string, number> = {};
  for (const line of ytdLines ?? []) {
    ytdGrossByEmployee[line.user_id] = (ytdGrossByEmployee[line.user_id] || 0) + Number(line.gross_pay);
  }

  // Prior-quarter gross per employee
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
        priorGrossByEmployee[line.user_id] = (priorGrossByEmployee[line.user_id] || 0) + Number(line.gross_pay);
      }
    }
  }

  // Compute 941 lines
  const uniqueEmployees = new Set(lines.map((l: { user_id: string }) => l.user_id));
  const line1 = uniqueEmployees.size;
  const line2 = r2(lines.reduce((s: number, l: { gross_pay: number }) => s + Number(l.gross_pay), 0));
  const line3 = r2(lines.reduce((s: number, l: { federal_wh: number }) => s + Number(l.federal_wh), 0));

  // Taxable SS wages (capped at wage base per employee)
  let taxableSS = 0;
  const employeeQuarterGross: Record<string, number> = {};
  for (const line of lines) {
    employeeQuarterGross[line.user_id] = (employeeQuarterGross[line.user_id] || 0) + Number(line.gross_pay);
  }
  for (const empId of uniqueEmployees) {
    const priorGross = priorGrossByEmployee[empId] || 0;
    const qGross = employeeQuarterGross[empId] || 0;
    const remainingBase = Math.max(0, tc.SS_WAGE_BASE - priorGross);
    taxableSS += Math.min(qGross, remainingBase);
  }
  const line5a = r2(taxableSS);
  const line5a_ii = r2(taxableSS * tc.SS_COMBINED_RATE);
  const line5c = line2;
  const line5c_ii = r2(line5c * tc.MEDICARE_COMBINED_RATE);

  // Additional Medicare
  let additionalMedicare = 0;
  for (const empId of uniqueEmployees) {
    const ytdGross = ytdGrossByEmployee[empId] || 0;
    const priorGross = priorGrossByEmployee[empId] || 0;
    if (ytdGross > tc.ADDITIONAL_MEDICARE_THRESHOLD) {
      const priorAbove = Math.max(0, priorGross - tc.ADDITIONAL_MEDICARE_THRESHOLD);
      const ytdAbove = Math.max(0, ytdGross - tc.ADDITIONAL_MEDICARE_THRESHOLD);
      additionalMedicare += ytdAbove - priorAbove;
    }
  }
  const line5d = r2(additionalMedicare * tc.ADDITIONAL_MEDICARE_RATE);
  const line5e = r2(line5a_ii + line5c_ii + line5d);
  const line6 = r2(line3 + line5e);
  const line10 = line6; // lines 7-9 are 0
  const line12 = line10; // line 11 is 0

  // Monthly breakdown
  const monthlyLiability: Record<number, number> = {};
  for (const m of months) monthlyLiability[m] = 0;
  for (const line of lines) {
    const payDate = runDateMap[line.payroll_run_id];
    if (!payDate) continue;
    const month = new Date(payDate + "T12:00:00").getMonth() + 1;
    const total = Number(line.federal_wh) + Number(line.ss_employee) + Number(line.ss_employer) +
      Number(line.medicare_employee) + Number(line.medicare_employer);
    monthlyLiability[month] = r2((monthlyLiability[month] || 0) + total);
  }

  const monthNames = ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  // Build CSV rows
  const headers = ["Line", "Description", "Amount"];
  const rows: (string | number)[][] = [
    ["1", "Number of employees who received wages", line1],
    ["2", "Total wages, tips, and other compensation", line2.toFixed(2)],
    ["3", "Federal income tax withheld", line3.toFixed(2)],
    ["5a", "Taxable Social Security wages", line5a.toFixed(2)],
    ["5a(ii)", "Social Security tax (wages x " + tc.SS_COMBINED_RATE + ")", line5a_ii.toFixed(2)],
    ["5c", "Taxable Medicare wages", line5c.toFixed(2)],
    ["5c(ii)", "Medicare tax (wages x " + tc.MEDICARE_COMBINED_RATE + ")", line5c_ii.toFixed(2)],
    ["5d", "Additional Medicare Tax", line5d.toFixed(2)],
    ["5e", "Total Social Security and Medicare taxes", line5e.toFixed(2)],
    ["6", "Total taxes before adjustments", line6.toFixed(2)],
    ["7", "Current quarter adjustment for fractions of cents", "0.00"],
    ["8", "Current quarter adjustment for sick pay", "0.00"],
    ["9", "Current quarter adjustments for tips and group-term life", "0.00"],
    ["10", "Total taxes after adjustments", line10.toFixed(2)],
    ["11", "Qualified small business payroll tax credit", "0.00"],
    ["12", "Total taxes after adjustments and credits", line12.toFixed(2)],
    ["", "", ""],
    ["", "Monthly Tax Liability", ""],
  ];

  for (const m of months) {
    rows.push(["", monthNames[m], r2(monthlyLiability[m] || 0).toFixed(2)]);
  }
  rows.push(["", "Total quarterly liability", line12.toFixed(2)]);

  return buildCsv(headers, rows);
}

// ---------------------------------------------------------------------------
// CSV: Form 940 (Annual FUTA)
// ---------------------------------------------------------------------------

async function export940Csv(year: number): Promise<string> {
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
    return buildCsv(
      ["Employee", "Total Wages", "FUTA Taxable Wages", "FUTA Tax"],
      [["No posted payroll runs found for this year.", "", "", ""]],
    );
  }

  const runIds = runs.map((r: { id: string }) => r.id);

  const { data: lines, error: linesErr } = await sb
    .from("payroll_run_lines")
    .select("user_id, employee_name, gross_pay, futa")
    .in("payroll_run_id", runIds);

  if (linesErr) throw linesErr;

  // Per-employee aggregation
  const employeeData: Record<string, { name: string; total_wages: number; futa_tax: number }> = {};
  for (const line of lines ?? []) {
    if (!employeeData[line.user_id]) {
      employeeData[line.user_id] = { name: line.employee_name, total_wages: 0, futa_tax: 0 };
    }
    employeeData[line.user_id].total_wages += Number(line.gross_pay);
    employeeData[line.user_id].futa_tax += Number(line.futa);
  }

  const headers = ["Employee", "Total Wages", "FUTA Taxable Wages", "FUTA Tax"];
  const rows: (string | number)[][] = [];

  let totalWages = 0;
  let totalTaxable = 0;
  let totalFuta = 0;

  for (const empId of Object.keys(employeeData)) {
    const d = employeeData[empId];
    const wages = r2(d.total_wages);
    const taxable = r2(Math.min(d.total_wages, tc.FUTA_WAGE_BASE));
    const futa = r2(d.futa_tax);
    totalWages += wages;
    totalTaxable += taxable;
    totalFuta += futa;
    rows.push([d.name, wages.toFixed(2), taxable.toFixed(2), futa.toFixed(2)]);
  }

  rows.push([
    "Total",
    r2(totalWages).toFixed(2),
    r2(totalTaxable).toFixed(2),
    r2(totalFuta).toFixed(2),
  ]);

  return buildCsv(headers, rows);
}

// ---------------------------------------------------------------------------
// CSV: State Withholding (Quarterly)
// ---------------------------------------------------------------------------

async function exportStateCsv(year: number, quarter: number): Promise<string> {
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
    return buildCsv(
      ["Month", "Total Wages", "State Withholding", "Employee Count"],
      [["No posted payroll runs found for this quarter.", "", "", ""]],
    );
  }

  const runIds = runs.map((r: { id: string }) => r.id);
  const runDateMap: Record<string, string> = {};
  for (const run of runs) runDateMap[run.id] = run.pay_date;

  const { data: lines, error: linesErr } = await sb
    .from("payroll_run_lines")
    .select("payroll_run_id, user_id, gross_pay, state_wh")
    .in("payroll_run_id", runIds);

  if (linesErr) throw linesErr;

  const monthNames = ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  const monthlyData: Record<number, { wages: number; withholding: number; employees: Set<string> }> = {};
  for (const m of months) monthlyData[m] = { wages: 0, withholding: 0, employees: new Set() };

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

  const headers = ["Month", "Total Wages", "State Withholding", "Employee Count"];
  const rows: (string | number)[][] = [];
  let totalWages = 0;
  let totalWH = 0;

  for (const m of months) {
    const wages = r2(monthlyData[m].wages);
    const wh = r2(monthlyData[m].withholding);
    totalWages += wages;
    totalWH += wh;
    rows.push([monthNames[m], wages.toFixed(2), wh.toFixed(2), monthlyData[m].employees.size]);
  }

  const uniqueEmps = new Set((lines ?? []).map((l: { user_id: string }) => l.user_id));
  rows.push(["Total", r2(totalWages).toFixed(2), r2(totalWH).toFixed(2), uniqueEmps.size]);

  return buildCsv(headers, rows);
}

// ---------------------------------------------------------------------------
// CSV: W-2 Summary (Annual, per-employee YTD from payroll_run_lines)
// ---------------------------------------------------------------------------

async function exportW2Csv(year: number): Promise<string> {
  const sb = getSupabase();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  // Get all posted/approved runs for the year
  const { data: runs, error: runsErr } = await sb
    .from("payroll_runs")
    .select("id")
    .in("status", ["posted", "approved"])
    .gte("pay_date", start)
    .lte("pay_date", end);

  if (runsErr) throw runsErr;
  if (!runs || runs.length === 0) {
    return buildCsv(
      ["Employee", "SSN_Last4", "Box1_Wages", "Box2_FederalWH", "Box3_SSWages", "Box4_SSTax", "Box5_MedicareWages", "Box6_MedicareTax", "Box17_StateWages", "Box18_StateWH"],
      [["No posted payroll runs found for this year.", "", "", "", "", "", "", "", "", ""]],
    );
  }

  const runIds = runs.map((r: { id: string }) => r.id);

  const { data: lines, error: linesErr } = await sb
    .from("payroll_run_lines")
    .select("user_id, employee_name, gross_pay, federal_wh, state_wh, ss_employee, medicare_employee")
    .in("payroll_run_id", runIds);

  if (linesErr) throw linesErr;

  // Aggregate per-employee
  const employees: Record<string, {
    name: string;
    gross_pay: number;
    federal_wh: number;
    state_wh: number;
    ss_employee: number;
    medicare_employee: number;
  }> = {};

  for (const line of lines ?? []) {
    if (!employees[line.user_id]) {
      employees[line.user_id] = {
        name: line.employee_name,
        gross_pay: 0,
        federal_wh: 0,
        state_wh: 0,
        ss_employee: 0,
        medicare_employee: 0,
      };
    }
    const emp = employees[line.user_id];
    emp.gross_pay += Number(line.gross_pay);
    emp.federal_wh += Number(line.federal_wh);
    emp.state_wh += Number(line.state_wh);
    emp.ss_employee += Number(line.ss_employee);
    emp.medicare_employee += Number(line.medicare_employee);
  }

  // Load SS wage base for Box 3 cap
  const tc = await loadTaxConstants(year);

  const headers = [
    "Employee", "SSN_Last4",
    "Box1_Wages", "Box2_FederalWH",
    "Box3_SSWages", "Box4_SSTax",
    "Box5_MedicareWages", "Box6_MedicareTax",
    "Box17_StateWages", "Box18_StateWH",
  ];
  const rows: (string | number)[][] = [];

  for (const empId of Object.keys(employees)) {
    const emp = employees[empId];
    const grossPay = r2(emp.gross_pay);
    const ssWages = r2(Math.min(emp.gross_pay, tc.SS_WAGE_BASE));
    rows.push([
      emp.name,
      "",                                      // SSN_Last4 — not stored in system, fill manually
      grossPay.toFixed(2),                      // Box 1: Wages, tips, other compensation
      r2(emp.federal_wh).toFixed(2),            // Box 2: Federal income tax withheld
      ssWages.toFixed(2),                       // Box 3: Social Security wages (capped)
      r2(emp.ss_employee).toFixed(2),           // Box 4: Social Security tax withheld
      grossPay.toFixed(2),                      // Box 5: Medicare wages (no cap)
      r2(emp.medicare_employee).toFixed(2),     // Box 6: Medicare tax withheld
      grossPay.toFixed(2),                      // Box 17: State wages
      r2(emp.state_wh).toFixed(2),              // Box 18: State income tax withheld
    ]);
  }

  return buildCsv(headers, rows);
}

// ---------------------------------------------------------------------------
// CSV: 1099 Summary (Annual, vendors with >= $600 in bill payments)
// ---------------------------------------------------------------------------

async function export1099Csv(year: number): Promise<string> {
  const sb = getSupabase();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  // Get all bill payments in the year, joined to bills for vendor_id
  const { data: payments, error: payErr } = await sb
    .from("bill_payments")
    .select("amount, bill_id, payment_date")
    .gte("payment_date", start)
    .lte("payment_date", end);

  if (payErr) throw payErr;

  if (!payments || payments.length === 0) {
    return buildCsv(
      ["Vendor", "Tax_ID", "Total_Payments", "Address"],
      [["No bill payments found for this year.", "", "", ""]],
    );
  }

  // Get the bills to map bill_id -> vendor_id
  const billIds = [...new Set(payments.map((p: { bill_id: string }) => p.bill_id))];
  const { data: bills, error: billErr } = await sb
    .from("bills")
    .select("id, vendor_id")
    .in("id", billIds);

  if (billErr) throw billErr;

  const billVendorMap: Record<string, string> = {};
  for (const bill of bills ?? []) {
    billVendorMap[bill.id] = bill.vendor_id;
  }

  // Aggregate payments per vendor
  const vendorTotals: Record<string, number> = {};
  for (const p of payments) {
    const vendorId = billVendorMap[p.bill_id];
    if (!vendorId) continue;
    vendorTotals[vendorId] = (vendorTotals[vendorId] || 0) + Number(p.amount);
  }

  // Filter vendors with >= $600 (1099-NEC threshold)
  const qualifyingVendorIds = Object.keys(vendorTotals).filter(
    (id) => vendorTotals[id] >= 600
  );

  if (qualifyingVendorIds.length === 0) {
    return buildCsv(
      ["Vendor", "Tax_ID", "Total_Payments", "Address"],
      [["No vendors with payments >= $600 for this year.", "", "", ""]],
    );
  }

  // Fetch vendor details
  const { data: vendors, error: vendorErr } = await sb
    .from("vendors")
    .select("id, company_name, tax_id, address")
    .in("id", qualifyingVendorIds);

  if (vendorErr) throw vendorErr;

  const vendorMap: Record<string, { company_name: string; tax_id: string | null; address: string | null }> = {};
  for (const v of vendors ?? []) {
    vendorMap[v.id] = { company_name: v.company_name, tax_id: v.tax_id, address: v.address };
  }

  const headers = ["Vendor", "Tax_ID", "Total_Payments", "Address"];
  const rows: (string | number)[][] = [];
  let grandTotal = 0;

  for (const vendorId of qualifyingVendorIds) {
    const v = vendorMap[vendorId];
    if (!v) continue;
    const total = r2(vendorTotals[vendorId]);
    grandTotal += total;
    rows.push([
      v.company_name,
      v.tax_id || "",
      total.toFixed(2),
      v.address || "",
    ]);
  }

  rows.push(["Total", "", r2(grandTotal).toFixed(2), ""]);

  return buildCsv(headers, rows);
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
  const format = params.get("format");
  const year = parseInt(params.get("year") || new Date().getFullYear().toString(), 10);
  const quarter = parseInt(params.get("quarter") || "1", 10);

  if (!report) {
    return NextResponse.json(
      { error: "Missing required query param: report (941, 940, state, w2, 1099)" },
      { status: 400 },
    );
  }

  if (format !== "csv") {
    return NextResponse.json(
      { error: "Missing or unsupported format. Use format=csv" },
      { status: 400 },
    );
  }

  try {
    switch (report) {
      case "941": {
        if (quarter < 1 || quarter > 4) {
          return NextResponse.json({ error: "Quarter must be 1-4" }, { status: 400 });
        }
        const csv = await export941Csv(year, quarter);
        return csvResponse(csv, `form_941_Q${quarter}_${year}.csv`);
      }

      case "940": {
        const csv = await export940Csv(year);
        return csvResponse(csv, `form_940_${year}.csv`);
      }

      case "state": {
        if (quarter < 1 || quarter > 4) {
          return NextResponse.json({ error: "Quarter must be 1-4" }, { status: 400 });
        }
        const csv = await exportStateCsv(year, quarter);
        return csvResponse(csv, `ky_withholding_Q${quarter}_${year}.csv`);
      }

      case "w2": {
        const csv = await exportW2Csv(year);
        return csvResponse(csv, `w2_summary_${year}.csv`);
      }

      case "1099": {
        const csv = await export1099Csv(year);
        return csvResponse(csv, `1099_summary_${year}.csv`);
      }

      default:
        return NextResponse.json(
          { error: `Unknown report type: ${report}. Use 941, 940, state, w2, or 1099.` },
          { status: 400 },
        );
    }
  } catch (err: unknown) {
    console.error("[TAX-REPORTS-EXPORT]", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
