import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";
import {
  AccountType,
  ACCOUNT_TYPE_NORMAL_BALANCE,
} from "@ironsight/shared/accounting";

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
 * GET /api/accounting/accounts
 * List all accounts from chart_of_accounts, ordered by account_number.
 * Optional filters: ?type=asset, ?active_only=true (default true).
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const type = params.get("type");
  const activeOnly = params.get("active_only") !== "false"; // default true

  try {
    const sb = getSupabase();
    let query = sb
      .from("chart_of_accounts")
      .select("*")
      .order("account_number", { ascending: true });

    if (type) query = query.eq("account_type", type);
    if (activeOnly) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/accounts GET", err);
    return NextResponse.json(
      { error: "Failed to fetch accounts" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/accounting/accounts
 * Create a new account in the chart of accounts.
 * Required: account_number, name, account_type.
 * Optional: description, parent_id.
 * Manager/developer only.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { account_number, name, account_type, description, parent_id } =
    body as Record<string, unknown>;

  if (!account_number || !name || !account_type) {
    return NextResponse.json(
      { error: "Missing required fields: account_number, name, account_type" },
      { status: 400 },
    );
  }

  const validTypes: AccountType[] = [
    "asset",
    "liability",
    "equity",
    "revenue",
    "expense",
  ];
  if (!validTypes.includes(account_type as AccountType)) {
    return NextResponse.json(
      { error: `account_type must be one of: ${validTypes.join(", ")}` },
      { status: 400 },
    );
  }

  const normalBalance =
    ACCOUNT_TYPE_NORMAL_BALANCE[account_type as AccountType];

  try {
    const sb = getSupabase();

    // Check for duplicate account_number
    const { data: existing } = await sb
      .from("chart_of_accounts")
      .select("id")
      .eq("account_number", account_number as string)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `Account number ${account_number} already exists` },
        { status: 409 },
      );
    }

    const { data, error } = await sb
      .from("chart_of_accounts")
      .insert({
        account_number: account_number as string,
        name: name as string,
        account_type: account_type as string,
        normal_balance: normalBalance,
        description: (description as string) || null,
        parent_id: (parent_id as string) || null,
      })
      .select()
      .single();

    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "account_created",
      details: {
        account_id: data.id,
        account_number: data.account_number,
        name: data.name,
        account_type: data.account_type,
      },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/accounts POST", err);
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 502 },
    );
  }
}
