import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

/**
 * GET /api/timesheets/[id]/pdf
 *
 * Generates a print-friendly HTML page for the given timesheet.
 * The user can print-to-PDF from their browser (avoids heavy PDF
 * library deps on Vercel serverless).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Get user info for role check
  let userName = "Unknown";
  let userRole = "operator";
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    userName = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
    userRole =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator";
  } catch {
    // Fall through with defaults
  }

  const isManager = userRole === "developer" || userRole === "manager";

  try {
    const sb = getSupabase();

    const { data, error } = await sb
      .from("timesheets")
      .select(
        "*, timesheet_daily_logs(*), timesheet_railroad_timecards(*), " +
        "timesheet_inspections(*), timesheet_ifta_entries(*), timesheet_expenses(*), " +
        "timesheet_maintenance_time(*), timesheet_shop_time(*), timesheet_mileage_pay(*), " +
        "timesheet_flight_pay(*), timesheet_holiday_pay(*), timesheet_vacation_pay(*)"
      )
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const ts = data as unknown as Record<string, unknown>;

    // Only owner or managers can view
    if (ts.user_id !== userId && !isManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get owner name (may be different from logged-in user for managers)
    let ownerName = (ts.user_name as string) || "Unknown";
    if (!ownerName || ownerName === "Unknown") {
      try {
        const client = await clerkClient();
        const owner = await client.users.getUser(ts.user_id as string);
        ownerName = owner.firstName
          ? `${owner.firstName} ${owner.lastName ?? ""}`.trim()
          : owner.emailAddresses?.[0]?.emailAddress ?? "Unknown";
      } catch {
        // Keep the stored name
      }
    }

    // Sort daily logs
    const dailyLogs = (
      (ts.timesheet_daily_logs as Record<string, unknown>[]) ?? []
    ).sort((a, b) => (a.sort_order as number) - (b.sort_order as number));

    // Compute totals
    let totalHours = 0;
    let totalTravel = 0;
    let totalLunch = 0;
    let totalMiles = 0;
    for (const log of dailyLogs) {
      totalHours += Number(log.hours_worked) || 0;
      totalTravel += Number(log.travel_hours) || 0;
      totalLunch += Number(log.lunch_minutes) || 0;
      totalMiles += Number(log.travel_miles) || 0;
    }

    const weekEnding = (ts.week_ending as string) || "";
    const status = (ts.status as string) || "draft";

    // Build HTML
    const html = buildTimesheetHtml({
      ownerName,
      weekEnding,
      status,
      railroad: (ts.railroad_working_on as string) || "",
      nsJobCode: (ts.norfolk_southern_job_code as string) || "",
      chaseVehicles: (ts.chase_vehicles as string[]) || [],
      semiTrucks: (ts.semi_trucks as string[]) || [],
      workLocation: (ts.work_location as string) || "",
      nightsOut: Number(ts.nights_out) || 0,
      layovers: Number(ts.layovers) || 0,
      iftaOdometerStart: ts.ifta_odometer_start as number | null,
      iftaOdometerEnd: ts.ifta_odometer_end as number | null,
      notes: (ts.notes as string) || "",
      dailyLogs,
      totalHours,
      totalTravel,
      totalLunch,
      totalMiles,
      railroadTimecards: (ts.timesheet_railroad_timecards as Record<string, unknown>[]) || [],
      inspections: (ts.timesheet_inspections as Record<string, unknown>[]) || [],
      iftaEntries: (ts.timesheet_ifta_entries as Record<string, unknown>[]) || [],
      expenses: (ts.timesheet_expenses as Record<string, unknown>[]) || [],
      maintenanceTime: (ts.timesheet_maintenance_time as Record<string, unknown>[]) || [],
      shopTime: (ts.timesheet_shop_time as Record<string, unknown>[]) || [],
      mileagePay: (ts.timesheet_mileage_pay as Record<string, unknown>[]) || [],
      flightPay: (ts.timesheet_flight_pay as Record<string, unknown>[]) || [],
      holidayPay: (ts.timesheet_holiday_pay as Record<string, unknown>[]) || [],
      vacationPay: (ts.timesheet_vacation_pay as Record<string, unknown>[]) || [],
      approvedBy: (ts.approved_by_name as string) || null,
      approvedAt: (ts.approved_at as string) || null,
      submittedAt: (ts.submitted_at as string) || null,
      rejectionReason: (ts.rejection_reason as string) || null,
    });

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="timesheet-${weekEnding}.html"`,
      },
    });
  } catch (err) {
    console.error("[API-ERROR]", `/api/timesheets/${id}/pdf GET`, err);
    return NextResponse.json(
      { error: "Failed to generate timesheet PDF" },
      { status: 502 },
    );
  }
}

// ── HTML Builder ──────────────────────────────────────────────────────

interface TimesheetPdfData {
  ownerName: string;
  weekEnding: string;
  status: string;
  railroad: string;
  nsJobCode: string;
  chaseVehicles: string[];
  semiTrucks: string[];
  workLocation: string;
  nightsOut: number;
  layovers: number;
  iftaOdometerStart: number | null;
  iftaOdometerEnd: number | null;
  notes: string;
  dailyLogs: Record<string, unknown>[];
  totalHours: number;
  totalTravel: number;
  totalLunch: number;
  totalMiles: number;
  railroadTimecards: Record<string, unknown>[];
  inspections: Record<string, unknown>[];
  iftaEntries: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  maintenanceTime: Record<string, unknown>[];
  shopTime: Record<string, unknown>[];
  mileagePay: Record<string, unknown>[];
  flightPay: Record<string, unknown>[];
  holidayPay: Record<string, unknown>[];
  vacationPay: Record<string, unknown>[];
  approvedBy: string | null;
  approvedAt: string | null;
  submittedAt: string | null;
  rejectionReason: string | null;
}

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  try {
    const dt = new Date(d + (d.includes("T") ? "" : "T12:00:00"));
    return dt.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

function fmtShortDate(d: string | null | undefined): string {
  if (!d) return "";
  try {
    const dt = new Date(d + (d.includes("T") ? "" : "T12:00:00"));
    return dt.toLocaleDateString("en-US", {
      weekday: "short",
      month: "numeric",
      day: "numeric",
    });
  } catch {
    return d;
  }
}

function fmtTime(t: string | null | undefined): string {
  if (!t) return "";
  // Time is stored as HH:mm
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function fmtTimestamp(d: string | null | undefined): string {
  if (!d) return "";
  try {
    const dt = new Date(d);
    return dt.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return d;
  }
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return `$${Number(n).toFixed(2)}`;
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    draft: "#6b7280",
    submitted: "#3b82f6",
    approved: "#22c55e",
    rejected: "#ef4444",
  };
  const color = colors[status] || "#6b7280";
  return `<span style="display:inline-block;padding:2px 10px;border-radius:4px;background:${color};color:#fff;font-size:12px;font-weight:600;text-transform:uppercase;">${esc(status)}</span>`;
}

function buildTimesheetHtml(d: TimesheetPdfData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Timesheet - ${esc(d.ownerName)} - ${esc(d.weekEnding)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 12px;
    color: #111;
    background: #fff;
    padding: 24px;
    line-height: 1.4;
  }
  .header {
    text-align: center;
    margin-bottom: 20px;
    border-bottom: 3px solid #111;
    padding-bottom: 12px;
  }
  .header h1 {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 1px;
    margin-bottom: 2px;
  }
  .header h2 {
    font-size: 16px;
    font-weight: 600;
    color: #333;
  }
  .meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding: 8px 0;
    border-bottom: 1px solid #ddd;
  }
  .meta-row .employee { font-size: 14px; font-weight: 600; }
  .meta-row .week { font-size: 13px; color: #444; }
  .field-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px 16px;
    margin-bottom: 16px;
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fafafa;
  }
  .field-grid .field { }
  .field-grid .field label {
    display: block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: #666;
    margin-bottom: 2px;
  }
  .field-grid .field .val {
    font-size: 12px;
    font-weight: 500;
    color: #111;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
    font-size: 11px;
  }
  th, td {
    border: 1px solid #bbb;
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #e5e7eb;
    font-weight: 700;
    font-size: 10px;
    text-transform: uppercase;
    color: #333;
  }
  tr:nth-child(even) td { background: #f9fafb; }
  .totals-row td {
    font-weight: 700;
    background: #e5e7eb !important;
    border-top: 2px solid #111;
  }
  .section-title {
    font-size: 13px;
    font-weight: 700;
    margin: 20px 0 6px;
    padding: 4px 8px;
    background: #111;
    color: #fff;
    border-radius: 3px;
  }
  .approval-box {
    margin-top: 24px;
    padding: 12px;
    border: 2px solid #111;
    border-radius: 4px;
  }
  .approval-box h3 {
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 8px;
  }
  .sig-line {
    display: flex;
    justify-content: space-between;
    margin-top: 24px;
    gap: 40px;
  }
  .sig-line .sig {
    flex: 1;
    border-top: 1px solid #111;
    padding-top: 4px;
    font-size: 10px;
    color: #666;
  }
  .notes-box {
    margin-top: 12px;
    padding: 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fafafa;
    font-size: 11px;
    white-space: pre-wrap;
  }
  .no-data { color: #999; font-style: italic; font-size: 11px; padding: 6px; }
  .print-btn {
    position: fixed;
    top: 16px;
    right: 16px;
    padding: 10px 20px;
    background: #111;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    z-index: 1000;
  }
  .print-btn:hover { background: #333; }

  @media print {
    body { padding: 12px; }
    .print-btn { display: none !important; }
    .no-print { display: none !important; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    .section-title { page-break-after: avoid; }
  }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>

<div class="header">
  <h1>B &amp; B Metals, INC.</h1>
  <h2>Timesheet</h2>
</div>

<div class="meta-row">
  <span class="employee">${esc(d.ownerName)}</span>
  <span class="week">Week Ending: <strong>${fmtDate(d.weekEnding)}</strong></span>
  <span>${statusBadge(d.status)}</span>
</div>

<!-- Header fields -->
<div class="field-grid">
  <div class="field">
    <label>Railroad</label>
    <div class="val">${esc(d.railroad) || "&mdash;"}</div>
  </div>
  <div class="field">
    <label>Chase Vehicles</label>
    <div class="val">${d.chaseVehicles.length > 0 ? d.chaseVehicles.map(esc).join(", ") : "&mdash;"}</div>
  </div>
  <div class="field">
    <label>Semi Trucks</label>
    <div class="val">${d.semiTrucks.length > 0 ? d.semiTrucks.map(esc).join(", ") : "&mdash;"}</div>
  </div>
  <div class="field">
    <label>Work Location</label>
    <div class="val">${esc(d.workLocation) || "&mdash;"}</div>
  </div>
  <div class="field">
    <label>Nights Out</label>
    <div class="val">${d.nightsOut}</div>
  </div>
  <div class="field">
    <label>Layovers</label>
    <div class="val">${d.layovers}</div>
  </div>
  ${d.nsJobCode ? `<div class="field">
    <label>NS Job Code</label>
    <div class="val">${esc(d.nsJobCode)}</div>
  </div>` : ""}
  <div class="field">
    <label>IFTA Odometer Start</label>
    <div class="val">${d.iftaOdometerStart != null ? d.iftaOdometerStart.toLocaleString() : "&mdash;"}</div>
  </div>
  <div class="field">
    <label>IFTA Odometer End</label>
    <div class="val">${d.iftaOdometerEnd != null ? d.iftaOdometerEnd.toLocaleString() : "&mdash;"}</div>
  </div>
</div>

<!-- Daily Logs -->
<div class="section-title">Daily Logs</div>
${d.dailyLogs.length > 0 ? `
<table>
  <thead>
    <tr>
      <th>Date</th>
      <th>Start</th>
      <th>End</th>
      <th>Hours</th>
      <th>Travel Hrs</th>
      <th>Lunch</th>
      <th>From</th>
      <th>To</th>
      <th>Miles</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    ${d.dailyLogs.map((log) => `<tr>
      <td>${fmtShortDate(log.log_date as string)}</td>
      <td>${fmtTime(log.start_time as string)}</td>
      <td>${fmtTime(log.end_time as string)}</td>
      <td>${Number(log.hours_worked) || 0}</td>
      <td>${Number(log.travel_hours) || 0}</td>
      <td>${Number(log.lunch_minutes) || 0}m</td>
      <td>${esc(log.traveling_from as string)}</td>
      <td>${esc(log.destination as string)}</td>
      <td>${log.travel_miles != null ? Number(log.travel_miles) : ""}</td>
      <td>${esc(log.description as string)}</td>
    </tr>`).join("\n    ")}
    <tr class="totals-row">
      <td>TOTALS</td>
      <td></td>
      <td></td>
      <td>${d.totalHours.toFixed(2)}</td>
      <td>${d.totalTravel.toFixed(2)}</td>
      <td>${d.totalLunch}m</td>
      <td></td>
      <td></td>
      <td>${d.totalMiles > 0 ? d.totalMiles : ""}</td>
      <td></td>
    </tr>
  </tbody>
</table>` : '<p class="no-data">No daily log entries.</p>'}

${buildRailroadTimecardsSection(d.railroadTimecards)}
${buildInspectionsSection(d.inspections)}
${buildIftaSection(d.iftaEntries)}
${buildExpensesSection(d.expenses)}
${buildMaintenanceSection(d.maintenanceTime)}
${buildShopTimeSection(d.shopTime)}
${buildMileageSection(d.mileagePay)}
${buildFlightSection(d.flightPay)}
${buildHolidaySection(d.holidayPay)}
${buildVacationSection(d.vacationPay)}

${d.notes ? `<div class="section-title">Notes</div>
<div class="notes-box">${esc(d.notes)}</div>` : ""}

<!-- Approval & Signatures -->
<div class="approval-box">
  <h3>Approval Status</h3>
  <table style="border:none;margin:0;">
    <tr><td style="border:none;font-weight:600;width:140px;">Status:</td><td style="border:none;">${statusBadge(d.status)}</td></tr>
    ${d.submittedAt ? `<tr><td style="border:none;font-weight:600;">Submitted:</td><td style="border:none;">${fmtTimestamp(d.submittedAt)}</td></tr>` : ""}
    ${d.approvedBy ? `<tr><td style="border:none;font-weight:600;">Approved By:</td><td style="border:none;">${esc(d.approvedBy)}</td></tr>` : ""}
    ${d.approvedAt ? `<tr><td style="border:none;font-weight:600;">Approved At:</td><td style="border:none;">${fmtTimestamp(d.approvedAt)}</td></tr>` : ""}
    ${d.rejectionReason ? `<tr><td style="border:none;font-weight:600;">Rejection Reason:</td><td style="border:none;color:#ef4444;">${esc(d.rejectionReason)}</td></tr>` : ""}
  </table>

  <div class="sig-line">
    <div class="sig">Employee Signature</div>
    <div class="sig">Date</div>
    <div class="sig">Supervisor Signature</div>
    <div class="sig">Date</div>
  </div>
</div>

</body>
</html>`;
}

// ── Sub-section renderers ─────────────────────────────────────────────

function buildRailroadTimecardsSection(entries: Record<string, unknown>[]): string {
  if (!entries.length) return "";
  return `<div class="section-title">Railroad Timecards</div>
<table>
  <thead><tr><th>Railroad</th><th>Track Supervisor</th><th>Division Engineer</th></tr></thead>
  <tbody>
    ${entries.map((e) => `<tr>
      <td>${esc(e.railroad as string)}</td>
      <td>${esc(e.track_supervisor as string)}</td>
      <td>${esc(e.division_engineer as string)}</td>
    </tr>`).join("\n    ")}
  </tbody>
</table>`;
}

function buildInspectionsSection(entries: Record<string, unknown>[]): string {
  if (!entries.length) return "";
  return `<div class="section-title">Inspections</div>
<table>
  <thead><tr><th>Time</th><th>Notes</th></tr></thead>
  <tbody>
    ${entries.map((e) => `<tr>
      <td>${fmtTimestamp(e.inspection_time as string)}</td>
      <td>${esc(e.notes as string)}</td>
    </tr>`).join("\n    ")}
  </tbody>
</table>`;
}

function buildIftaSection(entries: Record<string, unknown>[]): string {
  if (!entries.length) return "";
  let totalMiles = 0;
  let totalGallons = 0;
  for (const e of entries) {
    totalMiles += Number(e.reportable_miles) || 0;
    totalGallons += Number(e.gallons_purchased) || 0;
  }
  return `<div class="section-title">IFTA</div>
<table>
  <thead><tr><th>State</th><th>Reportable Miles</th><th>Gallons Purchased</th></tr></thead>
  <tbody>
    ${entries.map((e) => `<tr>
      <td>${esc(e.state_code as string)}</td>
      <td>${Number(e.reportable_miles) || 0}</td>
      <td>${Number(e.gallons_purchased) || 0}</td>
    </tr>`).join("\n    ")}
    <tr class="totals-row">
      <td>TOTALS</td>
      <td>${totalMiles}</td>
      <td>${totalGallons.toFixed(1)}</td>
    </tr>
  </tbody>
</table>`;
}

function buildExpensesSection(entries: Record<string, unknown>[]): string {
  if (!entries.length) return "";
  let total = 0;
  for (const e of entries) total += Number(e.amount) || 0;
  return `<div class="section-title">Expenses</div>
<table>
  <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Payment</th><th>Reimburse?</th></tr></thead>
  <tbody>
    ${entries.map((e) => `<tr>
      <td>${fmtShortDate(e.expense_date as string)}</td>
      <td>${esc(e.category as string)}</td>
      <td>${esc(e.description as string)}</td>
      <td>${fmtMoney(e.amount as number)}</td>
      <td>${esc(e.payment_type as string)}</td>
      <td>${e.needs_reimbursement ? "Yes" : "No"}</td>
    </tr>`).join("\n    ")}
    <tr class="totals-row">
      <td colspan="3">TOTAL</td>
      <td>${fmtMoney(total)}</td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>`;
}

function buildMaintenanceSection(entries: Record<string, unknown>[]): string {
  if (!entries.length) return "";
  let totalHrs = 0;
  for (const e of entries) totalHrs += Number(e.hours_worked) || 0;
  return `<div class="section-title">Maintenance Time</div>
<table>
  <thead><tr><th>Date</th><th>Start</th><th>Stop</th><th>Hours</th><th>Description</th><th>Parts Used</th></tr></thead>
  <tbody>
    ${entries.map((e) => `<tr>
      <td>${fmtShortDate(e.log_date as string)}</td>
      <td>${fmtTime(e.start_time as string)}</td>
      <td>${fmtTime(e.stop_time as string)}</td>
      <td>${Number(e.hours_worked) || 0}</td>
      <td>${esc(e.description as string)}</td>
      <td>${esc(e.parts_used as string)}</td>
    </tr>`).join("\n    ")}
    <tr class="totals-row">
      <td colspan="3">TOTAL</td>
      <td>${totalHrs.toFixed(2)}</td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>`;
}

function buildShopTimeSection(entries: Record<string, unknown>[]): string {
  if (!entries.length) return "";
  let totalHrs = 0;
  for (const e of entries) totalHrs += Number(e.hours_worked) || 0;
  return `<div class="section-title">Shop Time</div>
<table>
  <thead><tr><th>Date</th><th>Start</th><th>Stop</th><th>Lunch</th><th>Hours</th></tr></thead>
  <tbody>
    ${entries.map((e) => `<tr>
      <td>${fmtShortDate(e.log_date as string)}</td>
      <td>${fmtTime(e.start_time as string)}</td>
      <td>${fmtTime(e.stop_time as string)}</td>
      <td>${Number(e.lunch_minutes) || 0}m</td>
      <td>${Number(e.hours_worked) || 0}</td>
    </tr>`).join("\n    ")}
    <tr class="totals-row">
      <td colspan="4">TOTAL</td>
      <td>${totalHrs.toFixed(2)}</td>
    </tr>
  </tbody>
</table>`;
}

function buildMileageSection(entries: Record<string, unknown>[]): string {
  if (!entries.length) return "";
  let totalMi = 0;
  for (const e of entries) totalMi += Number(e.miles) || 0;
  return `<div class="section-title">Mileage Pay</div>
<table>
  <thead><tr><th>Date</th><th>From</th><th>To</th><th>Miles</th><th>Chase Vehicle</th><th>Description</th></tr></thead>
  <tbody>
    ${entries.map((e) => `<tr>
      <td>${fmtShortDate(e.log_date as string)}</td>
      <td>${esc(e.traveling_from as string)}</td>
      <td>${esc(e.destination as string)}</td>
      <td>${Number(e.miles) || 0}</td>
      <td>${esc(e.chase_vehicle as string)}</td>
      <td>${esc(e.description as string)}</td>
    </tr>`).join("\n    ")}
    <tr class="totals-row">
      <td colspan="3">TOTAL</td>
      <td>${totalMi}</td>
      <td></td>
      <td></td>
    </tr>
  </tbody>
</table>`;
}

function buildFlightSection(entries: Record<string, unknown>[]): string {
  if (!entries.length) return "";
  return `<div class="section-title">Flight Pay</div>
<table>
  <thead><tr><th>Date</th><th>From</th><th>To</th></tr></thead>
  <tbody>
    ${entries.map((e) => `<tr>
      <td>${fmtShortDate(e.log_date as string)}</td>
      <td>${esc(e.traveling_from as string)}</td>
      <td>${esc(e.destination as string)}</td>
    </tr>`).join("\n    ")}
  </tbody>
</table>`;
}

function buildHolidaySection(entries: Record<string, unknown>[]): string {
  if (!entries.length) return "";
  return `<div class="section-title">Holiday Pay</div>
<table>
  <thead><tr><th>Holiday Date</th></tr></thead>
  <tbody>
    ${entries.map((e) => `<tr>
      <td>${fmtDate(e.holiday_date as string)}</td>
    </tr>`).join("\n    ")}
  </tbody>
</table>`;
}

function buildVacationSection(entries: Record<string, unknown>[]): string {
  if (!entries.length) return "";
  let totalHrs = 0;
  for (const e of entries) totalHrs += Number(e.total_hours) || 0;
  return `<div class="section-title">Vacation Pay</div>
<table>
  <thead><tr><th>Start Date</th><th>End Date</th><th>Hours/Day</th><th>Total Hours</th></tr></thead>
  <tbody>
    ${entries.map((e) => `<tr>
      <td>${fmtDate(e.start_date as string)}</td>
      <td>${fmtDate(e.end_date as string)}</td>
      <td>${Number(e.hours_per_day) || 0}</td>
      <td>${Number(e.total_hours) || 0}</td>
    </tr>`).join("\n    ")}
    <tr class="totals-row">
      <td colspan="3">TOTAL</td>
      <td>${totalHrs.toFixed(2)}</td>
    </tr>
  </tbody>
</table>`;
}
