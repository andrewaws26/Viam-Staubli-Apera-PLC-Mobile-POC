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
 * GET /api/accounting/recurring
 * List all recurring journal entry templates with their lines.
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
      .from("recurring_journal_entries")
      .select("*, recurring_journal_entry_lines(*, chart_of_accounts(account_number, name))")
      .order("next_date", { ascending: true });

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/recurring GET", err);
    return NextResponse.json({ error: "Failed to fetch recurring entries" }, { status: 502 });
  }
}

/**
 * POST /api/accounting/recurring
 * Create a new recurring journal entry template.
 * Body: { description, reference?, frequency, next_date, end_date?, lines: [{account_id, debit, credit, description?}] }
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

  const { description, reference, frequency, next_date, end_date, lines } = body as {
    description?: string;
    reference?: string;
    frequency?: string;
    next_date?: string;
    end_date?: string;
    lines?: { account_id: string; debit: number; credit: number; description?: string }[];
  };

  if (!description || !frequency || !next_date || !lines || lines.length < 2)
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

  // Verify balanced
  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100))
    return NextResponse.json({ error: "Lines must balance (total debits = total credits)" }, { status: 400 });

  try {
    const sb = getSupabase();

    const { data: entry, error: entryErr } = await sb
      .from("recurring_journal_entries")
      .insert({
        description,
        reference: reference || null,
        frequency,
        next_date,
        end_date: end_date || null,
        created_by: userId,
        created_by_name: userInfo.name,
      })
      .select()
      .single();

    if (entryErr) throw entryErr;

    const { error: linesErr } = await sb
      .from("recurring_journal_entry_lines")
      .insert(
        lines.map((l, i) => ({
          recurring_entry_id: entry.id,
          account_id: l.account_id,
          debit: l.debit || 0,
          credit: l.credit || 0,
          description: l.description || null,
          line_order: i,
        }))
      );

    if (linesErr) throw linesErr;

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "recurring_entry_created",
      details: { id: entry.id, description, frequency },
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/recurring POST", err);
    return NextResponse.json({ error: "Failed to create recurring entry" }, { status: 502 });
  }
}

/**
 * PATCH /api/accounting/recurring
 * Generate due recurring entries (creates draft journal entries for all templates where next_date <= today).
 * Also used to pause/resume: { id, is_active: false }
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

  // If updating a specific template (pause/resume)
  if (body.id) {
    try {
      const sb = getSupabase();
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.is_active === "boolean") updates.is_active = body.is_active;
      if (body.next_date) updates.next_date = body.next_date;
      if (body.end_date !== undefined) updates.end_date = body.end_date || null;

      const { data, error } = await sb
        .from("recurring_journal_entries")
        .update(updates)
        .eq("id", body.id as string)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    } catch (err) {
      console.error("[API-ERROR]", "/api/accounting/recurring PATCH", err);
      return NextResponse.json({ error: "Failed to update recurring entry" }, { status: 502 });
    }
  }

  // Generate all due entries
  if (body.action === "generate") {
    const today = new Date().toISOString().split("T")[0];

    try {
      const sb = getSupabase();

      // Find active templates that are due
      const { data: dueTemplates, error: fetchErr } = await sb
        .from("recurring_journal_entries")
        .select("*, recurring_journal_entry_lines(*)")
        .eq("is_active", true)
        .lte("next_date", today);

      if (fetchErr) throw fetchErr;

      if (!dueTemplates || dueTemplates.length === 0)
        return NextResponse.json({ generated: 0, message: "No recurring entries due" });

      let generated = 0;

      for (const template of dueTemplates) {
        // Check end_date
        if (template.end_date && template.next_date > template.end_date) {
          // Past end date, deactivate
          await sb.from("recurring_journal_entries").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", template.id);
          continue;
        }

        const lines = template.recurring_journal_entry_lines as {
          account_id: string;
          debit: number;
          credit: number;
          description: string | null;
          line_order: number;
        }[];

        if (!lines || lines.length === 0) continue;

        const totalAmount = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);

        // Create draft journal entry
        const { data: entry, error: entryErr } = await sb
          .from("journal_entries")
          .insert({
            entry_date: template.next_date,
            description: template.description,
            reference: template.reference,
            source: "adjustment",
            source_id: template.id,
            status: "draft",
            total_amount: Math.round(totalAmount * 100) / 100,
            created_by: userId,
            created_by_name: `Auto (${userInfo.name})`,
          })
          .select()
          .single();

        if (entryErr) {
          console.error("[RECURRING]", `Failed to create entry for template ${template.id}`, entryErr);
          continue;
        }

        await sb.from("journal_entry_lines").insert(
          lines.map((l) => ({
            journal_entry_id: entry.id,
            account_id: l.account_id,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
            line_order: l.line_order,
          }))
        );

        // Advance next_date
        const nextDate = new Date(template.next_date + "T12:00:00");
        if (template.frequency === "monthly") {
          nextDate.setMonth(nextDate.getMonth() + 1);
        } else if (template.frequency === "quarterly") {
          nextDate.setMonth(nextDate.getMonth() + 3);
        } else if (template.frequency === "annually") {
          nextDate.setFullYear(nextDate.getFullYear() + 1);
        }

        await sb.from("recurring_journal_entries").update({
          next_date: nextDate.toISOString().split("T")[0],
          updated_at: new Date().toISOString(),
        }).eq("id", template.id);

        generated++;
      }

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "recurring_entries_generated",
        details: { generated, checked: dueTemplates.length },
      });

      return NextResponse.json({ generated, message: `Generated ${generated} draft journal entries` });
    } catch (err) {
      console.error("[API-ERROR]", "/api/accounting/recurring PATCH generate", err);
      return NextResponse.json({ error: "Failed to generate recurring entries" }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "Invalid request — provide id or action" }, { status: 400 });
}

/**
 * DELETE /api/accounting/recurring
 * Delete a recurring entry template.
 * Query: ?id=<uuid>
 * Manager/developer only.
 */
export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const sb = getSupabase();
    const { error } = await sb.from("recurring_journal_entries").delete().eq("id", id);
    if (error) throw error;

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "recurring_entry_deleted",
      details: { id },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/recurring DELETE", err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 502 });
  }
}
