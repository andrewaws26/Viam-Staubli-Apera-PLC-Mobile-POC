import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import type { AccountType, TrialBalanceRow, TrialBalanceSummary } from "@ironsight/shared/accounting";

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
 * GET /api/accounting/trial-balance
 * Compute trial balance as of a given date.
 * Optional: ?as_of=2026-04-08 (defaults to today).
 *
 * For each active account, sums all debit/credit from posted journal_entry_lines
 * where entry_date <= as_of. Returns rows with account info, debit_total,
 * credit_total, balance, plus summary totals and is_balanced flag.
 *
 * Manager/developer only.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const asOf = params.get("as_of") || new Date().toISOString().split("T")[0];

  try {
    const sb = getSupabase();

    // Fetch all active accounts
    const { data: accounts, error: acctErr } = await sb
      .from("chart_of_accounts")
      .select("id, account_number, name, account_type")
      .eq("is_active", true)
      .order("account_number", { ascending: true });

    if (acctErr) throw acctErr;
    if (!accounts || accounts.length === 0) {
      const summary: TrialBalanceSummary = {
        rows: [],
        total_debits: 0,
        total_credits: 0,
        is_balanced: true,
        as_of_date: asOf,
      };
      return NextResponse.json(summary);
    }

    // Fetch all posted journal entries on or before as_of date
    const { data: postedEntries, error: entriesErr } = await sb
      .from("journal_entries")
      .select("id")
      .eq("status", "posted")
      .lte("entry_date", asOf);

    if (entriesErr) throw entriesErr;

    // If no posted entries, return zeroed rows for all accounts
    if (!postedEntries || postedEntries.length === 0) {
      const rows: TrialBalanceRow[] = accounts.map((acct) => ({
        account_id: acct.id,
        account_number: acct.account_number,
        account_name: acct.name,
        account_type: acct.account_type as AccountType,
        debit_total: 0,
        credit_total: 0,
        balance: 0,
      }));

      const summary: TrialBalanceSummary = {
        rows,
        total_debits: 0,
        total_credits: 0,
        is_balanced: true,
        as_of_date: asOf,
      };
      return NextResponse.json(summary);
    }

    const entryIds = postedEntries.map((e) => e.id);

    // Fetch all lines from those posted entries
    const { data: allLines, error: linesErr } = await sb
      .from("journal_entry_lines")
      .select("account_id, debit, credit")
      .in("journal_entry_id", entryIds);

    if (linesErr) throw linesErr;

    // Aggregate by account_id
    const aggregates = new Map<
      string,
      { debit_total: number; credit_total: number }
    >();

    for (const line of allLines ?? []) {
      const accountId = line.account_id as string;
      const existing = aggregates.get(accountId) || {
        debit_total: 0,
        credit_total: 0,
      };
      existing.debit_total += Number(line.debit) || 0;
      existing.credit_total += Number(line.credit) || 0;
      aggregates.set(accountId, existing);
    }

    // Build trial balance rows
    let grandTotalDebits = 0;
    let grandTotalCredits = 0;

    const rows: TrialBalanceRow[] = accounts.map((acct) => {
      const agg = aggregates.get(acct.id) || {
        debit_total: 0,
        credit_total: 0,
      };
      const debitTotal = Math.round(agg.debit_total * 100) / 100;
      const creditTotal = Math.round(agg.credit_total * 100) / 100;
      const balance = Math.round((debitTotal - creditTotal) * 100) / 100;

      grandTotalDebits += debitTotal;
      grandTotalCredits += creditTotal;

      return {
        account_id: acct.id,
        account_number: acct.account_number,
        account_name: acct.name,
        account_type: acct.account_type as AccountType,
        debit_total: debitTotal,
        credit_total: creditTotal,
        balance,
      };
    });

    grandTotalDebits = Math.round(grandTotalDebits * 100) / 100;
    grandTotalCredits = Math.round(grandTotalCredits * 100) / 100;

    const summary: TrialBalanceSummary = {
      rows,
      total_debits: grandTotalDebits,
      total_credits: grandTotalCredits,
      is_balanced: grandTotalDebits === grandTotalCredits,
      as_of_date: asOf,
    };

    return NextResponse.json(summary);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/trial-balance GET", err);
    return NextResponse.json(
      { error: "Failed to compute trial balance" },
      { status: 502 },
    );
  }
}
