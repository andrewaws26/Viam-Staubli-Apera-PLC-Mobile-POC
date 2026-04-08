import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import type { AccountType } from "@ironsight/shared/accounting";

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

interface BalanceSheetAccount {
  account_id: string;
  account_number: number;
  account_name: string;
  balance: number;
}

interface BalanceSheetSection {
  label: string;
  accounts: BalanceSheetAccount[];
  total: number;
}

interface BalanceSheetResponse {
  as_of_date: string;
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  equity: BalanceSheetSection;
  retained_earnings: number;
  total_equity_with_re: number;
  total_liabilities_and_equity: number;
  is_balanced: boolean;
}

/**
 * GET /api/accounting/balance-sheet
 * Returns Balance Sheet: Assets = Liabilities + Equity
 *
 * Query params:
 *   as_of — date (YYYY-MM-DD, defaults to today)
 *
 * Retained earnings = sum of all revenue credits minus expense debits
 * for posted entries through the as_of date.
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

    // Fetch active accounts
    const { data: accounts, error: acctErr } = await sb
      .from("chart_of_accounts")
      .select("id, account_number, name, account_type")
      .eq("is_active", true)
      .order("account_number", { ascending: true });

    if (acctErr) throw acctErr;

    // Fetch posted entry IDs through as_of date
    const { data: postedEntries, error: entriesErr } = await sb
      .from("journal_entries")
      .select("id")
      .eq("status", "posted")
      .lte("entry_date", asOf);

    if (entriesErr) throw entriesErr;

    // Aggregate lines by account
    const aggregates = new Map<string, { debit_total: number; credit_total: number }>();

    if (postedEntries && postedEntries.length > 0) {
      const entryIds = postedEntries.map((e) => e.id);
      const { data: allLines, error: linesErr } = await sb
        .from("journal_entry_lines")
        .select("account_id, debit, credit")
        .in("journal_entry_id", entryIds);

      if (linesErr) throw linesErr;

      for (const line of allLines ?? []) {
        const accountId = line.account_id as string;
        const existing = aggregates.get(accountId) || { debit_total: 0, credit_total: 0 };
        existing.debit_total += Number(line.debit) || 0;
        existing.credit_total += Number(line.credit) || 0;
        aggregates.set(accountId, existing);
      }
    }

    // Build account balances, grouped by type
    // Assets & Expenses: normal debit balance (debit - credit)
    // Liabilities, Equity, Revenue: normal credit balance (credit - debit)
    const sections: Record<AccountType, BalanceSheetAccount[]> = {
      asset: [],
      liability: [],
      equity: [],
      revenue: [],
      expense: [],
    };

    for (const acct of accounts ?? []) {
      const agg = aggregates.get(acct.id) || { debit_total: 0, credit_total: 0 };
      const debit = Math.round(agg.debit_total * 100) / 100;
      const credit = Math.round(agg.credit_total * 100) / 100;

      // Balance in normal direction for the account type
      let balance: number;
      const type = acct.account_type as AccountType;
      if (type === "asset" || type === "expense") {
        balance = debit - credit;
      } else {
        balance = credit - debit;
      }
      balance = Math.round(balance * 100) / 100;

      if (balance !== 0 || type === "asset" || type === "liability" || type === "equity") {
        sections[type].push({
          account_id: acct.id,
          account_number: acct.account_number,
          account_name: acct.name,
          balance,
        });
      }
    }

    // Compute retained earnings = net income (revenue - expenses)
    const totalRevenue = sections.revenue.reduce((sum, a) => sum + a.balance, 0);
    const totalExpenses = sections.expense.reduce((sum, a) => sum + a.balance, 0);
    const retainedEarnings = Math.round((totalRevenue - totalExpenses) * 100) / 100;

    const totalAssets = Math.round(sections.asset.reduce((sum, a) => sum + a.balance, 0) * 100) / 100;
    const totalLiabilities = Math.round(sections.liability.reduce((sum, a) => sum + a.balance, 0) * 100) / 100;
    const totalEquity = Math.round(sections.equity.reduce((sum, a) => sum + a.balance, 0) * 100) / 100;
    const totalEquityWithRE = Math.round((totalEquity + retainedEarnings) * 100) / 100;
    const totalLiabAndEquity = Math.round((totalLiabilities + totalEquityWithRE) * 100) / 100;

    const result: BalanceSheetResponse = {
      as_of_date: asOf,
      assets: {
        label: "Assets",
        accounts: sections.asset,
        total: totalAssets,
      },
      liabilities: {
        label: "Liabilities",
        accounts: sections.liability,
        total: totalLiabilities,
      },
      equity: {
        label: "Equity",
        accounts: sections.equity,
        total: totalEquity,
      },
      retained_earnings: retainedEarnings,
      total_equity_with_re: totalEquityWithRE,
      total_liabilities_and_equity: totalLiabAndEquity,
      is_balanced: totalAssets === totalLiabAndEquity,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/balance-sheet GET", err);
    return NextResponse.json(
      { error: "Failed to compute balance sheet" },
      { status: 502 },
    );
  }
}
