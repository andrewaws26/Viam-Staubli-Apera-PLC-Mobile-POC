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
 * GET /api/accounting/budget
 * Budget listing or budget-vs-actual comparison report.
 *
 * Query params:
 *   fiscal_year — required (defaults to current year)
 *   report      — if "true", returns budget vs actual comparison
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
  const fiscalYear = parseInt(
    params.get("fiscal_year") || String(new Date().getFullYear()),
    10,
  );
  const isReport = params.get("report") === "true";

  try {
    const sb = getSupabase();

    if (!isReport) {
      // Simple budget listing
      const { data: budgets, error: budgetErr } = await sb
        .from("budgets")
        .select(
          `
          id,
          fiscal_year,
          account_id,
          period,
          budgeted_amount,
          chart_of_accounts (
            account_number,
            name
          )
        `,
        )
        .eq("fiscal_year", fiscalYear)
        .order("created_at", { ascending: true });

      if (budgetErr) throw budgetErr;

      const rows = (budgets ?? []).map((b) => {
        const acct = b.chart_of_accounts as unknown as {
          account_number: string;
          name: string;
        } | null;
        return {
          id: b.id,
          fiscal_year: b.fiscal_year,
          account_id: b.account_id,
          account_number: acct?.account_number ?? "",
          account_name: acct?.name ?? "Unknown",
          period: b.period,
          budgeted_amount: Number(b.budgeted_amount) || 0,
        };
      });

      return NextResponse.json(rows);
    }

    // Budget vs Actual report
    const { data: budgets, error: budgetErr } = await sb
      .from("budgets")
      .select(
        `
        id,
        fiscal_year,
        account_id,
        period,
        budgeted_amount,
        chart_of_accounts (
          id,
          account_number,
          name,
          account_type,
          normal_balance
        )
      `,
      )
      .eq("fiscal_year", fiscalYear)
      .eq("period", "annual");

    if (budgetErr) throw budgetErr;

    if (!budgets || budgets.length === 0) {
      return NextResponse.json({
        fiscal_year: fiscalYear,
        accounts: [],
        summary: {
          total_revenue_budget: 0,
          total_revenue_actual: 0,
          total_expense_budget: 0,
          total_expense_actual: 0,
          net_budget: 0,
          net_actual: 0,
        },
      });
    }

    // Fetch posted journal entries within the fiscal year
    const yearStart = `${fiscalYear}-01-01`;
    const yearEnd = `${fiscalYear}-12-31`;

    const { data: postedEntries, error: entriesErr } = await sb
      .from("journal_entries")
      .select("id")
      .eq("status", "posted")
      .gte("entry_date", yearStart)
      .lte("entry_date", yearEnd);

    if (entriesErr) throw entriesErr;

    // Aggregate actual amounts per account from posted lines
    const actualByAccount = new Map<
      string,
      { total_debit: number; total_credit: number }
    >();

    if (postedEntries && postedEntries.length > 0) {
      const entryIds = postedEntries.map((e) => e.id);
      const budgetAccountIds = budgets.map((b) => b.account_id as string);

      const { data: lines, error: linesErr } = await sb
        .from("journal_entry_lines")
        .select("account_id, debit, credit")
        .in("journal_entry_id", entryIds)
        .in("account_id", budgetAccountIds);

      if (linesErr) throw linesErr;

      for (const line of lines ?? []) {
        const acctId = line.account_id as string;
        const existing = actualByAccount.get(acctId) || {
          total_debit: 0,
          total_credit: 0,
        };
        existing.total_debit += Number(line.debit) || 0;
        existing.total_credit += Number(line.credit) || 0;
        actualByAccount.set(acctId, existing);
      }
    }

    // Build comparison rows
    let totalRevenueBudget = 0;
    let totalRevenueActual = 0;
    let totalExpenseBudget = 0;
    let totalExpenseActual = 0;

    const accounts = budgets.map((b) => {
      const acct = b.chart_of_accounts as unknown as {
        id: string;
        account_number: string;
        name: string;
        account_type: string;
        normal_balance: string;
      };

      const budgetAmount =
        Math.round((Number(b.budgeted_amount) || 0) * 100) / 100;
      const actuals = actualByAccount.get(b.account_id as string) || {
        total_debit: 0,
        total_credit: 0,
      };

      // Compute actual amount based on normal balance direction
      const isDebitNormal = acct.normal_balance === "debit";
      const actualAmount = Math.round(
        (isDebitNormal
          ? actuals.total_debit - actuals.total_credit
          : actuals.total_credit - actuals.total_debit) * 100,
      ) / 100;

      const varianceAmount =
        Math.round((budgetAmount - actualAmount) * 100) / 100;
      const variancePercent =
        budgetAmount !== 0
          ? Math.round((varianceAmount / budgetAmount) * 10000) / 100
          : 0;

      // Revenue: actual > budget is favorable
      // Expense: actual < budget is favorable
      const isRevenue = acct.account_type === "revenue";
      const favorable = isRevenue
        ? actualAmount > budgetAmount
        : actualAmount < budgetAmount;

      if (isRevenue) {
        totalRevenueBudget += budgetAmount;
        totalRevenueActual += actualAmount;
      } else if (acct.account_type === "expense") {
        totalExpenseBudget += budgetAmount;
        totalExpenseActual += actualAmount;
      }

      return {
        account_id: b.account_id,
        account_number: acct.account_number,
        account_name: acct.name,
        account_type: acct.account_type,
        budget_amount: budgetAmount,
        actual_amount: actualAmount,
        variance_amount: varianceAmount,
        variance_percent: variancePercent,
        favorable,
      };
    });

    totalRevenueBudget = Math.round(totalRevenueBudget * 100) / 100;
    totalRevenueActual = Math.round(totalRevenueActual * 100) / 100;
    totalExpenseBudget = Math.round(totalExpenseBudget * 100) / 100;
    totalExpenseActual = Math.round(totalExpenseActual * 100) / 100;

    return NextResponse.json({
      fiscal_year: fiscalYear,
      accounts,
      summary: {
        total_revenue_budget: totalRevenueBudget,
        total_revenue_actual: totalRevenueActual,
        total_expense_budget: totalExpenseBudget,
        total_expense_actual: totalExpenseActual,
        net_budget:
          Math.round((totalRevenueBudget - totalExpenseBudget) * 100) / 100,
        net_actual:
          Math.round((totalRevenueActual - totalExpenseActual) * 100) / 100,
      },
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/budget GET", err);
    return NextResponse.json(
      { error: "Failed to fetch budget data" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/accounting/budget
 * Create or update budget entries via upsert.
 *
 * Body:
 *   { fiscal_year: number, entries: [{ account_id, period, budgeted_amount }] }
 *
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

  try {
    const body = await request.json();
    const { fiscal_year, entries } = body as {
      fiscal_year: number;
      entries: Array<{
        account_id: string;
        period?: string;
        budgeted_amount: number;
      }>;
    };

    if (!fiscal_year || !entries || !Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { error: "fiscal_year and non-empty entries array are required" },
        { status: 400 },
      );
    }

    const validPeriods = [
      "annual",
      "q1",
      "q2",
      "q3",
      "q4",
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];

    const rows = entries.map((e) => ({
      fiscal_year,
      account_id: e.account_id,
      period: e.period || "annual",
      budgeted_amount: e.budgeted_amount,
      created_by: userId,
      created_by_name: userInfo.name,
      updated_at: new Date().toISOString(),
    }));

    // Validate periods
    for (const row of rows) {
      if (!validPeriods.includes(row.period)) {
        return NextResponse.json(
          { error: `Invalid period: ${row.period}` },
          { status: 400 },
        );
      }
    }

    const sb = getSupabase();

    const { data, error } = await sb
      .from("budgets")
      .upsert(rows, {
        onConflict: "fiscal_year,account_id,period",
      })
      .select();

    if (error) throw error;

    return NextResponse.json({
      message: `${(data ?? []).length} budget entries saved`,
      entries: data,
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/budget POST", err);
    return NextResponse.json(
      { error: "Failed to save budget entries" },
      { status: 502 },
    );
  }
}
