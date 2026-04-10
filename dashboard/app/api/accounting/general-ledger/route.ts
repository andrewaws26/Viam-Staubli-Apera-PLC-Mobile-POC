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
 * GET /api/accounting/general-ledger
 * Returns chronological journal entry lines for one or all accounts with running balances.
 *
 * Query params:
 *   account_id  — filter to a single account (optional, omit for all)
 *   start_date  — inclusive start (YYYY-MM-DD, optional)
 *   end_date    — inclusive end (YYYY-MM-DD, optional, defaults to today)
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
  const accountId = params.get("account_id");
  const startDate = params.get("start_date");
  const endDate = params.get("end_date") || new Date().toISOString().split("T")[0];

  try {
    const sb = getSupabase();

    // Build query for posted journal entry lines with entry details
    let query = sb
      .from("journal_entry_lines")
      .select(`
        id,
        account_id,
        debit,
        credit,
        description,
        line_order,
        journal_entry_id,
        journal_entries!inner (
          id,
          entry_date,
          description,
          reference,
          source,
          status,
          posted_at
        )
      `)
      .eq("journal_entries.status", "posted");

    if (accountId) {
      query = query.eq("account_id", accountId);
    }

    if (startDate) {
      query = query.gte("journal_entries.entry_date", startDate);
    }
    query = query.lte("journal_entries.entry_date", endDate);

    query = query.order("journal_entries(entry_date)", { ascending: true });

    const { data: lines, error: linesErr } = await query;
    if (linesErr) throw linesErr;

    // Fetch account info for all referenced accounts
    const accountIds = [...new Set((lines ?? []).map((l) => l.account_id as string))];

    const accountMap: Record<string, { account_number: number; name: string; account_type: string }> = {};
    if (accountIds.length > 0) {
      const { data: accounts, error: acctErr } = await sb
        .from("chart_of_accounts")
        .select("id, account_number, name, account_type")
        .in("id", accountIds);
      if (acctErr) throw acctErr;
      for (const a of accounts ?? []) {
        accountMap[a.id] = { account_number: a.account_number, name: a.name, account_type: a.account_type };
      }
    }

    // Build flat result with running balance per account
    const runningBalances: Record<string, number> = {};

    // If filtering by single account and start_date is set, compute opening balance
    if (accountId && startDate) {
      const { data: priorEntries, error: priorErr } = await sb
        .from("journal_entries")
        .select("id")
        .eq("status", "posted")
        .lt("entry_date", startDate);

      if (!priorErr && priorEntries && priorEntries.length > 0) {
        const priorIds = priorEntries.map((e) => e.id);
        const { data: priorLines, error: priorLinesErr } = await sb
          .from("journal_entry_lines")
          .select("debit, credit")
          .eq("account_id", accountId)
          .in("journal_entry_id", priorIds);

        if (!priorLinesErr && priorLines) {
          let bal = 0;
          for (const pl of priorLines) {
            bal += (Number(pl.debit) || 0) - (Number(pl.credit) || 0);
          }
          runningBalances[accountId] = Math.round(bal * 100) / 100;
        }
      }
    }

    // Sort lines by entry_date, then line_order
    const sorted = (lines ?? []).sort((a, b) => {
      const entryA = a.journal_entries as unknown as { entry_date: string };
      const entryB = b.journal_entries as unknown as { entry_date: string };
      const dateComp = entryA.entry_date.localeCompare(entryB.entry_date);
      if (dateComp !== 0) return dateComp;
      return (a.line_order as number) - (b.line_order as number);
    });

    const result = sorted.map((line) => {
      const entry = line.journal_entries as unknown as {
        id: string;
        entry_date: string;
        description: string;
        reference: string | null;
        source: string;
      };
      const acctId = line.account_id as string;
      const debit = Math.round((Number(line.debit) || 0) * 100) / 100;
      const credit = Math.round((Number(line.credit) || 0) * 100) / 100;

      if (!(acctId in runningBalances)) runningBalances[acctId] = 0;
      runningBalances[acctId] += debit - credit;
      runningBalances[acctId] = Math.round(runningBalances[acctId] * 100) / 100;

      const acct = accountMap[acctId];

      return {
        line_id: line.id,
        entry_id: entry.id,
        entry_date: entry.entry_date,
        entry_description: entry.description,
        reference: entry.reference,
        source: entry.source,
        account_id: acctId,
        account_number: acct?.account_number ?? 0,
        account_name: acct?.name ?? "Unknown",
        account_type: acct?.account_type ?? "expense",
        line_description: line.description,
        debit,
        credit,
        running_balance: runningBalances[acctId],
      };
    });

    return NextResponse.json({
      lines: result,
      count: result.length,
      start_date: startDate,
      end_date: endDate,
      account_id: accountId,
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/general-ledger GET", err);
    return NextResponse.json(
      { error: "Failed to generate general ledger" },
      { status: 502 },
    );
  }
}
