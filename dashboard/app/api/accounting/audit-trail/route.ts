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
      ((user.publicMetadata as Record<string, unknown>)?.role as string) || "operator";
    return { name, role };
  } catch {
    return { name: "Unknown", role: "operator" };
  }
}

/** Accounting-related action prefixes */
const ACCOUNTING_PREFIXES = [
  "account_",
  "journal_entry_",
  "invoice_",
  "bill_",
  "estimate_",
  "fixed_asset_",
  "depreciation_",
  "recurring_",
  "accounting_period_",
  "year_end_",
  "payroll_",
];

/** Category -> action prefix mappings */
const CATEGORY_MAP: Record<string, string[]> = {
  invoicing: ["invoice_"],
  bills: ["bill_"],
  journal_entries: ["journal_entry_"],
  payroll: ["payroll_"],
  assets: ["fixed_asset_", "depreciation_"],
  estimates: ["estimate_"],
  periods: ["accounting_period_", "year_end_"],
  accounts: ["account_"],
  recurring: ["recurring_"],
};

/**
 * GET /api/accounting/audit-trail
 * Paginated audit log entries filtered to accounting actions.
 * Query params: ?start_date=, ?end_date=, ?user_id=, ?action=, ?category=, ?limit=50, ?offset=0
 * Manager/developer only.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const startDate = params.get("start_date");
  const endDate = params.get("end_date");
  const filterUserId = params.get("user_id");
  const filterAction = params.get("action");
  const filterCategory = params.get("category");
  const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(params.get("offset")) || 0, 0);

  try {
    const sb = getSupabase();

    // Determine which action prefixes to filter by
    let actionPrefixes = ACCOUNTING_PREFIXES;
    if (filterCategory && CATEGORY_MAP[filterCategory]) {
      actionPrefixes = CATEGORY_MAP[filterCategory];
    }

    // Build OR filter for action prefixes
    // Supabase doesn't support OR-like on multiple columns easily,
    // so we use .or() with ilike patterns
    const orClauses = actionPrefixes.map((p) => `action.ilike.${p}%`).join(",");

    // Count query for pagination
    let countQuery = sb
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .or(orClauses);

    if (startDate) countQuery = countQuery.gte("created_at", `${startDate}T00:00:00`);
    if (endDate) countQuery = countQuery.lte("created_at", `${endDate}T23:59:59`);
    if (filterUserId) countQuery = countQuery.ilike("user_name", `%${filterUserId}%`);
    if (filterAction) countQuery = countQuery.eq("action", filterAction);

    const { count, error: countErr } = await countQuery;
    if (countErr) throw countErr;

    // Data query
    let dataQuery = sb
      .from("audit_log")
      .select("*")
      .or(orClauses)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (startDate) dataQuery = dataQuery.gte("created_at", `${startDate}T00:00:00`);
    if (endDate) dataQuery = dataQuery.lte("created_at", `${endDate}T23:59:59`);
    if (filterUserId) dataQuery = dataQuery.ilike("user_name", `%${filterUserId}%`);
    if (filterAction) dataQuery = dataQuery.eq("action", filterAction);

    const { data, error } = await dataQuery;
    if (error) throw error;

    return NextResponse.json({
      entries: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/audit-trail GET", err);
    return NextResponse.json({ error: "Failed to fetch audit trail" }, { status: 502 });
  }
}
