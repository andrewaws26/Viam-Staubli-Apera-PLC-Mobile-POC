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
      ((user.publicMetadata as Record<string, unknown>)?.role as string) || "operator";
    return { name, role };
  } catch {
    return { name: "Unknown", role: "operator" };
  }
}

/**
 * GET /api/accounting/bills
 * List bills. Optional filters: ?status=, ?vendor_id=
 * Manager/developer only.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const vendorId = params.get("vendor_id");

  try {
    const sb = getSupabase();
    let query = sb.from("bills")
      .select("*, vendors(company_name), bill_line_items(count)")
      .order("bill_date", { ascending: false });

    if (status) query = query.eq("status", status);
    if (vendorId) query = query.eq("vendor_id", vendorId);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/bills GET", err);
    return NextResponse.json({ error: "Failed to fetch bills" }, { status: 502 });
  }
}

/**
 * POST /api/accounting/bills
 * Create a new bill with line items and auto-generate JE.
 * Body: { vendor_id, bill_number?, bill_date, due_date, notes?, tax_amount?,
 *         lines: [{description, quantity, unit_price, account_id}] }
 *
 * Auto-generates JE: DR expense accounts / CR 2000 Accounts Payable
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

  const { vendor_id, bill_number, bill_date, due_date, notes, tax_amount, job_id, lines } = body as {
    vendor_id?: string;
    bill_number?: string;
    bill_date?: string;
    due_date?: string;
    notes?: string;
    tax_amount?: number;
    job_id?: string;
    lines?: { description: string; quantity: number; unit_price: number; account_id: string }[];
  };

  if (!vendor_id || !bill_date || !due_date || !lines || lines.length === 0)
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

  const subtotal = lines.reduce((s, l) => s + (l.quantity || 1) * (l.unit_price || 0), 0);
  const taxAmt = tax_amount || 0;
  const total = Math.round((subtotal + taxAmt) * 100) / 100;

  try {
    const sb = getSupabase();

    // Find AP account (2000)
    const { data: apAcct } = await sb.from("chart_of_accounts").select("id").eq("account_number", 2000).single();
    if (!apAcct) return NextResponse.json({ error: "Accounts Payable (2000) not found" }, { status: 400 });

    // Create JE: DR expense accounts / CR AP
    const jeLines: { account_id: string; debit: number; credit: number; description: string }[] = [];

    for (const l of lines) {
      jeLines.push({
        account_id: l.account_id,
        debit: Math.round((l.quantity || 1) * (l.unit_price || 0) * 100) / 100,
        credit: 0,
        description: l.description,
      });
    }

    jeLines.push({
      account_id: apAcct.id,
      debit: 0,
      credit: total,
      description: `AP — ${bill_number || "vendor bill"}`,
    });

    const { data: je, error: jeErr } = await sb.from("journal_entries").insert({
      entry_date: bill_date,
      description: `Bill from vendor${bill_number ? ` #${bill_number}` : ""}`,
      reference: bill_number || null,
      source: "manual",
      status: "posted",
      total_amount: total,
      created_by: userId,
      created_by_name: userInfo.name,
      posted_at: new Date().toISOString(),
    }).select().single();

    if (jeErr) throw jeErr;

    await sb.from("journal_entry_lines").insert(
      jeLines.map((l, i) => ({ journal_entry_id: je.id, account_id: l.account_id, debit: l.debit, credit: l.credit, description: l.description, line_order: i }))
    );

    // Create bill
    const { data: bill, error: billErr } = await sb.from("bills").insert({
      vendor_id,
      job_id: job_id || null,
      bill_number: bill_number || null,
      bill_date,
      due_date,
      notes: notes || null,
      subtotal: Math.round(subtotal * 100) / 100,
      tax_amount: taxAmt,
      total,
      balance_due: total,
      amount_paid: 0,
      journal_entry_id: je.id,
      created_by: userId,
      created_by_name: userInfo.name,
    }).select().single();

    if (billErr) throw billErr;

    // Insert line items
    await sb.from("bill_line_items").insert(
      lines.map((l, i) => ({
        bill_id: bill.id,
        description: l.description,
        quantity: l.quantity || 1,
        unit_price: l.unit_price || 0,
        amount: Math.round((l.quantity || 1) * (l.unit_price || 0) * 100) / 100,
        account_id: l.account_id,
        line_order: i,
      }))
    );

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "bill_created",
      details: { bill_id: bill.id, vendor_id, total },
    });

    return NextResponse.json(bill, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/bills POST", err);
    return NextResponse.json({ error: "Failed to create bill" }, { status: 502 });
  }
}

/**
 * PATCH /api/accounting/bills
 * Record payment or void a bill.
 *
 * Payment:  { id, action: "payment", payment_date, amount, payment_method, check_number?, reference?, notes? }
 * Void:     { id, action: "void" }
 *
 * Payment JE: DR 2000 AP / CR 1000 Cash
 * Manager/developer only.
 */
export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const id = body.id as string;
  const action = body.action as string;
  if (!id || !action) return NextResponse.json({ error: "Missing id or action" }, { status: 400 });

  try {
    const sb = getSupabase();
    const { data: bill, error: fetchErr } = await sb.from("bills").select("*").eq("id", id).single();
    if (fetchErr || !bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

    if (action === "payment") {
      if (!["open", "partial"].includes(bill.status))
        return NextResponse.json({ error: "Bill must be open to receive payment" }, { status: 400 });

      const paymentAmount = Number(body.amount);
      if (!paymentAmount || paymentAmount <= 0)
        return NextResponse.json({ error: "Payment amount must be positive" }, { status: 400 });

      if (paymentAmount > Number(bill.balance_due))
        return NextResponse.json({ error: `Payment exceeds balance due` }, { status: 400 });

      // Find AP (2000) and Cash (1000)
      const [apRes, cashRes] = await Promise.all([
        sb.from("chart_of_accounts").select("id").eq("account_number", 2000).single(),
        sb.from("chart_of_accounts").select("id").eq("account_number", 1000).single(),
      ]);

      if (!apRes.data || !cashRes.data)
        return NextResponse.json({ error: "AP (2000) or Cash (1000) account not found" }, { status: 400 });

      // JE: DR AP / CR Cash
      const { data: je, error: jeErr } = await sb.from("journal_entries").insert({
        entry_date: body.payment_date as string || new Date().toISOString().split("T")[0],
        description: `Bill payment${bill.bill_number ? ` — #${bill.bill_number}` : ""}`,
        reference: (body.check_number as string) || (body.reference as string) || null,
        source: "manual",
        status: "posted",
        total_amount: paymentAmount,
        created_by: userId,
        created_by_name: userInfo.name,
        posted_at: new Date().toISOString(),
      }).select().single();

      if (jeErr) throw jeErr;

      await sb.from("journal_entry_lines").insert([
        { journal_entry_id: je.id, account_id: apRes.data.id, debit: paymentAmount, credit: 0, description: "AP payment", line_order: 0 },
        { journal_entry_id: je.id, account_id: cashRes.data.id, debit: 0, credit: paymentAmount, description: "Cash disbursement", line_order: 1 },
      ]);

      await sb.from("bill_payments").insert({
        bill_id: id,
        payment_date: body.payment_date as string || new Date().toISOString().split("T")[0],
        amount: paymentAmount,
        payment_method: (body.payment_method as string) || "check",
        check_number: (body.check_number as string) || null,
        reference: (body.reference as string) || null,
        notes: (body.notes as string) || null,
        journal_entry_id: je.id,
        recorded_by: userId,
        recorded_by_name: userInfo.name,
      });

      const newPaid = Math.round((Number(bill.amount_paid) + paymentAmount) * 100) / 100;
      const newBalance = Math.round((Number(bill.total) - newPaid) * 100) / 100;

      const { data: updated, error: upErr } = await sb.from("bills").update({
        amount_paid: newPaid,
        balance_due: newBalance,
        status: newBalance <= 0 ? "paid" : "partial",
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();

      if (upErr) throw upErr;

      logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "bill_payment_recorded",
        details: { bill_id: id, amount: paymentAmount },
      });

      return NextResponse.json(updated);

    } else if (action === "void") {
      if (bill.journal_entry_id) {
        await sb.from("journal_entries").update({
          status: "voided",
          voided_at: new Date().toISOString(),
          voided_by: userId,
          voided_reason: "Bill voided",
        }).eq("id", bill.journal_entry_id);
      }

      const { data: updated, error: upErr } = await sb.from("bills").update({
        status: "voided",
        balance_due: 0,
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();

      if (upErr) throw upErr;

      logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "bill_voided",
        details: { bill_id: id },
      });

      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/bills PATCH", err);
    return NextResponse.json({ error: "Failed to update bill" }, { status: 502 });
  }
}
