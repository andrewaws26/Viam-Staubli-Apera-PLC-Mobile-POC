import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

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

/**
 * GET /api/accounting/employee-tax
 *
 * Query params:
 *   (none)                  — list all employee tax profiles with benefits & workers comp
 *   ?user_id=xxx            — single employee profile
 *   ?benefit_plans=true     — list all active benefit plans
 *   ?workers_comp_classes=true — list all active workers comp classes
 *
 * Manager/developer only.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;

  try {
    const sb = getSupabase();

    // Return all active benefit plans
    if (params.get("benefit_plans") === "true") {
      const { data, error } = await sb
        .from("benefit_plans")
        .select("*")
        .eq("is_active", true)
        .order("plan_type", { ascending: true });
      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    // Return all active workers comp classes
    if (params.get("workers_comp_classes") === "true") {
      const { data, error } = await sb
        .from("workers_comp_classes")
        .select("*")
        .eq("is_active", true)
        .order("ncci_code", { ascending: true });
      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    // Build tax profiles query — join with employee_profiles for names
    const userIdFilter = params.get("user_id");
    let query = sb
      .from("employee_tax_profiles")
      .select("*, employee_profiles(user_name)")
      .order("created_at", { ascending: false });

    if (userIdFilter) {
      query = query.eq("user_id", userIdFilter);
    }

    const { data: profiles, error: profilesErr } = await query;
    if (profilesErr) throw profilesErr;

    if (!profiles || profiles.length === 0) {
      return NextResponse.json(userIdFilter ? null : []);
    }

    // Collect user_ids to batch-fetch benefits and workers comp
    const userIds = profiles.map(
      (p: Record<string, unknown>) => p.user_id as string
    );

    // Fetch benefit enrollments (active = no termination_date) with plan details
    const { data: benefits, error: benefitsErr } = await sb
      .from("employee_benefits")
      .select("*, benefit_plans(name, plan_type)")
      .is("termination_date", null)
      .in("user_id", userIds);
    if (benefitsErr) throw benefitsErr;

    // Fetch workers comp assignments with class details
    const { data: workerComp, error: wcErr } = await sb
      .from("employee_workers_comp")
      .select("*, workers_comp_classes(ncci_code, description, rate_per_100)")
      .in("user_id", userIds);
    if (wcErr) throw wcErr;

    // Index benefits and workers comp by user_id
    const benefitsByUser: Record<string, unknown[]> = {};
    for (const b of benefits ?? []) {
      const uid = b.user_id as string;
      if (!benefitsByUser[uid]) benefitsByUser[uid] = [];
      const plan = b.benefit_plans as Record<string, unknown> | null;
      benefitsByUser[uid].push({
        benefit_plan_id: b.benefit_plan_id,
        plan_name: plan?.name ?? null,
        plan_type: plan?.plan_type ?? null,
        employee_amount: b.employee_amount,
        employer_amount: b.employer_amount,
      });
    }

    const wcByUser: Record<string, unknown> = {};
    for (const w of workerComp ?? []) {
      const uid = w.user_id as string;
      const cls = w.workers_comp_classes as Record<string, unknown> | null;
      wcByUser[uid] = {
        workers_comp_class_id: w.workers_comp_class_id,
        ncci_code: cls?.ncci_code ?? null,
        description: cls?.description ?? null,
        rate_per_100: cls?.rate_per_100 ?? null,
      };
    }

    // Assemble response
    const result = profiles.map((p: Record<string, unknown>) => {
      const uid = p.user_id as string;
      const ep = p.employee_profiles as Record<string, unknown> | null;
      const { employee_profiles: _ep, ...rest } = p;
      return {
        ...rest,
        employee_name: ep?.user_name ?? null,
        benefits: benefitsByUser[uid] ?? [],
        workers_comp: wcByUser[uid] ?? null,
      };
    });

    // If single user requested, return the object (or null)
    if (userIdFilter) {
      return NextResponse.json(result[0] ?? null);
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/employee-tax GET", err);
    return NextResponse.json(
      { error: "Failed to fetch employee tax data" },
      { status: 502 }
    );
  }
}

/**
 * POST /api/accounting/employee-tax
 * Create or update (upsert) an employee tax profile.
 * Manager/developer only.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetUserId = body.user_id as string | undefined;
  if (!targetUserId)
    return NextResponse.json(
      { error: "user_id is required" },
      { status: 400 }
    );

  // Whitelist allowed fields
  const allowed = [
    "filing_status",
    "multiple_jobs",
    "dependents_credit",
    "other_income",
    "deductions",
    "extra_withholding",
    "state",
    "state_withholding",
    "local_tax_rate",
    "pay_frequency",
    "pay_type",
    "hourly_rate",
    "salary_annual",
    "ytd_gross_pay",
    "ytd_federal_wh",
    "ytd_state_wh",
    "ytd_local_wh",
    "ytd_social_security",
    "ytd_medicare",
    "exempt_federal",
    "exempt_state",
    "exempt_fica",
    "w4_year",
  ];

  const row: Record<string, unknown> = { user_id: targetUserId };
  for (const k of allowed) {
    if (k in body) row[k] = body[k];
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("employee_tax_profiles")
      .upsert(row, { onConflict: "user_id" })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/employee-tax POST", err);
    return NextResponse.json(
      { error: "Failed to save employee tax profile" },
      { status: 502 }
    );
  }
}

/**
 * PATCH /api/accounting/employee-tax
 * Benefit enrollment, workers comp assignment, or partial profile update.
 *
 * Actions:
 *   { action: "enroll_benefit",       user_id, benefit_plan_id, employee_amount?, employer_amount? }
 *   { action: "unenroll_benefit",     user_id, benefit_plan_id }
 *   { action: "assign_workers_comp",  user_id, workers_comp_class_id }
 *   { action: "update_profile",       user_id, ...fields }
 *
 * Manager/developer only.
 */
export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action as string;
  const targetUserId = body.user_id as string;
  if (!action || !targetUserId)
    return NextResponse.json(
      { error: "Missing action or user_id" },
      { status: 400 }
    );

  try {
    const sb = getSupabase();

    if (action === "enroll_benefit") {
      const planId = body.benefit_plan_id as string;
      if (!planId)
        return NextResponse.json(
          { error: "benefit_plan_id is required" },
          { status: 400 }
        );

      // Upsert — if previously terminated, re-enroll by clearing termination_date
      const { data, error } = await sb
        .from("employee_benefits")
        .upsert(
          {
            user_id: targetUserId,
            benefit_plan_id: planId,
            enrollment_date: new Date().toISOString().split("T")[0],
            termination_date: null,
            employee_amount: (body.employee_amount as number) ?? null,
            employer_amount: (body.employer_amount as number) ?? null,
          },
          { onConflict: "user_id,benefit_plan_id" }
        )
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    }

    if (action === "unenroll_benefit") {
      const planId = body.benefit_plan_id as string;
      if (!planId)
        return NextResponse.json(
          { error: "benefit_plan_id is required" },
          { status: 400 }
        );

      const { data, error } = await sb
        .from("employee_benefits")
        .update({
          termination_date: new Date().toISOString().split("T")[0],
        })
        .eq("user_id", targetUserId)
        .eq("benefit_plan_id", planId)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    }

    if (action === "assign_workers_comp") {
      const classId = body.workers_comp_class_id as string;
      if (!classId)
        return NextResponse.json(
          { error: "workers_comp_class_id is required" },
          { status: 400 }
        );

      const { data, error } = await sb
        .from("employee_workers_comp")
        .upsert(
          {
            user_id: targetUserId,
            workers_comp_class_id: classId,
            effective_date: new Date().toISOString().split("T")[0],
          },
          { onConflict: "user_id,workers_comp_class_id" }
        )
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    }

    if (action === "update_profile") {
      const allowed = [
        "filing_status",
        "multiple_jobs",
        "dependents_credit",
        "other_income",
        "deductions",
        "extra_withholding",
        "state",
        "state_withholding",
        "local_tax_rate",
        "pay_frequency",
        "pay_type",
        "hourly_rate",
        "salary_annual",
        "ytd_gross_pay",
        "ytd_federal_wh",
        "ytd_state_wh",
        "ytd_local_wh",
        "ytd_social_security",
        "ytd_medicare",
        "exempt_federal",
        "exempt_state",
        "exempt_fica",
        "w4_year",
      ];

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      for (const k of allowed) {
        if (k in body) updates[k] = body[k];
      }

      const { data, error } = await sb
        .from("employee_tax_profiles")
        .update(updates)
        .eq("user_id", targetUserId)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/employee-tax PATCH", err);
    return NextResponse.json(
      { error: "Failed to update employee tax data" },
      { status: 502 }
    );
  }
}
