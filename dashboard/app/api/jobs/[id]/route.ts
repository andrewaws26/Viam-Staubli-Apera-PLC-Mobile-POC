import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

async function checkFinanceRole(userId: string) {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const role = (user.publicMetadata as { role?: string }).role;
  return role && ["developer", "manager"].includes(role);
}

type Params = { params: Promise<{ id: string }> };

/** GET — full job detail with cost aggregation from all sources */
export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkFinanceRole(userId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const sb = getSupabase();

  const [jobRes, costsRes, tsRes, invoicesRes, billsRes, estimatesRes] =
    await Promise.all([
      sb
        .from("jobs")
        .select("*, customers(company_name, contact_name)")
        .eq("id", id)
        .single(),
      sb
        .from("job_cost_entries")
        .select("*")
        .eq("job_id", id)
        .order("date", { ascending: false }),
      sb
        .from("timesheets")
        .select(
          "id, user_id, user_name, week_ending, status, nights_out, layovers",
        )
        .eq("job_id", id),
      sb
        .from("invoices")
        .select(
          "id, invoice_number, status, total, amount_paid, balance_due, invoice_date",
        )
        .eq("job_id", id)
        .order("invoice_date", { ascending: false }),
      sb
        .from("bills")
        .select(
          "id, bill_number, status, total, amount_paid, bill_date, vendors(company_name)",
        )
        .eq("job_id", id)
        .order("bill_date", { ascending: false }),
      sb
        .from("estimates")
        .select("id, estimate_number, status, total, estimate_date")
        .eq("job_id", id),
    ]);

  if (jobRes.error)
    return NextResponse.json({ error: jobRes.error.message }, { status: 404 });

  // Labor from approved timesheets
  const approvedTs = (tsRes.data || []).filter(
    (t) => t.status === "approved",
  );
  let laborByEmployee: {
    user_id: string;
    name: string;
    hours: number;
    rate: number;
    cost: number;
  }[] = [];
  let totalPerDiem = 0;

  if (approvedTs.length > 0) {
    const tsIds = approvedTs.map((t) => t.id);
    const userIds = [...new Set(approvedTs.map((t) => t.user_id))];

    const [logsRes, profilesRes, pdRes] = await Promise.all([
      sb
        .from("timesheet_daily_logs")
        .select("timesheet_id, hours_worked")
        .in("timesheet_id", tsIds),
      sb
        .from("employee_tax_profiles")
        .select("user_id, hourly_rate")
        .in("user_id", userIds),
      sb
        .from("per_diem_entries")
        .select("timesheet_id, total_amount")
        .in("timesheet_id", tsIds),
    ]);

    const rateByUser: Record<string, number> = {};
    (profilesRes.data || []).forEach((p) => {
      rateByUser[p.user_id] = parseFloat(p.hourly_rate) || 0;
    });

    const hoursByTs: Record<string, number> = {};
    (logsRes.data || []).forEach((l) => {
      hoursByTs[l.timesheet_id] =
        (hoursByTs[l.timesheet_id] || 0) +
        (parseFloat(l.hours_worked) || 0);
    });

    // Aggregate hours per employee
    const empMap: Record<string, { name: string; hours: number }> = {};
    approvedTs.forEach((ts) => {
      if (!empMap[ts.user_id])
        empMap[ts.user_id] = { name: ts.user_name, hours: 0 };
      empMap[ts.user_id].hours += hoursByTs[ts.id] || 0;
    });

    laborByEmployee = Object.entries(empMap).map(([uid, d]) => {
      const rate = rateByUser[uid] || 0;
      return {
        user_id: uid,
        name: d.name,
        hours: Math.round(d.hours * 100) / 100,
        rate,
        cost: Math.round(d.hours * rate * 100) / 100,
      };
    });

    (pdRes.data || []).forEach((p) => {
      totalPerDiem += parseFloat(p.total_amount) || 0;
    });
  }

  // Aggregate cost entries by type
  const costEntries = costsRes.data || [];
  const costsByType: Record<string, number> = {};
  costEntries.forEach((e) => {
    costsByType[e.cost_type] =
      (costsByType[e.cost_type] || 0) + parseFloat(e.amount);
  });

  // Add computed labor + per diem
  const laborTotal = laborByEmployee.reduce((s, e) => s + e.cost, 0);
  if (laborTotal > 0)
    costsByType.labor = (costsByType.labor || 0) + laborTotal;
  if (totalPerDiem > 0)
    costsByType.per_diem = (costsByType.per_diem || 0) + totalPerDiem;

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const totalCosts = Object.values(costsByType).reduce((a, b) => a + b, 0);
  const invoices = (invoicesRes.data || []).filter(
    (i) => i.status !== "voided",
  );
  const totalRevenue = invoices.reduce(
    (s, i) => s + parseFloat(i.total),
    0,
  );
  const profit = totalRevenue - totalCosts;
  const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

  return NextResponse.json({
    job: jobRes.data,
    cost_entries: costEntries,
    labor: {
      total: r2(laborTotal),
      per_diem: r2(totalPerDiem),
      by_employee: laborByEmployee,
    },
    timesheets: tsRes.data || [],
    invoices: invoicesRes.data || [],
    bills: billsRes.data || [],
    estimates: estimatesRes.data || [],
    summary: {
      total_costs: r2(totalCosts),
      costs_by_type: Object.fromEntries(
        Object.entries(costsByType).map(([k, v]) => [k, r2(v)]),
      ),
      total_revenue: r2(totalRevenue),
      profit: r2(profit),
      margin: Math.round(margin * 10) / 10,
    },
  });
}

/** PATCH — update job fields */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkFinanceRole(userId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const sb = getSupabase();

  const allowed = [
    "name",
    "description",
    "status",
    "job_type",
    "location",
    "bid_amount",
    "contract_amount",
    "start_date",
    "end_date",
    "estimated_hours",
    "notes",
    "customer_id",
  ];
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  allowed.forEach((k) => {
    if (body[k] !== undefined) updates[k] = body[k];
  });

  const { data, error } = await sb
    .from("jobs")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** DELETE — remove a job and its cost entries */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkFinanceRole(userId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const sb = getSupabase();
  const { error } = await sb.from("jobs").delete().eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
