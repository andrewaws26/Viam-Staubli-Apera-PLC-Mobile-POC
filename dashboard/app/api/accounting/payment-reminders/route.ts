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
      ((user.publicMetadata as Record<string, unknown>)?.role as string) || "operator";
    return { name, role };
  } catch {
    return { name: "Unknown", role: "operator" };
  }
}

/**
 * Determine the reminder type based on how many days an invoice is overdue.
 */
function getReminderType(daysOverdue: number): string {
  if (daysOverdue >= 90) return "final_notice";
  if (daysOverdue >= 60) return "overdue_90";
  if (daysOverdue >= 30) return "overdue_60";
  if (daysOverdue >= 7) return "overdue_30";
  return "overdue_7";
}

/**
 * GET /api/accounting/payment-reminders
 *
 *   No params:        list all reminders with invoice + customer details
 *   ?overdue=true:    list overdue invoices needing reminders (balance_due > 0, past due_date)
 *   ?invoice_id=uuid: reminders for a specific invoice
 *
 * Manager/developer only.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const overdue = params.get("overdue") === "true";
  const invoiceId = params.get("invoice_id");

  try {
    const sb = getSupabase();

    // --- Overdue invoices that may need reminders ---
    if (overdue) {
      const today = new Date().toISOString().split("T")[0];

      const { data: invoices, error } = await sb
        .from("invoices")
        .select("*, customers(company_name, contact_name, email)")
        .gt("balance_due", 0)
        .lt("due_date", today)
        .in("status", ["sent", "partial", "overdue"])
        .order("due_date", { ascending: true });

      if (error) throw error;

      // Fetch the latest reminder for each invoice
      const invoiceIds = (invoices ?? []).map((i) => i.id);
      const remindersMap: Record<string, { reminder_type: string; sent_at: string | null; created_at: string }> = {};

      if (invoiceIds.length > 0) {
        const { data: reminders } = await sb
          .from("payment_reminders")
          .select("invoice_id, reminder_type, sent_at, created_at")
          .in("invoice_id", invoiceIds)
          .order("created_at", { ascending: false });

        // Keep only the most recent reminder per invoice
        for (const r of reminders ?? []) {
          const iid = r.invoice_id as string;
          if (!remindersMap[iid]) {
            remindersMap[iid] = {
              reminder_type: r.reminder_type as string,
              sent_at: r.sent_at as string | null,
              created_at: r.created_at as string,
            };
          }
        }
      }

      const enriched = (invoices ?? []).map((inv) => {
        const dueDate = new Date(inv.due_date + "T12:00:00");
        const now = new Date();
        const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        const lastReminder = remindersMap[inv.id] || null;

        return {
          ...inv,
          days_overdue: daysOverdue,
          last_reminder: lastReminder,
        };
      });

      return NextResponse.json(enriched);
    }

    // --- Reminders for specific invoice ---
    if (invoiceId) {
      const { data, error } = await sb
        .from("payment_reminders")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    // --- All reminders with invoice + customer join ---
    const { data, error } = await sb
      .from("payment_reminders")
      .select("*, invoices(invoice_number, due_date, total, balance_due, customers(company_name))")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/payment-reminders GET", err);
    return NextResponse.json({ error: "Failed to fetch payment reminders" }, { status: 502 });
  }
}

/**
 * POST /api/accounting/payment-reminders
 *
 * Actions:
 *   { action: "generate" }          — scan overdue invoices, create reminders
 *   { action: "mark_sent", reminder_id }  — mark as sent
 *   { action: "skip", reminder_id }       — mark as skipped
 *   { action: "cancel", reminder_id }     — mark as cancelled
 *
 * Manager/developer only.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const action = body.action as string;
  if (!action) return NextResponse.json({ error: "Missing action" }, { status: 400 });

  try {
    const sb = getSupabase();

    // ================================================================
    // ACTION: generate — scan overdue invoices, create reminder records
    // ================================================================
    if (action === "generate") {
      const today = new Date().toISOString().split("T")[0];

      // Fetch all overdue invoices with balance remaining
      const { data: invoices, error: invErr } = await sb
        .from("invoices")
        .select("id, invoice_number, due_date, balance_due")
        .gt("balance_due", 0)
        .lt("due_date", today)
        .in("status", ["sent", "partial", "overdue"]);

      if (invErr) throw invErr;

      if (!invoices || invoices.length === 0)
        return NextResponse.json({ created: 0, message: "No overdue invoices found" });

      // Fetch existing reminders for these invoices
      const invoiceIds = invoices.map((i) => i.id);
      const { data: existingReminders } = await sb
        .from("payment_reminders")
        .select("invoice_id, reminder_type")
        .in("invoice_id", invoiceIds);

      // Build a set of existing (invoice_id, reminder_type) pairs
      const existingSet = new Set(
        (existingReminders ?? []).map((r) => `${r.invoice_id}::${r.reminder_type}`)
      );

      const toInsert: {
        invoice_id: string;
        reminder_type: string;
        scheduled_date: string;
        created_by: string;
      }[] = [];

      for (const inv of invoices) {
        const dueDate = new Date(inv.due_date + "T12:00:00");
        const now = new Date();
        const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        const reminderType = getReminderType(daysOverdue);
        const key = `${inv.id}::${reminderType}`;

        // Skip if a reminder of this type already exists for this invoice
        if (existingSet.has(key)) continue;

        toInsert.push({
          invoice_id: inv.id,
          reminder_type: reminderType,
          scheduled_date: today,
          created_by: userId,
        });
      }

      if (toInsert.length === 0)
        return NextResponse.json({ created: 0, message: "All overdue invoices already have appropriate reminders" });

      const { error: insertErr } = await sb
        .from("payment_reminders")
        .insert(toInsert);

      if (insertErr) throw insertErr;

      return NextResponse.json({ created: toInsert.length });
    }

    // ================================================================
    // ACTION: mark_sent
    // ================================================================
    if (action === "mark_sent") {
      const reminderId = body.reminder_id as string;
      if (!reminderId) return NextResponse.json({ error: "Missing reminder_id" }, { status: 400 });

      const { data, error } = await sb
        .from("payment_reminders")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", reminderId)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    }

    // ================================================================
    // ACTION: skip
    // ================================================================
    if (action === "skip") {
      const reminderId = body.reminder_id as string;
      if (!reminderId) return NextResponse.json({ error: "Missing reminder_id" }, { status: 400 });

      const { data, error } = await sb
        .from("payment_reminders")
        .update({ status: "skipped" })
        .eq("id", reminderId)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    }

    // ================================================================
    // ACTION: cancel
    // ================================================================
    if (action === "cancel") {
      const reminderId = body.reminder_id as string;
      if (!reminderId) return NextResponse.json({ error: "Missing reminder_id" }, { status: 400 });

      const { data, error } = await sb
        .from("payment_reminders")
        .update({ status: "cancelled" })
        .eq("id", reminderId)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Invalid action — use 'generate', 'mark_sent', 'skip', or 'cancel'" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/payment-reminders POST", err);
    return NextResponse.json({ error: "Failed to process payment reminder request" }, { status: 502 });
  }
}
