import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

async function getUserRole(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return ((user.publicMetadata as Record<string, unknown>)?.role as string) || "operator";
  } catch {
    return "operator";
  }
}

/**
 * GET /api/executive
 * Aggregated executive dashboard data: cash position, AR/AP aging,
 * job margins, payroll snapshot, overdue invoices, crew utilization,
 * recent activity. Manager/developer only.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(userId);
  if (role !== "developer" && role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const sb = getSupabase();
    const today = new Date().toISOString().split("T")[0];

    // Run all queries in parallel
    const [
      cashRes,
      arInvoicesRes,
      apBillsRes,
      jobsRes,
      jobCostsRes,
      jobInvoicesRes,
      timesheetsRes,
      dailyLogsRes,
      taxProfilesRes,
      pendingTimesheetsRes,
      ptoRes,
      recentActivityRes,
    ] = await Promise.all([
      // 1. Cash position — bank accounts
      sb.from("bank_accounts").select("id, account_name, account_type, current_balance"),

      // 2. AR — open invoices for aging
      sb.from("invoices")
        .select("id, invoice_number, customer_id, customers(company_name), invoice_date, due_date, total, balance_due, status")
        .in("status", ["sent", "partial", "overdue"])
        .gt("balance_due", 0),

      // 3. AP — open bills for aging
      sb.from("bills")
        .select("id, bill_number, vendor_id, vendors(company_name), bill_date, due_date, total, balance_due, status")
        .in("status", ["open", "partial"])
        .gt("balance_due", 0),

      // 4. Active jobs
      sb.from("jobs")
        .select("id, job_number, name, status, customer_id, bid_amount, contract_amount")
        .in("status", ["active", "bidding"]),

      // 5. Job cost entries for active jobs
      sb.from("job_cost_entries")
        .select("job_id, amount"),

      // 6. Job-linked invoices (revenue)
      sb.from("invoices")
        .select("job_id, total, status")
        .not("job_id", "is", null)
        .neq("status", "voided"),

      // 7. Recent timesheets (last 4 weeks) for crew utilization
      sb.from("timesheets")
        .select("id, user_id, user_name, week_ending, status, job_id")
        .gte("week_ending", new Date(Date.now() - 28 * 86400000).toISOString().split("T")[0])
        .order("week_ending", { ascending: false }),

      // 8. Daily logs for those timesheets
      sb.from("timesheet_daily_logs")
        .select("timesheet_id, hours_worked, travel_hours"),

      // 9. Employee tax profiles (hourly rates)
      sb.from("employee_tax_profiles")
        .select("user_id, hourly_rate, employee_name"),

      // 10. Pending timesheets awaiting approval
      sb.from("timesheets")
        .select("id, user_name, week_ending")
        .eq("status", "submitted")
        .order("week_ending", { ascending: false })
        .limit(10),

      // 11. Pending PTO requests
      sb.from("pto_requests")
        .select("id, user_id, start_date, end_date, hours_requested, pto_type, status")
        .eq("status", "pending")
        .limit(10),

      // 12. Recent audit activity
      sb.from("audit_log")
        .select("id, action, user_name, details, created_at")
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    // --- Compute Cash Position ---
    const bankAccounts = cashRes.data ?? [];
    const totalCash = bankAccounts.reduce((s, a) => s + (Number(a.current_balance) || 0), 0);

    // --- Compute AR Aging ---
    const arInvoices = arInvoicesRes.data ?? [];
    const arAging = { current: 0, days_30: 0, days_60: 0, days_90: 0, days_120_plus: 0, total: 0, count: 0 };
    for (const inv of arInvoices) {
      const bal = Number(inv.balance_due) || 0;
      const daysOld = Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000);
      arAging.total += bal;
      arAging.count++;
      if (daysOld <= 0) arAging.current += bal;
      else if (daysOld <= 30) arAging.days_30 += bal;
      else if (daysOld <= 60) arAging.days_60 += bal;
      else if (daysOld <= 90) arAging.days_90 += bal;
      else arAging.days_120_plus += bal;
    }

    // --- Compute AP Aging ---
    const apBills = apBillsRes.data ?? [];
    const apAging = { current: 0, days_30: 0, days_60: 0, days_90: 0, days_120_plus: 0, total: 0, count: 0 };
    for (const bill of apBills) {
      const bal = Number(bill.balance_due) || 0;
      const daysOld = Math.floor((Date.now() - new Date(bill.due_date).getTime()) / 86400000);
      apAging.total += bal;
      apAging.count++;
      if (daysOld <= 0) apAging.current += bal;
      else if (daysOld <= 30) apAging.days_30 += bal;
      else if (daysOld <= 60) apAging.days_60 += bal;
      else if (daysOld <= 90) apAging.days_90 += bal;
      else apAging.days_120_plus += bal;
    }

    // Overdue invoices (past due date)
    const overdueInvoices = arInvoices
      .filter((inv) => new Date(inv.due_date) < new Date(today))
      .map((inv) => ({
        id: inv.id,
        invoice_number: inv.invoice_number,
        customer: (inv.customers as unknown as { company_name: string })?.company_name ?? "Unknown",
        due_date: inv.due_date,
        balance_due: Number(inv.balance_due),
        days_overdue: Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000),
      }))
      .sort((a, b) => b.days_overdue - a.days_overdue)
      .slice(0, 10);

    // --- Job Margins ---
    const jobs = jobsRes.data ?? [];
    const costEntries = jobCostsRes.data ?? [];
    const jobInvoices = jobInvoicesRes.data ?? [];

    // Aggregate costs per job
    const costsByJob: Record<string, number> = {};
    for (const c of costEntries) {
      if (c.job_id) costsByJob[c.job_id] = (costsByJob[c.job_id] || 0) + (Number(c.amount) || 0);
    }
    // Aggregate revenue per job
    const revByJob: Record<string, number> = {};
    for (const i of jobInvoices) {
      if (i.job_id) revByJob[i.job_id] = (revByJob[i.job_id] || 0) + (Number(i.total) || 0);
    }

    const jobSummaries = jobs.map((j) => {
      const costs = costsByJob[j.id] || 0;
      const revenue = revByJob[j.id] || 0;
      const profit = revenue - costs;
      const margin = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
      return {
        id: j.id,
        job_number: j.job_number,
        name: j.name,
        status: j.status,
        bid_amount: Number(j.bid_amount) || 0,
        contract_amount: Number(j.contract_amount) || 0,
        costs: Math.round(costs * 100) / 100,
        revenue: Math.round(revenue * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        margin,
      };
    });

    const totalJobCosts = jobSummaries.reduce((s, j) => s + j.costs, 0);
    const totalJobRevenue = jobSummaries.reduce((s, j) => s + j.revenue, 0);
    const avgMargin = totalJobRevenue > 0
      ? Math.round(((totalJobRevenue - totalJobCosts) / totalJobRevenue) * 1000) / 10
      : 0;

    // --- Crew Utilization (last 4 weeks) ---
    const timesheets = timesheetsRes.data ?? [];
    const dailyLogs = dailyLogsRes.data ?? [];
    const taxProfiles = taxProfilesRes.data ?? [];

    // Map timesheet IDs to user info
    const tsById: Record<string, { user_id: string; user_name: string; status: string }> = {};
    for (const ts of timesheets) tsById[ts.id] = { user_id: ts.user_id, user_name: ts.user_name, status: ts.status };

    // Aggregate hours per user
    const userHours: Record<string, { name: string; hours: number; travel: number; weeks: Set<string> }> = {};
    for (const log of dailyLogs) {
      const ts = tsById[log.timesheet_id];
      if (!ts) continue;
      if (!userHours[ts.user_id]) {
        userHours[ts.user_id] = { name: ts.user_name, hours: 0, travel: 0, weeks: new Set() };
      }
      userHours[ts.user_id].hours += Number(log.hours_worked) || 0;
      userHours[ts.user_id].travel += Number(log.travel_hours) || 0;
      // Find the week_ending for this timesheet
      const parentTs = timesheets.find((t) => t.id === log.timesheet_id);
      if (parentTs) userHours[ts.user_id].weeks.add(parentTs.week_ending);
    }

    const rateMap: Record<string, number> = {};
    for (const p of taxProfiles) rateMap[p.user_id] = Number(p.hourly_rate) || 0;

    const crewUtilization = Object.entries(userHours).map(([uid, data]) => {
      const weeksCount = data.weeks.size || 1;
      const avgHoursPerWeek = Math.round((data.hours / weeksCount) * 10) / 10;
      const utilization = Math.round((avgHoursPerWeek / 40) * 1000) / 10;
      return {
        user_id: uid,
        name: data.name,
        total_hours: Math.round(data.hours * 10) / 10,
        total_travel: Math.round(data.travel * 10) / 10,
        weeks: weeksCount,
        avg_hours_per_week: avgHoursPerWeek,
        utilization_pct: Math.min(utilization, 200), // cap display at 200%
        hourly_rate: rateMap[uid] || 0,
      };
    }).sort((a, b) => b.total_hours - a.total_hours);

    const avgUtilization = crewUtilization.length > 0
      ? Math.round(crewUtilization.reduce((s, c) => s + c.utilization_pct, 0) / crewUtilization.length * 10) / 10
      : 0;

    // --- Payroll Estimate (next run based on current approved + submitted timesheets) ---
    const approvedTimesheets = timesheets.filter((ts) => ts.status === "approved" || ts.status === "submitted");
    let estimatedGrossPayroll = 0;
    for (const ts of approvedTimesheets) {
      const logs = dailyLogs.filter((l) => l.timesheet_id === ts.id);
      const hours = logs.reduce((s, l) => s + (Number(l.hours_worked) || 0), 0);
      const rate = rateMap[ts.user_id] || 25; // default $25/hr if no profile
      estimatedGrossPayroll += hours * rate;
    }
    estimatedGrossPayroll = Math.round(estimatedGrossPayroll * 100) / 100;

    return NextResponse.json({
      as_of: today,

      cash: {
        total: Math.round(totalCash * 100) / 100,
        accounts: bankAccounts.map((a) => ({
          id: a.id,
          name: a.account_name,
          type: a.account_type,
          balance: Number(a.current_balance) || 0,
        })),
      },

      ar: {
        ...arAging,
        current: Math.round(arAging.current * 100) / 100,
        days_30: Math.round(arAging.days_30 * 100) / 100,
        days_60: Math.round(arAging.days_60 * 100) / 100,
        days_90: Math.round(arAging.days_90 * 100) / 100,
        days_120_plus: Math.round(arAging.days_120_plus * 100) / 100,
        total: Math.round(arAging.total * 100) / 100,
        overdue_invoices: overdueInvoices,
      },

      ap: {
        ...apAging,
        current: Math.round(apAging.current * 100) / 100,
        days_30: Math.round(apAging.days_30 * 100) / 100,
        days_60: Math.round(apAging.days_60 * 100) / 100,
        days_90: Math.round(apAging.days_90 * 100) / 100,
        days_120_plus: Math.round(apAging.days_120_plus * 100) / 100,
        total: Math.round(apAging.total * 100) / 100,
      },

      jobs: {
        active_count: jobSummaries.filter((j) => j.status === "active").length,
        bidding_count: jobSummaries.filter((j) => j.status === "bidding").length,
        total_costs: Math.round(totalJobCosts * 100) / 100,
        total_revenue: Math.round(totalJobRevenue * 100) / 100,
        avg_margin: avgMargin,
        items: jobSummaries,
      },

      payroll: {
        estimated_gross: estimatedGrossPayroll,
        pending_timesheets: (pendingTimesheetsRes.data ?? []).length,
        pending_items: pendingTimesheetsRes.data ?? [],
        pending_pto: (ptoRes.data ?? []).length,
      },

      crew: {
        avg_utilization: avgUtilization,
        employees: crewUtilization,
      },

      recent_activity: (recentActivityRes.data ?? []).map((a) => ({
        id: a.id,
        action: a.action,
        user: a.user_name,
        details: a.details,
        at: a.created_at,
      })),
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/executive GET", err);
    return NextResponse.json({ error: "Failed to load executive dashboard" }, { status: 502 });
  }
}
