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
    const email = user.emailAddresses?.[0]?.emailAddress ?? "";
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator";
    return { name, email, role };
  } catch {
    return { name: "Unknown", email: "", role: "operator" };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Rule {
  id: string;
  match_type: string;
  match_pattern: string;
  category: string;
  gl_account_id: string | null;
  priority: number;
}

/** Test a single description against a rule. Case-insensitive. */
function matchesRule(description: string, rule: Rule): boolean {
  const upper = description.toUpperCase();
  const pattern = rule.match_pattern;
  switch (rule.match_type) {
    case "contains":
      return upper.includes(pattern.toUpperCase());
    case "starts_with":
      return upper.startsWith(pattern.toUpperCase());
    case "exact":
      return upper === pattern.toUpperCase();
    case "regex":
      try {
        return new RegExp(pattern, "i").test(description);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// GET  /api/accounting/expense-rules
// ---------------------------------------------------------------------------
// Query params:
//   active_only — "true" to list active rules only
//   section     — "rules" (default), "cc_accounts", "transactions"
//   cc_account_id — filter transactions by CC account
//   status      — filter transactions by status
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const section = params.get("section") || "rules";
  const activeOnly = params.get("active_only") === "true";

  try {
    const sb = getSupabase();

    // --- Rules ---
    if (section === "rules") {
      let query = sb
        .from("expense_categorization_rules")
        .select("*, chart_of_accounts(account_number, name)")
        .order("priority", { ascending: false });

      if (activeOnly) query = query.eq("is_active", true);

      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    // --- Credit Card Accounts ---
    if (section === "cc_accounts") {
      const { data, error } = await sb
        .from("credit_card_accounts")
        .select("*, chart_of_accounts(account_number, name)")
        .order("name");

      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    // --- Transactions ---
    if (section === "transactions") {
      const ccAccountId = params.get("cc_account_id");
      const status = params.get("status");

      let query = sb
        .from("credit_card_transactions")
        .select("*, chart_of_accounts(account_number, name), credit_card_accounts(name, last_four)")
        .order("transaction_date", { ascending: false })
        .limit(500);

      if (ccAccountId) query = query.eq("credit_card_account_id", ccAccountId);
      if (status) query = query.eq("status", status);

      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    // --- GL Accounts (for dropdowns) ---
    if (section === "gl_accounts") {
      const { data, error } = await sb
        .from("chart_of_accounts")
        .select("id, account_number, name, account_type")
        .eq("is_active", true)
        .order("account_number");

      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    return NextResponse.json({ error: "Invalid section" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/expense-rules GET", err);
    return NextResponse.json(
      { error: "Failed to fetch expense rules data" },
      { status: 502 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST  /api/accounting/expense-rules
// ---------------------------------------------------------------------------
// Actions:
//   create              — create a new rule
//   categorize          — run all active rules against pending CC transactions
//   import_csv          — import CSV rows as CC transactions + auto-categorize
//   post_transactions   — batch-post categorized CC txns as journal entries
//   create_cc_account   — create a credit card account
// ---------------------------------------------------------------------------

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

    // ── Create Rule ───────────────────────────────────────────────
    if (action === "create") {
      const { name, match_type, match_pattern, category, gl_account_id, priority } =
        body as {
          name?: string;
          match_type?: string;
          match_pattern?: string;
          category?: string;
          gl_account_id?: string;
          priority?: number;
        };

      if (!name || !match_type || !match_pattern || !category)
        return NextResponse.json(
          { error: "name, match_type, match_pattern, and category are required" },
          { status: 400 },
        );

      const validTypes = ["contains", "starts_with", "exact", "regex"];
      if (!validTypes.includes(match_type))
        return NextResponse.json(
          { error: `match_type must be one of: ${validTypes.join(", ")}` },
          { status: 400 },
        );

      const { data, error } = await sb
        .from("expense_categorization_rules")
        .insert({
          name,
          match_type,
          match_pattern,
          category,
          gl_account_id: gl_account_id || null,
          priority: priority ?? 0,
          is_active: true,
          created_by: userId,
        })
        .select()
        .single();

      if (error) throw error;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "expense_rule_created",
        details: { rule_id: data.id, name, match_type, match_pattern, category },
      });

      return NextResponse.json(data, { status: 201 });
    }

    // ── Create CC Account ─────────────────────────────────────────
    if (action === "create_cc_account") {
      const { name, last_four, gl_account_id } = body as {
        name?: string;
        last_four?: string;
        gl_account_id?: string;
      };

      if (!name)
        return NextResponse.json({ error: "name is required" }, { status: 400 });

      const { data, error } = await sb
        .from("credit_card_accounts")
        .insert({
          name,
          last_four: last_four || null,
          gl_account_id: gl_account_id || null,
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json(data, { status: 201 });
    }

    // ── Categorize ────────────────────────────────────────────────
    // Run all active rules (by priority DESC) against pending transactions.
    if (action === "categorize") {
      // Fetch active rules
      const { data: rules, error: rulesErr } = await sb
        .from("expense_categorization_rules")
        .select("id, match_type, match_pattern, category, gl_account_id, priority")
        .eq("is_active", true)
        .order("priority", { ascending: false });

      if (rulesErr) throw rulesErr;
      if (!rules || rules.length === 0)
        return NextResponse.json({ matched: 0, message: "No active rules" });

      // Fetch pending transactions
      const { data: pending, error: pendErr } = await sb
        .from("credit_card_transactions")
        .select("id, description")
        .eq("status", "pending");

      if (pendErr) throw pendErr;
      if (!pending || pending.length === 0)
        return NextResponse.json({ matched: 0, message: "No pending transactions" });

      let matched = 0;
      for (const tx of pending) {
        for (const rule of rules as Rule[]) {
          if (matchesRule(tx.description, rule)) {
            const { error: upErr } = await sb
              .from("credit_card_transactions")
              .update({
                category: rule.category,
                gl_account_id: rule.gl_account_id,
                status: "categorized",
              })
              .eq("id", tx.id);

            if (!upErr) matched++;
            break; // first match wins (highest priority first)
          }
        }
      }

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "cc_transactions_categorized",
        details: { matched, total_pending: pending.length },
      });

      return NextResponse.json({
        matched,
        total_pending: pending.length,
        message: `Categorized ${matched} of ${pending.length} pending transactions`,
      });
    }

    // ── Import CSV ────────────────────────────────────────────────
    // Body: { action: "import_csv", credit_card_account_id, transactions: [{date, description, amount, posted_date?}] }
    if (action === "import_csv") {
      const ccAccountId = body.credit_card_account_id as string;
      const transactions = body.transactions as {
        date: string;
        description: string;
        amount: number;
        posted_date?: string;
      }[];

      if (!ccAccountId || !transactions || !Array.isArray(transactions))
        return NextResponse.json(
          { error: "credit_card_account_id and transactions array required" },
          { status: 400 },
        );

      // Generate batch ID
      const batchId = `cc-import-${Date.now()}`;

      // Get existing hashes for dedup
      const { data: existing } = await sb
        .from("credit_card_transactions")
        .select("duplicate_hash")
        .eq("credit_card_account_id", ccAccountId)
        .not("duplicate_hash", "is", null);

      const existingHashes = new Set((existing ?? []).map((e) => e.duplicate_hash));
      const batchHashes = new Set<string>();

      const toInsert = [];
      for (const tx of transactions) {
        const hash = `${tx.date}|${tx.description}|${tx.amount}`;
        if (existingHashes.has(hash) || batchHashes.has(hash)) continue;
        batchHashes.add(hash);

        toInsert.push({
          credit_card_account_id: ccAccountId,
          transaction_date: tx.date,
          posted_date: tx.posted_date || null,
          description: tx.description,
          amount: tx.amount,
          status: "pending",
          import_batch: batchId,
          duplicate_hash: hash,
        });
      }

      if (toInsert.length === 0)
        return NextResponse.json({
          imported: 0,
          skipped: transactions.length,
          categorized: 0,
          message: "All transactions already imported (duplicates)",
        });

      const { error: insertErr } = await sb
        .from("credit_card_transactions")
        .insert(toInsert);

      if (insertErr) throw insertErr;

      // Auto-categorize the just-imported batch
      const { data: rules } = await sb
        .from("expense_categorization_rules")
        .select("id, match_type, match_pattern, category, gl_account_id, priority")
        .eq("is_active", true)
        .order("priority", { ascending: false });

      let categorized = 0;
      if (rules && rules.length > 0) {
        // Fetch the imported batch
        const { data: imported } = await sb
          .from("credit_card_transactions")
          .select("id, description")
          .eq("import_batch", batchId)
          .eq("status", "pending");

        for (const tx of imported ?? []) {
          for (const rule of rules as Rule[]) {
            if (matchesRule(tx.description, rule)) {
              const { error: upErr } = await sb
                .from("credit_card_transactions")
                .update({
                  category: rule.category,
                  gl_account_id: rule.gl_account_id,
                  status: "categorized",
                })
                .eq("id", tx.id);

              if (!upErr) categorized++;
              break;
            }
          }
        }
      }

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "cc_transactions_imported",
        details: {
          cc_account_id: ccAccountId,
          batch_id: batchId,
          imported: toInsert.length,
          skipped: transactions.length - toInsert.length,
          categorized,
        },
      });

      return NextResponse.json(
        {
          imported: toInsert.length,
          skipped: transactions.length - toInsert.length,
          categorized,
          batch_id: batchId,
          message: `Imported ${toInsert.length} transactions, auto-categorized ${categorized}`,
        },
        { status: 201 },
      );
    }

    // ── Post Transactions ─────────────────────────────────────────
    // Batch-post categorized CC transactions as journal entries.
    // Body: { action: "post_transactions", transaction_ids: string[] }
    // Creates one JE per batch: DR various expense accounts / CR Credit Cards Payable.
    if (action === "post_transactions") {
      const txIds = body.transaction_ids as string[];
      if (!txIds || !Array.isArray(txIds) || txIds.length === 0)
        return NextResponse.json(
          { error: "transaction_ids array required" },
          { status: 400 },
        );

      // Fetch the categorized transactions
      const { data: txns, error: txErr } = await sb
        .from("credit_card_transactions")
        .select("*, credit_card_accounts(gl_account_id)")
        .in("id", txIds)
        .eq("status", "categorized");

      if (txErr) throw txErr;
      if (!txns || txns.length === 0)
        return NextResponse.json(
          { error: "No categorized transactions found with those IDs" },
          { status: 400 },
        );

      // Group by credit card account for batch JE
      const byCard = new Map<string, typeof txns>();
      for (const tx of txns) {
        const cardId = tx.credit_card_account_id;
        if (!byCard.has(cardId)) byCard.set(cardId, []);
        byCard.get(cardId)!.push(tx);
      }

      const journalEntryIds: string[] = [];

      for (const [, cardTxns] of byCard) {
        // Determine the credit card liability account
        const ccLiabilityId =
          (cardTxns[0].credit_card_accounts as { gl_account_id: string | null } | null)
            ?.gl_account_id;

        // Fall back to 2300 Credit Cards Payable
        let liabilityAccountId = ccLiabilityId;
        if (!liabilityAccountId) {
          const { data: fallback } = await sb
            .from("chart_of_accounts")
            .select("id")
            .eq("account_number", "2300")
            .single();
          liabilityAccountId = fallback?.id || null;
        }

        if (!liabilityAccountId)
          return NextResponse.json(
            { error: "No liability account found for credit card. Set gl_account_id on the CC account or ensure account 2300 exists." },
            { status: 400 },
          );

        // Separate charges (positive) and credits/refunds (negative)
        const charges = cardTxns.filter((t) => Number(t.amount) > 0);
        const refunds = cardTxns.filter((t) => Number(t.amount) < 0);

        // Build journal entry lines
        const lines: { account_id: string; debit: number; credit: number; description: string }[] = [];

        // Charges: DR Expense, CR CC Payable
        for (const tx of charges) {
          if (!tx.gl_account_id) continue;
          lines.push({
            account_id: tx.gl_account_id,
            debit: Math.round(Number(tx.amount) * 100) / 100,
            credit: 0,
            description: tx.description,
          });
        }

        // Refunds: DR CC Payable, CR Expense (amounts are negative, so flip sign)
        for (const tx of refunds) {
          if (!tx.gl_account_id) continue;
          lines.push({
            account_id: tx.gl_account_id,
            debit: 0,
            credit: Math.round(Math.abs(Number(tx.amount)) * 100) / 100,
            description: tx.description,
          });
        }

        if (lines.length === 0) continue;

        // Total for the CC Payable side
        const totalDebits = lines.reduce((s, l) => s + l.debit, 0);
        const totalCredits = lines.reduce((s, l) => s + l.credit, 0);
        const netAmount = Math.round((totalDebits - totalCredits) * 100) / 100;

        // Add the CC Payable balancing line
        if (netAmount > 0) {
          // Net charge: credit the CC payable
          lines.push({
            account_id: liabilityAccountId,
            debit: 0,
            credit: Math.round(netAmount * 100) / 100,
            description: "Credit card charges",
          });
        } else if (netAmount < 0) {
          // Net refund: debit the CC payable
          lines.push({
            account_id: liabilityAccountId,
            debit: Math.round(Math.abs(netAmount) * 100) / 100,
            credit: 0,
            description: "Credit card refunds",
          });
        }

        const entryTotalDebits = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100;

        // Create journal entry
        const { data: entry, error: entryErr } = await sb
          .from("journal_entries")
          .insert({
            entry_date: new Date().toISOString().split("T")[0],
            description: `Credit card charges — batch post (${cardTxns.length} transactions)`,
            reference: `CC-BATCH-${Date.now()}`,
            source: "expense_approved",
            status: "posted",
            total_amount: entryTotalDebits,
            created_by: userId,
            created_by_name: userInfo.name,
            posted_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (entryErr) throw entryErr;

        // Insert lines
        const lineInserts = lines.map((line, idx) => ({
          journal_entry_id: entry.id,
          account_id: line.account_id,
          debit: line.debit,
          credit: line.credit,
          description: line.description,
          line_order: idx + 1,
        }));

        const { error: linesErr } = await sb
          .from("journal_entry_lines")
          .insert(lineInserts);

        if (linesErr) throw linesErr;

        // Update account balances
        for (const line of lineInserts) {
          // Fetch account to know normal_balance
          const { data: acct } = await sb
            .from("chart_of_accounts")
            .select("id, normal_balance, current_balance")
            .eq("id", line.account_id)
            .single();

          if (acct) {
            const balanceChange =
              acct.normal_balance === "debit"
                ? line.debit - line.credit
                : line.credit - line.debit;

            await sb
              .from("chart_of_accounts")
              .update({
                current_balance: Math.round((Number(acct.current_balance) + balanceChange) * 100) / 100,
              })
              .eq("id", acct.id);
          }
        }

        // Mark transactions as posted
        for (const tx of cardTxns) {
          await sb
            .from("credit_card_transactions")
            .update({ status: "posted", journal_entry_id: entry.id })
            .eq("id", tx.id);
        }

        journalEntryIds.push(entry.id);
      }

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "cc_transactions_posted",
        details: {
          transaction_count: txns.length,
          journal_entry_ids: journalEntryIds,
        },
      });

      return NextResponse.json({
        posted: txns.length,
        journal_entry_ids: journalEntryIds,
        message: `Posted ${txns.length} transactions as ${journalEntryIds.length} journal entries`,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/expense-rules POST", err);
    return NextResponse.json(
      { error: "Failed to process expense rules operation" },
      { status: 502 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH  /api/accounting/expense-rules
// ---------------------------------------------------------------------------
// Update a rule or a transaction.
//   Rule: { id, section: "rule", ...fields }
//   Transaction: { id, section: "transaction", category?, gl_account_id?, status? }
// ---------------------------------------------------------------------------

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

  const id = body.id as string;
  if (!id)
    return NextResponse.json({ error: "id is required" }, { status: 400 });

  const section = (body.section as string) || "rule";

  try {
    const sb = getSupabase();

    if (section === "rule") {
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.match_type !== undefined) updates.match_type = body.match_type;
      if (body.match_pattern !== undefined) updates.match_pattern = body.match_pattern;
      if (body.category !== undefined) updates.category = body.category;
      if (body.gl_account_id !== undefined) updates.gl_account_id = body.gl_account_id || null;
      if (body.priority !== undefined) updates.priority = body.priority;
      if (body.is_active !== undefined) updates.is_active = body.is_active;

      if (Object.keys(updates).length === 0)
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });

      const { data, error } = await sb
        .from("expense_categorization_rules")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "expense_rule_updated",
        details: { rule_id: id, updates },
      });

      return NextResponse.json(data);
    }

    if (section === "transaction") {
      const updates: Record<string, unknown> = {};
      if (body.category !== undefined) updates.category = body.category;
      if (body.gl_account_id !== undefined) updates.gl_account_id = body.gl_account_id || null;
      if (body.status !== undefined) {
        const validStatuses = ["pending", "categorized", "excluded"];
        if (!validStatuses.includes(body.status as string))
          return NextResponse.json(
            { error: `status must be one of: ${validStatuses.join(", ")}` },
            { status: 400 },
          );
        updates.status = body.status;
      }

      if (Object.keys(updates).length === 0)
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });

      const { data, error } = await sb
        .from("credit_card_transactions")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Invalid section" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/expense-rules PATCH", err);
    return NextResponse.json(
      { error: "Failed to update" },
      { status: 502 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE  /api/accounting/expense-rules
// ---------------------------------------------------------------------------
// Body: { id, section?: "rule" | "transaction" }
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
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

  const id = body.id as string;
  if (!id)
    return NextResponse.json({ error: "id is required" }, { status: 400 });

  const section = (body.section as string) || "rule";

  try {
    const sb = getSupabase();

    if (section === "rule") {
      const { error } = await sb
        .from("expense_categorization_rules")
        .delete()
        .eq("id", id);

      if (error) throw error;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "expense_rule_deleted",
        details: { rule_id: id },
      });

      return NextResponse.json({ deleted: true });
    }

    if (section === "transaction") {
      // Only allow deleting pending transactions
      const { error } = await sb
        .from("credit_card_transactions")
        .delete()
        .eq("id", id)
        .eq("status", "pending");

      if (error) throw error;
      return NextResponse.json({ deleted: true });
    }

    return NextResponse.json({ error: "Invalid section" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/expense-rules DELETE", err);
    return NextResponse.json(
      { error: "Failed to delete" },
      { status: 502 },
    );
  }
}
