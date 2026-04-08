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
 * GET /api/accounting/bank
 * List bank accounts and optionally their transactions.
 *
 * Query params:
 *   account_id  — get transactions for a specific bank account
 *   uncleared   — "true" to only show uncleared transactions
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
  const accountId = params.get("account_id");
  const unclearedOnly = params.get("uncleared") === "true";

  try {
    const sb = getSupabase();

    if (accountId) {
      // Return transactions for a specific bank account
      let query = sb
        .from("bank_transactions")
        .select("*")
        .eq("bank_account_id", accountId)
        .order("transaction_date", { ascending: false });

      if (unclearedOnly) query = query.eq("cleared", false);

      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    // Return all bank accounts with summary
    const { data: accounts, error: acctErr } = await sb
      .from("bank_accounts")
      .select("*, chart_of_accounts(account_number, name)")
      .eq("is_active", true)
      .order("name");

    if (acctErr) throw acctErr;
    return NextResponse.json(accounts ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/bank GET", err);
    return NextResponse.json({ error: "Failed to fetch bank data" }, { status: 502 });
  }
}

/**
 * POST /api/accounting/bank
 * Import bank transactions from CSV or create manual transaction.
 *
 * Body for CSV import:
 *   { bank_account_id, action: "import", transactions: [{date, description, amount, type?, reference?}] }
 *
 * Body for manual transaction:
 *   { bank_account_id, action: "manual", transaction_date, description, amount, type, reference? }
 *
 * Body for creating bank account:
 *   { action: "create_account", name, institution?, account_last4?, account_type, gl_account_id }
 *
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

  const action = body.action as string;

  try {
    const sb = getSupabase();

    if (action === "create_account") {
      const { name, institution, account_last4, account_type, gl_account_id } = body as {
        name?: string;
        institution?: string;
        account_last4?: string;
        account_type?: string;
        gl_account_id?: string;
      };

      if (!name || !gl_account_id)
        return NextResponse.json({ error: "name and gl_account_id required" }, { status: 400 });

      const { data, error } = await sb.from("bank_accounts").insert({
        name,
        institution: institution || null,
        account_last4: account_last4 || null,
        account_type: account_type || "checking",
        gl_account_id,
      }).select().single();

      if (error) throw error;
      return NextResponse.json(data, { status: 201 });
    }

    if (action === "import") {
      const bankAccountId = body.bank_account_id as string;
      const transactions = body.transactions as {
        date: string;
        description: string;
        amount: number;
        type?: string;
        reference?: string;
      }[];

      if (!bankAccountId || !transactions || !Array.isArray(transactions))
        return NextResponse.json({ error: "bank_account_id and transactions required" }, { status: 400 });

      // Generate hashes for dedup
      const toInsert = [];
      const hashes = new Set<string>();

      // Get existing hashes for this account
      const { data: existing } = await sb
        .from("bank_transactions")
        .select("import_hash")
        .eq("bank_account_id", bankAccountId)
        .not("import_hash", "is", null);

      const existingHashes = new Set((existing ?? []).map((e) => e.import_hash));

      for (const tx of transactions) {
        const hash = `${tx.date}|${tx.description}|${tx.amount}|${tx.reference || ""}`;
        if (existingHashes.has(hash) || hashes.has(hash)) continue;
        hashes.add(hash);

        toInsert.push({
          bank_account_id: bankAccountId,
          transaction_date: tx.date,
          description: tx.description,
          amount: tx.amount,
          type: tx.type || (tx.amount >= 0 ? "deposit" : "withdrawal"),
          reference: tx.reference || null,
          import_source: "csv_import",
          import_hash: hash,
        });
      }

      if (toInsert.length === 0)
        return NextResponse.json({ imported: 0, skipped: transactions.length, message: "All transactions already imported" });

      const { error: insertErr } = await sb.from("bank_transactions").insert(toInsert);
      if (insertErr) throw insertErr;

      return NextResponse.json({
        imported: toInsert.length,
        skipped: transactions.length - toInsert.length,
        message: `Imported ${toInsert.length} transactions`,
      }, { status: 201 });
    }

    if (action === "manual") {
      const { bank_account_id, transaction_date, description, amount, type, reference } = body as {
        bank_account_id?: string;
        transaction_date?: string;
        description?: string;
        amount?: number;
        type?: string;
        reference?: string;
      };

      if (!bank_account_id || !transaction_date || !description || amount === undefined)
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

      const { data, error } = await sb.from("bank_transactions").insert({
        bank_account_id,
        transaction_date,
        description,
        amount,
        type: type || (amount >= 0 ? "deposit" : "withdrawal"),
        reference: reference || null,
        import_source: "manual",
      }).select().single();

      if (error) throw error;
      return NextResponse.json(data, { status: 201 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/bank POST", err);
    return NextResponse.json({ error: "Failed to process bank operation" }, { status: 502 });
  }
}

/**
 * PATCH /api/accounting/bank
 * Match/unmatch transactions or complete reconciliation.
 *
 * Match transaction:     { id, action: "match", journal_entry_id }
 * Clear transaction:     { id, action: "clear" }
 * Unclear transaction:   { id, action: "unclear" }
 * Start reconciliation:  { action: "start_reconciliation", bank_account_id, statement_date, statement_balance, beginning_balance }
 * Complete reconciliation: { action: "complete_reconciliation", reconciliation_id }
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
  if (!action)
    return NextResponse.json({ error: "action required" }, { status: 400 });

  try {
    const sb = getSupabase();

    if (action === "match") {
      const { id, journal_entry_id } = body as { id?: string; journal_entry_id?: string };
      if (!id || !journal_entry_id)
        return NextResponse.json({ error: "id and journal_entry_id required" }, { status: 400 });

      const { data, error } = await sb.from("bank_transactions").update({
        matched_je_id: journal_entry_id,
        cleared: true,
      }).eq("id", id).select().single();

      if (error) throw error;
      return NextResponse.json(data);
    }

    if (action === "clear" || action === "unclear") {
      const id = body.id as string;
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

      const { data, error } = await sb.from("bank_transactions").update({
        cleared: action === "clear",
      }).eq("id", id).select().single();

      if (error) throw error;
      return NextResponse.json(data);
    }

    if (action === "start_reconciliation") {
      const { bank_account_id, statement_date, statement_balance, beginning_balance } = body as {
        bank_account_id?: string;
        statement_date?: string;
        statement_balance?: number;
        beginning_balance?: number;
      };

      if (!bank_account_id || !statement_date || statement_balance === undefined || beginning_balance === undefined)
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

      const { data, error } = await sb.from("reconciliation_sessions").insert({
        bank_account_id,
        statement_date,
        statement_balance,
        beginning_balance,
        status: "in_progress",
      }).select().single();

      if (error) throw error;
      return NextResponse.json(data, { status: 201 });
    }

    if (action === "complete_reconciliation") {
      const reconId = body.reconciliation_id as string;
      if (!reconId)
        return NextResponse.json({ error: "reconciliation_id required" }, { status: 400 });

      // Fetch the session
      const { data: session, error: sessErr } = await sb
        .from("reconciliation_sessions")
        .select("*")
        .eq("id", reconId)
        .single();

      if (sessErr || !session)
        return NextResponse.json({ error: "Session not found" }, { status: 404 });

      // Sum cleared transactions for this account in the reconciliation period
      const { data: clearedTxns, error: txErr } = await sb
        .from("bank_transactions")
        .select("amount")
        .eq("bank_account_id", session.bank_account_id)
        .eq("cleared", true)
        .lte("transaction_date", session.statement_date);

      if (txErr) throw txErr;

      let clearedDeposits = 0;
      let clearedWithdrawals = 0;
      for (const tx of clearedTxns ?? []) {
        const amt = Number(tx.amount);
        if (amt >= 0) clearedDeposits += amt;
        else clearedWithdrawals += Math.abs(amt);
      }

      const computedBalance = Math.round(
        (Number(session.beginning_balance) + clearedDeposits - clearedWithdrawals) * 100
      ) / 100;
      const difference = Math.round(
        (Number(session.statement_balance) - computedBalance) * 100
      ) / 100;

      const { data: updated, error: upErr } = await sb
        .from("reconciliation_sessions")
        .update({
          cleared_deposits: Math.round(clearedDeposits * 100) / 100,
          cleared_withdrawals: Math.round(clearedWithdrawals * 100) / 100,
          difference,
          status: difference === 0 ? "completed" : "in_progress",
          completed_by: difference === 0 ? userId : null,
          completed_by_name: difference === 0 ? userInfo.name : null,
          completed_at: difference === 0 ? new Date().toISOString() : null,
          notes: body.notes as string || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reconId)
        .select()
        .single();

      if (upErr) throw upErr;

      if (difference === 0) {
        // Mark all cleared transactions as reconciled
        await sb.from("bank_transactions")
          .update({ reconciliation_id: reconId })
          .eq("bank_account_id", session.bank_account_id)
          .eq("cleared", true)
          .lte("transaction_date", session.statement_date);

        logAuditDirect(userId, userInfo.name, userInfo.role, {
          action: "journal_entry_posted" as const, // reuse closest audit action
          details: {
            type: "bank_reconciliation_completed",
            reconciliation_id: reconId,
            bank_account_id: session.bank_account_id,
            statement_balance: session.statement_balance,
          },
        });
      }

      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/bank PATCH", err);
    return NextResponse.json({ error: "Failed to process bank operation" }, { status: 502 });
  }
}
