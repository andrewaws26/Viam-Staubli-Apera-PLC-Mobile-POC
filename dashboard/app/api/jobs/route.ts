import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

async function checkFinanceRole(userId: string) {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const role = (user.publicMetadata as { role?: string }).role;
  return role && ["developer", "manager"].includes(role);
}

/** GET — list all jobs with profitability metrics */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkFinanceRole(userId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sb = getSupabase();

  const [jobsRes, costsRes, invoicesRes, tsRes, perDiemRes] = await Promise.all([
    sb
      .from("jobs")
      .select("*, customers(company_name)")
      .order("created_at", { ascending: false }),
    sb.from("job_cost_entries").select("job_id, amount"),
    sb
      .from("invoices")
      .select("job_id, total, status")
      .not("job_id", "is", null),
    sb
      .from("timesheets")
      .select("id, job_id, user_id")
      .not("job_id", "is", null)
      .eq("status", "approved"),
    sb.from("per_diem_entries").select("timesheet_id, total_amount"),
  ]);

  if (jobsRes.error)
    return NextResponse.json({ error: jobsRes.error.message }, { status: 500 });

  // Manual costs by job
  const costMap: Record<string, number> = {};
  (costsRes.data || []).forEach((e) => {
    costMap[e.job_id] = (costMap[e.job_id] || 0) + parseFloat(e.amount);
  });

  // Invoice revenue by job
  const revMap: Record<string, number> = {};
  (invoicesRes.data || []).forEach((i) => {
    if (i.status !== "voided" && i.job_id)
      revMap[i.job_id] = (revMap[i.job_id] || 0) + parseFloat(i.total);
  });

  // Labor + per diem from approved timesheets
  const approvedTs = tsRes.data || [];
  const laborMap: Record<string, number> = {};
  const pdMap: Record<string, number> = {};

  if (approvedTs.length > 0) {
    const tsIds = approvedTs.map((t) => t.id);
    const userIds = [...new Set(approvedTs.map((t) => t.user_id))];

    const [logsRes, profilesRes] = await Promise.all([
      sb
        .from("timesheet_daily_logs")
        .select("timesheet_id, hours_worked")
        .in("timesheet_id", tsIds),
      sb
        .from("employee_tax_profiles")
        .select("user_id, hourly_rate")
        .in("user_id", userIds),
    ]);

    const rateByUser: Record<string, number> = {};
    (profilesRes.data || []).forEach((p) => {
      rateByUser[p.user_id] = parseFloat(p.hourly_rate) || 0;
    });

    const hoursByTs: Record<string, number> = {};
    (logsRes.data || []).forEach((l) => {
      hoursByTs[l.timesheet_id] =
        (hoursByTs[l.timesheet_id] || 0) + (parseFloat(l.hours_worked) || 0);
    });

    approvedTs.forEach((ts) => {
      const hours = hoursByTs[ts.id] || 0;
      const rate = rateByUser[ts.user_id] || 0;
      laborMap[ts.job_id] = (laborMap[ts.job_id] || 0) + hours * rate;
    });

    const pdByTs: Record<string, number> = {};
    (perDiemRes.data || []).forEach((p) => {
      pdByTs[p.timesheet_id] = parseFloat(p.total_amount) || 0;
    });
    approvedTs.forEach((ts) => {
      if (pdByTs[ts.id])
        pdMap[ts.job_id] = (pdMap[ts.job_id] || 0) + pdByTs[ts.id];
    });
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;

  const enriched = (jobsRes.data || []).map((j) => {
    const manual = costMap[j.id] || 0;
    const labor = laborMap[j.id] || 0;
    const perDiem = pdMap[j.id] || 0;
    const totalCosts = manual + labor + perDiem;
    const totalRevenue = revMap[j.id] || 0;
    const profit = totalRevenue - totalCosts;
    const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

    return {
      ...j,
      customer_name: j.customers?.company_name || null,
      total_costs: r2(totalCosts),
      labor_cost: r2(labor),
      per_diem_cost: r2(perDiem),
      manual_costs: r2(manual),
      total_revenue: r2(totalRevenue),
      profit: r2(profit),
      margin: Math.round(margin * 10) / 10,
    };
  });

  return NextResponse.json(enriched);
}

/** POST — create a new job */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkFinanceRole(userId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  if (!body.name?.trim())
    return NextResponse.json(
      { error: "Job name is required" },
      { status: 400 },
    );

  const sb = getSupabase();

  // Generate job number
  const { data: numData, error: numErr } = await sb.rpc(
    "get_next_job_number",
  );
  const jobNumber = numErr ? `J-${Date.now()}` : numData;

  const { data, error } = await sb
    .from("jobs")
    .insert({
      job_number: jobNumber,
      customer_id: body.customer_id || null,
      name: body.name.trim(),
      description: body.description || "",
      status: body.status || "bidding",
      job_type: body.job_type || "",
      location: body.location || "",
      bid_amount: body.bid_amount || 0,
      contract_amount: body.contract_amount || 0,
      start_date: body.start_date || null,
      end_date: body.end_date || null,
      estimated_hours: body.estimated_hours || 0,
      notes: body.notes || "",
      created_by: userId,
    })
    .select("*, customers(company_name)")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
