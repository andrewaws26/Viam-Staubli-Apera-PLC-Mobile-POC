import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

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

/**
 * GET /api/accounting/cash-flow
 * Indirect-method Cash Flow Statement.
 *
 * Query params:
 *   start_date — period start (YYYY-MM-DD, required)
 *   end_date   — period end (YYYY-MM-DD, defaults to today)
 *
 * Sections:
 *   Operating: Net income + non-cash adjustments + working capital changes
 *   Investing: Changes in fixed assets
 *   Financing: Changes in equity/long-term debt
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
  const startDate = params.get("start_date");
  const endDate = params.get("end_date") || new Date().toISOString().split("T")[0];

  if (!startDate)
    return NextResponse.json({ error: "start_date is required" }, { status: 400 });

  try {
    const sb = getSupabase();

    // Fetch all active accounts
    const { data: accounts, error: acctErr } = await sb
      .from("chart_of_accounts")
      .select("id, account_number, name, account_type")
      .eq("is_active", true);
    if (acctErr) throw acctErr;

    // Helper: get balance change for a date range
    async function getBalanceChanges(from: string, to: string) {
      const { data: entries, error: entriesErr } = await sb
        .from("journal_entries")
        .select("id")
        .eq("status", "posted")
        .gte("entry_date", from)
        .lte("entry_date", to);
      if (entriesErr) throw entriesErr;
      if (!entries || entries.length === 0) return new Map<string, number>();

      const entryIds = entries.map((e) => e.id);
      const { data: lines, error: linesErr } = await sb
        .from("journal_entry_lines")
        .select("account_id, debit, credit")
        .in("journal_entry_id", entryIds);
      if (linesErr) throw linesErr;

      const changes = new Map<string, number>();
      for (const line of lines ?? []) {
        const id = line.account_id as string;
        const curr = changes.get(id) || 0;
        changes.set(id, curr + (Number(line.debit) || 0) - (Number(line.credit) || 0));
      }
      return changes;
    }

    const changes = await getBalanceChanges(startDate, endDate);
    const accountMap = new Map((accounts ?? []).map((a) => [a.id, a]));

    // Classify changes into cash flow sections
    let netIncome = 0;
    const operatingAdjustments: { name: string; amount: number }[] = [];
    const investingItems: { name: string; amount: number }[] = [];
    const financingItems: { name: string; amount: number }[] = [];

    for (const [acctId, change] of changes) {
      const acct = accountMap.get(acctId);
      if (!acct) continue;
      const num = Number(acct.account_number);
      const roundedChange = Math.round(change * 100) / 100;
      if (roundedChange === 0) continue;

      if (acct.account_type === "revenue") {
        // Revenue: credit balance increases income
        netIncome -= roundedChange; // debit-credit format, so negate for income
      } else if (acct.account_type === "expense") {
        // Expense: debit balance decreases income
        netIncome -= roundedChange; // expenses reduce income (change is positive = more expense)
      } else if (acct.account_type === "asset") {
        if (num === 1000 || num === 1010) {
          // Cash accounts — skip, this is what we're computing
          continue;
        } else if (num >= 1300 && num <= 1399) {
          // Fixed assets and depreciation
          if (num === 1310) {
            // Accumulated depreciation — add back (non-cash)
            operatingAdjustments.push({
              name: `Depreciation (${acct.name})`,
              amount: -roundedChange, // contra-asset, negative change = add back
            });
          } else {
            investingItems.push({
              name: acct.name,
              amount: -roundedChange, // increase in asset = cash outflow
            });
          }
        } else if (num === 1400) {
          // Inventory
          operatingAdjustments.push({
            name: `Change in ${acct.name}`,
            amount: -roundedChange, // increase = cash outflow
          });
        } else if (num === 1100) {
          // Accounts Receivable
          operatingAdjustments.push({
            name: "Change in Accounts Receivable",
            amount: -roundedChange, // increase in AR = less cash collected
          });
        } else if (num === 1200) {
          // Prepaid Expenses
          operatingAdjustments.push({
            name: "Change in Prepaid Expenses",
            amount: -roundedChange,
          });
        }
      } else if (acct.account_type === "liability") {
        if (num === 2000) {
          // Accounts Payable
          operatingAdjustments.push({
            name: "Change in Accounts Payable",
            amount: -roundedChange, // AP is credit-normal; negative change in debit-credit = increase
          });
        } else if (num >= 2100 && num <= 2199) {
          // Payroll/per diem payable — operating
          operatingAdjustments.push({
            name: `Change in ${acct.name}`,
            amount: -roundedChange,
          });
        } else if (num >= 2200 && num <= 2399) {
          // Accrued liabilities, credit cards
          operatingAdjustments.push({
            name: `Change in ${acct.name}`,
            amount: -roundedChange,
          });
        } else {
          // Long-term liabilities → financing
          financingItems.push({
            name: `Change in ${acct.name}`,
            amount: -roundedChange,
          });
        }
      } else if (acct.account_type === "equity") {
        financingItems.push({
          name: `Change in ${acct.name}`,
          amount: -roundedChange,
        });
      }
    }

    netIncome = Math.round(netIncome * 100) / 100;

    const totalOperatingAdj = Math.round(operatingAdjustments.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    const cashFromOperations = Math.round((netIncome + totalOperatingAdj) * 100) / 100;
    const cashFromInvesting = Math.round(investingItems.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    const cashFromFinancing = Math.round(financingItems.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    const netCashChange = Math.round((cashFromOperations + cashFromInvesting + cashFromFinancing) * 100) / 100;

    return NextResponse.json({
      start_date: startDate,
      end_date: endDate,
      net_income: netIncome,
      operating: {
        label: "Cash from Operating Activities",
        net_income: netIncome,
        adjustments: operatingAdjustments.filter((a) => a.amount !== 0),
        total_adjustments: totalOperatingAdj,
        total: cashFromOperations,
      },
      investing: {
        label: "Cash from Investing Activities",
        items: investingItems.filter((a) => a.amount !== 0),
        total: cashFromInvesting,
      },
      financing: {
        label: "Cash from Financing Activities",
        items: financingItems.filter((a) => a.amount !== 0),
        total: cashFromFinancing,
      },
      net_cash_change: netCashChange,
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/cash-flow GET", err);
    return NextResponse.json({ error: "Failed to compute cash flow" }, { status: 502 });
  }
}
