import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";
import { checkIdempotency, saveIdempotency } from "@/lib/idempotency";
import type { JournalEntrySource } from "@ironsight/shared/accounting";

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

const VALID_SOURCES: JournalEntrySource[] = [
  "manual",
  "timesheet_approved",
  "per_diem",
  "expense_approved",
  "payroll",
  "invoice",
  "adjustment",
];

/**
 * GET /api/accounting/entries
 * List journal entries, ordered by entry_date DESC.
 * Optional filters: ?status, ?source, ?from, ?to.
 * Joins journal_entry_lines with account info.
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
  const status = params.get("status");
  const source = params.get("source");
  const from = params.get("from");
  const to = params.get("to");

  try {
    const sb = getSupabase();

    // Fetch entries
    let query = sb
      .from("journal_entries")
      .select("*")
      .order("entry_date", { ascending: false })
      .limit(500);

    if (status) query = query.eq("status", status);
    if (source) query = query.eq("source", source);
    if (from) query = query.gte("entry_date", from);
    if (to) query = query.lte("entry_date", to);

    const { data: entries, error: entriesErr } = await query;
    if (entriesErr) throw entriesErr;

    if (!entries || entries.length === 0) return NextResponse.json([]);

    // Fetch all lines for these entries with account info
    const entryIds = entries.map((e) => e.id);
    const { data: lines, error: linesErr } = await sb
      .from("journal_entry_lines")
      .select(
        "*, chart_of_accounts(account_number, name)",
      )
      .in("journal_entry_id", entryIds)
      .order("line_order", { ascending: true });

    if (linesErr) throw linesErr;

    // Map lines onto entries
    const linesByEntry = new Map<string, typeof lines>();
    for (const line of lines ?? []) {
      const entryId = line.journal_entry_id as string;
      if (!linesByEntry.has(entryId)) linesByEntry.set(entryId, []);
      linesByEntry.get(entryId)!.push(line);
    }

    const result = entries.map((entry) => {
      const entryLines = (linesByEntry.get(entry.id) ?? []).map((line) => {
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
      return { ...entry, total_amount: Number(entry.total_amount), lines: entryLines };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/entries GET", err);
    return NextResponse.json(
      { error: "Failed to fetch journal entries" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/accounting/entries
 * Create a journal entry with lines.
 * Required: entry_date, description, lines[{account_id, debit, credit}].
 * Optional: reference, source, source_id.
 * Validates total debits === total credits.
 * Manager/developer only.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Idempotency guard — prevent duplicate journal entries
  const idemKey = request.headers.get("x-idempotency-key");
  if (idemKey) {
    const cached = checkIdempotency(idemKey);
    if (cached) return NextResponse.json(cached.body, { status: cached.status });
  }

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

  const { entry_date, description, reference, source, source_id, lines } =
    body as Record<string, unknown>;

  // --- Validation ---
  if (!entry_date || !description) {
    return NextResponse.json(
      { error: "Missing required fields: entry_date, description" },
      { status: 400 },
    );
  }

  if (!Array.isArray(lines) || lines.length < 2) {
    return NextResponse.json(
      { error: "A journal entry requires at least 2 lines" },
      { status: 400 },
    );
  }

  if (source && !VALID_SOURCES.includes(source as JournalEntrySource)) {
    return NextResponse.json(
      { error: `source must be one of: ${VALID_SOURCES.join(", ")}` },
      { status: 400 },
    );
  }

  // Validate each line and compute totals
  let totalDebits = 0;
  let totalCredits = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as Record<string, unknown>;
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

  // Round to avoid floating-point issues (2 decimal places)
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

  try {
    const sb = getSupabase();

    // Check period is not locked/closed
    const { data: period } = await sb
      .from("accounting_periods")
      .select("status, label")
      .lte("start_date", entry_date as string)
      .gte("end_date", entry_date as string)
      .maybeSingle();

    if (period?.status === "locked" || period?.status === "closed") {
      return NextResponse.json(
        { error: `Cannot create entry in a ${period.status} accounting period (${period.label})` },
        { status: 400 },
      );
    }

    // Create the journal entry header
    const { data: entry, error: entryErr } = await sb
      .from("journal_entries")
      .insert({
        entry_date: entry_date as string,
        description: description as string,
        reference: (reference as string) || null,
        source: (source as string) || "manual",
        source_id: (source_id as string) || null,
        status: "draft",
        total_amount: totalDebits,
        created_by: userId,
        created_by_name: userInfo.name,
      })
      .select()
      .single();

    if (entryErr) throw entryErr;

    // Insert all lines
    const lineInserts = (lines as Record<string, unknown>[]).map(
      (line, idx) => ({
        journal_entry_id: entry.id,
        account_id: line.account_id as string,
        debit: Number(line.debit) || 0,
        credit: Number(line.credit) || 0,
        description: (line.description as string) || null,
        line_order: idx + 1,
      }),
    );

    const { data: insertedLines, error: linesErr } = await sb
      .from("journal_entry_lines")
      .insert(lineInserts)
      .select();

    if (linesErr) throw linesErr;

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "journal_entry_created",
      details: {
        entry_id: entry.id,
        entry_date: entry.entry_date,
        description: entry.description,
        source: entry.source,
        total_amount: totalDebits,
        line_count: lines.length,
      },
    });

    return NextResponse.json(
      { ...entry, total_amount: Number(entry.total_amount), lines: insertedLines },
      { status: 201 },
    );
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/entries POST", err);
    return NextResponse.json(
      { error: "Failed to create journal entry" },
      { status: 502 },
    );
  }
}
