import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";

/** Default annual PTO allotments (in hours) */
const DEFAULT_BALANCES = {
  vacation_hours_total: 80,
  sick_hours_total: 40,
  personal_hours_total: 24,
  vacation_hours_used: 0,
  sick_hours_used: 0,
  personal_hours_used: 0,
};

/**
 * Fetches display name, email, and role from Clerk for the given user ID.
 * Falls back to safe defaults if Clerk is unreachable.
 */
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

/**
 * GET /api/pto/balance
 * Returns the current user's PTO balance for the current calendar year.
 * If no balance row exists, auto-creates one with default allotments.
 *
 * Response includes computed remaining hours for each PTO type:
 *   vacation_remaining, sick_remaining, personal_remaining
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const currentYear = new Date().getFullYear();

  try {
    const sb = getSupabase();
    const userInfo = await getUserInfo(userId);

    // Try to fetch existing balance
    const { data: balance, error: fetchErr } = await sb
      .from("pto_balances")
      .select("*")
      .eq("user_id", userId)
      .eq("year", currentYear)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    // Auto-create with defaults if no balance row exists
    if (!balance) {
      const { data: created, error: createErr } = await sb
        .from("pto_balances")
        .insert({
          user_id: userId,
          user_name: userInfo.name,
          year: currentYear,
          ...DEFAULT_BALANCES,
        })
        .select()
        .single();

      if (createErr) throw createErr;
      balance = created;
    }

    // Compute remaining hours for convenience
    const result = {
      ...balance,
      vacation_remaining:
        (Number(balance.vacation_hours_total) || 0) -
        (Number(balance.vacation_hours_used) || 0),
      sick_remaining:
        (Number(balance.sick_hours_total) || 0) -
        (Number(balance.sick_hours_used) || 0),
      personal_remaining:
        (Number(balance.personal_hours_total) || 0) -
        (Number(balance.personal_hours_used) || 0),
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[API-ERROR]", "/api/pto/balance GET", err);
    return NextResponse.json(
      { error: "Failed to fetch PTO balance" },
      { status: 502 },
    );
  }
}

/**
 * PATCH /api/pto/balance
 * Manager/developer only — adjust PTO balances for any user.
 * Requires ?user_id= query param to identify the target employee.
 *
 * Body fields (all optional, include only what you want to change):
 *   vacation_hours_total, sick_hours_total, personal_hours_total,
 *   vacation_hours_used, sick_hours_used, personal_hours_used
 */
export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";

  if (!isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const targetUserId = request.nextUrl.searchParams.get("user_id");
  if (!targetUserId) {
    return NextResponse.json({ error: "Missing user_id query param" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Whitelist of adjustable balance fields
  const adjustableFields = [
    "vacation_hours_total",
    "sick_hours_total",
    "personal_hours_total",
    "vacation_hours_used",
    "sick_hours_used",
    "personal_hours_used",
  ];

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const changedFields: string[] = [];

  for (const field of adjustableFields) {
    if (field in body) {
      const val = Number(body[field]);
      if (isNaN(val) || val < 0) {
        return NextResponse.json(
          { error: `${field} must be a non-negative number` },
          { status: 400 },
        );
      }
      update[field] = val;
      changedFields.push(field);
    }
  }

  if (changedFields.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const currentYear = new Date().getFullYear();

  try {
    const sb = getSupabase();

    // Verify the balance row exists for this user/year
    const { data: existing } = await sb
      .from("pto_balances")
      .select("id")
      .eq("user_id", targetUserId)
      .eq("year", currentYear)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json(
        { error: "No PTO balance found for this user and year. User must access their balance first." },
        { status: 404 },
      );
    }

    const { data, error } = await sb
      .from("pto_balances")
      .update(update)
      .eq("user_id", targetUserId)
      .eq("year", currentYear)
      .select()
      .single();

    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "pto_approved", // Reusing closest audit action for balance adjustments
      details: {
        action: "balance_adjusted",
        target_user_id: targetUserId,
        year: currentYear,
        changed_fields: changedFields,
      },
    });

    // Compute remaining hours in the response
    const result = {
      ...data,
      vacation_remaining:
        (Number(data.vacation_hours_total) || 0) -
        (Number(data.vacation_hours_used) || 0),
      sick_remaining:
        (Number(data.sick_hours_total) || 0) -
        (Number(data.sick_hours_used) || 0),
      personal_remaining:
        (Number(data.personal_hours_total) || 0) -
        (Number(data.personal_hours_used) || 0),
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[API-ERROR]", "/api/pto/balance PATCH", err);
    return NextResponse.json(
      { error: "Failed to update PTO balance" },
      { status: 502 },
    );
  }
}
