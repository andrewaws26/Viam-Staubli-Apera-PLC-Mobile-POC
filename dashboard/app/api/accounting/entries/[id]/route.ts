import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";
import { ACCOUNT_TYPE_NORMAL_BALANCE } from "@ironsight/shared/accounting";
import type { AccountType } from "@ironsight/shared/accounting";

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
 * GET /api/accounting/entries/[id]
 * Returns a single journal entry with all lines (joined with account name/number).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const sb = getSupabase();

    const { data: entry, error: entryErr } = await sb
      .from("journal_entries")
      .select("*")
      .eq("id", id)
      .single();

    if (entryErr || !entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Fetch lines with account info
    const { data: rawLines, error: linesErr } = await sb
      .from("journal_entry_lines")
      .select("*, chart_of_accounts(account_number, name)")
      .eq("journal_entry_id", id)
      .order("line_order", { ascending: true });

    if (linesErr) throw linesErr;

    const lines = (rawLines ?? []).map((line) => {
      const acct = line.chart_of_accounts as Record<string, string> | null;
      return {
        id: line.id,
        journal_entry_id: line.journal_entry_id,
        account_id: line.account_id,
        account_number: acct?.account_number ?? null,
        account_name: acct?.name ?? null,
        debit: Number(line.debit),
        credit: Number(line.credit),
        description: line.description,
        line_order: line.line_order,
      };
    });

    return NextResponse.json({
      ...entry,
      total_amount: Number(entry.total_amount),
      lines,
    });
  } catch (err) {
    console.error("[API-ERROR]", `/api/accounting/entries/${id} GET`, err);
    return NextResponse.json(
      { error: "Failed to fetch journal entry" },
      { status: 502 },
    );
  }
}

/**
 * PATCH /api/accounting/entries/[id]
 *
 * Status transitions:
 *   - { status: "posted" }  — draft -> posted, updates account balances
 *   - { status: "voided", reason: "..." } — posted -> voided, reverses balances
 *   - Draft entries: update description, reference, entry_date, and replace lines
 *
 * Manager/developer only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
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

  try {
    const sb = getSupabase();

    // Fetch existing entry
    const { data: entry, error: fetchErr } = await sb
      .from("journal_entries")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const currentStatus = entry.status as string;
    const newStatus = body.status as string | undefined;

    // ── Transition: draft -> posted ──────────────────────────────────
    if (newStatus === "posted") {
      if (currentStatus !== "draft") {
        return NextResponse.json(
          { error: `Cannot post: entry status is '${currentStatus}', expected 'draft'` },
          { status: 400 },
        );
      }

      // Check period is not locked/closed
      const { data: period } = await sb
        .from("accounting_periods")
        .select("status, label")
        .lte("start_date", entry.entry_date)
        .gte("end_date", entry.entry_date)
        .maybeSingle();

      if (period?.status === "locked" || period?.status === "closed") {
        return NextResponse.json(
          { error: `Cannot post to a ${period.status} accounting period (${period.label})` },
          { status: 400 },
        );
      }

      // Fetch lines with account info for balance updates
      const { data: lines, error: linesErr } = await sb
        .from("journal_entry_lines")
        .select("*, chart_of_accounts(id, account_type, current_balance)")
        .eq("journal_entry_id", id);

      if (linesErr) throw linesErr;
      if (!lines || lines.length === 0) {
        return NextResponse.json(
          { error: "Cannot post entry with no lines" },
          { status: 400 },
        );
      }

      // Update entry status
      const { error: updateErr } = await sb
        .from("journal_entries")
        .update({
          status: "posted",
          posted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateErr) throw updateErr;

      // Update account balances
      for (const line of lines) {
        const acct = line.chart_of_accounts as Record<string, unknown> | null;
        if (!acct) continue;

        const accountType = acct.account_type as AccountType;
        const currentBalance = Number(acct.current_balance) || 0;
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        const normalBalance = ACCOUNT_TYPE_NORMAL_BALANCE[accountType];

        // Debit-normal (asset, expense): balance += (debit - credit)
        // Credit-normal (liability, equity, revenue): balance += (credit - debit)
        const delta =
          normalBalance === "debit"
            ? debit - credit
            : credit - debit;

        const newBalance = Math.round((currentBalance + delta) * 100) / 100;

        await sb
          .from("chart_of_accounts")
          .update({
            current_balance: newBalance,
            updated_at: new Date().toISOString(),
          })
          .eq("id", line.account_id);
      }

      logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "journal_entry_posted",
        details: {
          entry_id: id,
          entry_date: entry.entry_date,
          description: entry.description,
          total_amount: Number(entry.total_amount),
          line_count: lines.length,
        },
      });

      // Return updated entry
      const { data: updated } = await sb
        .from("journal_entries")
        .select("*")
        .eq("id", id)
        .single();

      return NextResponse.json({
        ...updated,
        total_amount: Number(updated?.total_amount),
      });
    }

    // ── Transition: posted -> voided ─────────────────────────────────
    if (newStatus === "voided") {
      if (currentStatus !== "posted") {
        return NextResponse.json(
          { error: `Cannot void: entry status is '${currentStatus}', expected 'posted'` },
          { status: 400 },
        );
      }

      const reason = body.reason as string | undefined;
      if (!reason) {
        return NextResponse.json(
          { error: "A reason is required to void a journal entry" },
          { status: 400 },
        );
      }

      // Fetch lines with account info for balance reversal
      const { data: lines, error: linesErr } = await sb
        .from("journal_entry_lines")
        .select("*, chart_of_accounts(id, account_type, current_balance)")
        .eq("journal_entry_id", id);

      if (linesErr) throw linesErr;

      // Update entry status
      const { error: updateErr } = await sb
        .from("journal_entries")
        .update({
          status: "voided",
          voided_at: new Date().toISOString(),
          voided_by: userId,
          voided_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateErr) throw updateErr;

      // Reverse account balances
      for (const line of lines ?? []) {
        const acct = line.chart_of_accounts as Record<string, unknown> | null;
        if (!acct) continue;

        const accountType = acct.account_type as AccountType;
        const currentBalance = Number(acct.current_balance) || 0;
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        const normalBalance = ACCOUNT_TYPE_NORMAL_BALANCE[accountType];

        // Reverse: opposite of posting
        const delta =
          normalBalance === "debit"
            ? credit - debit
            : debit - credit;

        const newBalance = Math.round((currentBalance + delta) * 100) / 100;

        await sb
          .from("chart_of_accounts")
          .update({
            current_balance: newBalance,
            updated_at: new Date().toISOString(),
          })
          .eq("id", line.account_id);
      }

      logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "journal_entry_voided",
        details: {
          entry_id: id,
          entry_date: entry.entry_date,
          description: entry.description,
          total_amount: Number(entry.total_amount),
          reason,
        },
      });

      // Return updated entry
      const { data: updated } = await sb
        .from("journal_entries")
        .select("*")
        .eq("id", id)
        .single();

      return NextResponse.json({
        ...updated,
        total_amount: Number(updated?.total_amount),
      });
    }

    // ── Edit draft entry (no status transition) ─────────────────────
    if (currentStatus !== "draft") {
      return NextResponse.json(
        { error: "Only draft entries can be edited" },
        { status: 400 },
      );
    }

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.description !== undefined) update.description = body.description;
    if (body.reference !== undefined) update.reference = body.reference;
    if (body.entry_date !== undefined) update.entry_date = body.entry_date;

    // Replace lines if provided
    if (Array.isArray(body.lines)) {
      const newLines = body.lines as Record<string, unknown>[];

      if (newLines.length < 2) {
        return NextResponse.json(
          { error: "A journal entry requires at least 2 lines" },
          { status: 400 },
        );
      }

      // Validate balance
      let totalDebits = 0;
      let totalCredits = 0;

      for (let i = 0; i < newLines.length; i++) {
        const line = newLines[i];
        if (!line.account_id) {
          return NextResponse.json(
            { error: `Line ${i + 1}: missing account_id` },
            { status: 400 },
          );
        }
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        if (debit < 0 || credit < 0) {
          return NextResponse.json(
            { error: `Line ${i + 1}: debit and credit must be non-negative` },
            { status: 400 },
          );
        }
        if (debit === 0 && credit === 0) {
          return NextResponse.json(
            { error: `Line ${i + 1}: must have a debit or credit amount` },
            { status: 400 },
          );
        }
        totalDebits += debit;
        totalCredits += credit;
      }

      totalDebits = Math.round(totalDebits * 100) / 100;
      totalCredits = Math.round(totalCredits * 100) / 100;

      if (totalDebits !== totalCredits) {
        return NextResponse.json(
          {
            error: `Entry does not balance: debits ($${totalDebits.toFixed(2)}) !== credits ($${totalCredits.toFixed(2)})`,
          },
          { status: 400 },
        );
      }

      update.total_amount = totalDebits;

      // Delete old lines and insert new ones
      const { error: delErr } = await sb
        .from("journal_entry_lines")
        .delete()
        .eq("journal_entry_id", id);

      if (delErr) throw delErr;

      const lineInserts = newLines.map((line, idx) => ({
        journal_entry_id: id,
        account_id: line.account_id as string,
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        description: (line.description as string) || null,
        line_order: idx + 1,
      }));

      const { error: insertErr } = await sb
        .from("journal_entry_lines")
        .insert(lineInserts);

      if (insertErr) throw insertErr;
    }

    const { data: updated, error: updateErr } = await sb
      .from("journal_entries")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return NextResponse.json({
      ...updated,
      total_amount: Number(updated.total_amount),
    });
  } catch (err) {
    console.error("[API-ERROR]", `/api/accounting/entries/${id} PATCH`, err);
    return NextResponse.json(
      { error: "Failed to update journal entry" },
      { status: 502 },
    );
  }
}

/**
 * DELETE /api/accounting/entries/[id]
 * Hard-delete a draft journal entry and its lines.
 * Only draft entries can be deleted. Manager/developer only.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const sb = getSupabase();

    const { data: entry, error: fetchErr } = await sb
      .from("journal_entries")
      .select("id, status, description, entry_date, total_amount")
      .eq("id", id)
      .single();

    if (fetchErr || !entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (entry.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft entries can be deleted" },
        { status: 400 },
      );
    }

    // Delete lines first (foreign key), then the entry
    const { error: linesDelErr } = await sb
      .from("journal_entry_lines")
      .delete()
      .eq("journal_entry_id", id);

    if (linesDelErr) throw linesDelErr;

    const { error: entryDelErr } = await sb
      .from("journal_entries")
      .delete()
      .eq("id", id);

    if (entryDelErr) throw entryDelErr;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "journal_entry_deleted",
      details: {
        entry_id: id,
        entry_date: entry.entry_date,
        description: entry.description,
        total_amount: Number(entry.total_amount),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[API-ERROR]", `/api/accounting/entries/${id} DELETE`, err);
    return NextResponse.json(
      { error: "Failed to delete journal entry" },
      { status: 502 },
    );
  }
}
