import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";

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
 * GET /api/accounting/periods
 * List all accounting periods, ordered by start_date desc.
 * Manager/developer only.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("accounting_periods")
      .select("*")
      .order("start_date", { ascending: false });

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/periods GET", err);
    return NextResponse.json({ error: "Failed to fetch periods" }, { status: 502 });
  }
}

/**
 * PATCH /api/accounting/periods
 * Close or reopen a period.
 * Body: { id, action: "close" | "lock" | "reopen", notes? }
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

  const { id, action, notes } = body as { id?: string; action?: string; notes?: string };
  if (!id || !action)
    return NextResponse.json({ error: "Missing id or action" }, { status: 400 });

  if (!["close", "lock", "reopen"].includes(action))
    return NextResponse.json({ error: "Action must be close, lock, or reopen" }, { status: 400 });

  try {
    const sb = getSupabase();

    // Fetch current period
    const { data: period, error: fetchErr } = await sb
      .from("accounting_periods")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !period)
      return NextResponse.json({ error: "Period not found" }, { status: 404 });

    // Validate state transitions
    if (action === "close" && period.status !== "open")
      return NextResponse.json({ error: "Can only close an open period" }, { status: 400 });
    if (action === "lock" && period.status !== "closed")
      return NextResponse.json({ error: "Can only lock a closed period" }, { status: 400 });
    if (action === "reopen" && period.status === "open")
      return NextResponse.json({ error: "Period is already open" }, { status: 400 });

    const newStatus = action === "close" ? "closed" : action === "lock" ? "locked" : "open";
    const now = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      status: newStatus,
      updated_at: now,
    };

    if (action === "close" || action === "lock") {
      updatePayload.closed_by = userId;
      updatePayload.closed_by_name = userInfo.name;
      updatePayload.closed_at = now;
      if (notes) updatePayload.notes = notes;
    } else {
      // Reopen clears the closed fields
      updatePayload.closed_by = null;
      updatePayload.closed_by_name = null;
      updatePayload.closed_at = null;
    }

    const { data: updated, error: updateErr } = await sb
      .from("accounting_periods")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    const auditAction = action === "close" ? "accounting_period_close" as const
      : action === "lock" ? "accounting_period_lock" as const
      : "accounting_period_reopen" as const;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: auditAction,
      details: {
        period_id: id,
        label: period.label,
        old_status: period.status,
        new_status: newStatus,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/periods PATCH", err);
    return NextResponse.json({ error: "Failed to update period" }, { status: 502 });
  }
}

/**
 * POST /api/accounting/periods
 * Year-end close: creates a closing journal entry that zeros revenue/expense into retained earnings.
 * Body: { fiscal_year: 2026 }
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

  const fiscalYear = Number(body.fiscal_year);
  if (!fiscalYear)
    return NextResponse.json({ error: "Missing fiscal_year" }, { status: 400 });

  try {
    const sb = getSupabase();
    const yearEnd = `${fiscalYear}-12-31`;

    // Fetch all active accounts
    const { data: accounts, error: acctErr } = await sb
      .from("chart_of_accounts")
      .select("id, account_number, name, account_type")
      .eq("is_active", true);

    if (acctErr) throw acctErr;

    // Get posted entries through year end
    const { data: postedEntries, error: entriesErr } = await sb
      .from("journal_entries")
      .select("id")
      .eq("status", "posted")
      .lte("entry_date", yearEnd);

    if (entriesErr) throw entriesErr;

    if (!postedEntries || postedEntries.length === 0)
      return NextResponse.json({ error: "No posted entries found for this fiscal year" }, { status: 400 });

    const entryIds = postedEntries.map((e) => e.id);
    const { data: allLines, error: linesErr } = await sb
      .from("journal_entry_lines")
      .select("account_id, debit, credit")
      .in("journal_entry_id", entryIds);

    if (linesErr) throw linesErr;

    // Aggregate balances per account
    const balances = new Map<string, number>();
    for (const line of allLines ?? []) {
      const id = line.account_id as string;
      const curr = balances.get(id) || 0;
      balances.set(id, curr + (Number(line.debit) || 0) - (Number(line.credit) || 0));
    }

    // Find retained earnings account (3100)
    const retainedEarningsAcct = (accounts ?? []).find((a) => a.account_number === 3100);
    if (!retainedEarningsAcct)
      return NextResponse.json({ error: "Retained Earnings account (3100) not found" }, { status: 400 });

    // Build closing entry lines: zero out revenue and expense accounts
    const closingLines: { account_id: string; debit: number; credit: number; description: string }[] = [];
    let netIncome = 0;

    for (const acct of accounts ?? []) {
      const balance = Math.round((balances.get(acct.id) || 0) * 100) / 100;
      if (balance === 0) continue;

      if (acct.account_type === "revenue") {
        // Revenue normally has credit balance (negative in debit-credit), so debit to close
        closingLines.push({
          account_id: acct.id,
          debit: Math.abs(balance),
          credit: 0,
          description: `Close ${acct.name}`,
        });
        netIncome += Math.abs(balance); // credit balances = positive income
      } else if (acct.account_type === "expense") {
        // Expense normally has debit balance (positive), so credit to close
        closingLines.push({
          account_id: acct.id,
          debit: 0,
          credit: balance,
          description: `Close ${acct.name}`,
        });
        netIncome -= balance; // debit balances = subtract from income
      }
    }

    if (closingLines.length === 0)
      return NextResponse.json({ error: "No revenue or expense balances to close" }, { status: 400 });

    // Net income line to Retained Earnings
    const reNetIncome = Math.round(netIncome * 100) / 100;
    if (reNetIncome > 0) {
      closingLines.push({
        account_id: retainedEarningsAcct.id,
        debit: 0,
        credit: reNetIncome,
        description: `Net income to Retained Earnings`,
      });
    } else if (reNetIncome < 0) {
      closingLines.push({
        account_id: retainedEarningsAcct.id,
        debit: Math.abs(reNetIncome),
        credit: 0,
        description: `Net loss to Retained Earnings`,
      });
    }

    // Create the closing journal entry
    const totalAmount = closingLines.reduce((s, l) => s + l.debit, 0);
    const { data: entry, error: entryErr } = await sb
      .from("journal_entries")
      .insert({
        entry_date: yearEnd,
        description: `Year-end closing entry — FY ${fiscalYear}`,
        reference: `YE-CLOSE-${fiscalYear}`,
        source: "adjustment",
        status: "posted",
        total_amount: Math.round(totalAmount * 100) / 100,
        created_by: userId,
        created_by_name: userInfo.name,
        posted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (entryErr) throw entryErr;

    // Insert lines
    const { error: lineInsertErr } = await sb
      .from("journal_entry_lines")
      .insert(
        closingLines.map((l, i) => ({
          journal_entry_id: entry.id,
          account_id: l.account_id,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
          line_order: i,
        }))
      );

    if (lineInsertErr) throw lineInsertErr;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "year_end_close",
      details: {
        fiscal_year: fiscalYear,
        journal_entry_id: entry.id,
        net_income: reNetIncome,
        accounts_closed: closingLines.length - 1,
      },
    });

    return NextResponse.json({
      success: true,
      journal_entry_id: entry.id,
      net_income: reNetIncome,
      accounts_closed: closingLines.length - 1,
    }, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/periods POST", err);
    return NextResponse.json({ error: "Failed to execute year-end close" }, { status: 502 });
  }
}
