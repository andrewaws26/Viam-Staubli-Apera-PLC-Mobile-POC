import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";
import { checkIdempotency, saveIdempotency } from "@/lib/idempotency";

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
 * GET /api/accounting/invoices
 * List invoices. Optional filters: ?status=, ?customer_id=
 * Manager/developer only.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const id = params.get("id");
  const status = params.get("status");
  const customerId = params.get("customer_id");

  try {
    const sb = getSupabase();

    // Single invoice with full details (for PDF, detail view)
    if (id) {
      const { data, error } = await sb.from("invoices")
        .select("*, customers(company_name, contact_name, email, phone, billing_address), invoice_line_items(*)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return NextResponse.json(data);
    }

    let query = sb.from("invoices")
      .select("*, customers(company_name), invoice_line_items(count)")
      .order("invoice_date", { ascending: false });

    if (status) query = query.eq("status", status);
    if (customerId) query = query.eq("customer_id", customerId);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/invoices GET", err);
    return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 502 });
  }
}

/**
 * POST /api/accounting/invoices
 * Create a new invoice with line items.
 * Body: { customer_id, invoice_date, due_date, notes?, terms?, tax_rate?,
 *         lines: [{description, quantity, unit_price, account_id?, timesheet_id?}] }
 *
 * Auto-computes subtotal, tax, total, balance_due.
 * Manager/developer only.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Idempotency guard — prevent duplicate invoices
  const idemKey = request.headers.get("x-idempotency-key");
  if (idemKey) {
    const cached = checkIdempotency(idemKey);
    if (cached) return NextResponse.json(cached.body, { status: cached.status });
  }

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { customer_id, invoice_date, due_date, notes, terms, tax_rate, job_id, lines } = body as {
    customer_id?: string;
    invoice_date?: string;
    due_date?: string;
    notes?: string;
    terms?: string;
    tax_rate?: number;
    job_id?: string;
    lines?: { description: string; quantity: number; unit_price: number; account_id?: string; timesheet_id?: string }[];
  };

  if (!customer_id || !invoice_date || !due_date || !lines || lines.length === 0)
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

  // Compute totals
  const subtotal = lines.reduce((s, l) => s + (l.quantity || 1) * (l.unit_price || 0), 0);
  const taxRateVal = tax_rate || 0;
  const taxAmount = Math.round(subtotal * taxRateVal * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  try {
    const sb = getSupabase();

    const { data: invoice, error: invErr } = await sb
      .from("invoices")
      .insert({
        customer_id,
        invoice_date,
        due_date,
        job_id: job_id || null,
        notes: notes || null,
        terms: terms || null,
        tax_rate: taxRateVal,
        subtotal: Math.round(subtotal * 100) / 100,
        tax_amount: taxAmount,
        total,
        balance_due: total,
        amount_paid: 0,
        created_by: userId,
        created_by_name: userInfo.name,
      })
      .select()
      .single();

    if (invErr) throw invErr;

    // Insert line items
    const { error: linesErr } = await sb
      .from("invoice_line_items")
      .insert(
        lines.map((l, i) => ({
          invoice_id: invoice.id,
          description: l.description,
          quantity: l.quantity || 1,
          unit_price: l.unit_price || 0,
          amount: Math.round((l.quantity || 1) * (l.unit_price || 0) * 100) / 100,
          account_id: l.account_id || null,
          timesheet_id: l.timesheet_id || null,
          line_order: i,
        }))
      );

    if (linesErr) throw linesErr;

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "invoice_created",
      details: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_id,
        total,
      },
    });

    return NextResponse.json(invoice, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/invoices POST", err);
    return NextResponse.json({ error: "Failed to create invoice" }, { status: 502 });
  }
}

/**
 * PATCH /api/accounting/invoices
 * Update invoice status or record a payment.
 *
 * Send invoice:     { id, action: "send" }
 * Void invoice:     { id, action: "void" }
 * Record payment:   { id, action: "payment", payment_date, amount, payment_method, reference?, notes? }
 *
 * Sending auto-generates JE: DR 1100 Accounts Receivable / CR revenue accounts
 * Payment auto-generates JE: DR 1000 Cash / CR 1100 Accounts Receivable
 *
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

    // Fetch invoice
    const { data: invoice, error: fetchErr } = await sb
      .from("invoices")
      .select("*, invoice_line_items(*)")
      .eq("id", id)
      .single();

    if (fetchErr || !invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (action === "send") {
      if (invoice.status !== "draft")
        return NextResponse.json({ error: "Can only send a draft invoice" }, { status: 400 });

      // Find AR account (1100) and default revenue account (4000)
      const { data: arAcct } = await sb.from("chart_of_accounts").select("id").eq("account_number", 1100).single();
      if (!arAcct) return NextResponse.json({ error: "Accounts Receivable (1100) not found" }, { status: 400 });

      // Create journal entry: DR AR / CR Revenue
      const jeLines: { account_id: string; debit: number; credit: number; description: string }[] = [];

      // Debit AR for total
      jeLines.push({
        account_id: arAcct.id,
        debit: Number(invoice.total),
        credit: 0,
        description: `Invoice #${invoice.invoice_number} — AR`,
      });

      // Credit revenue accounts from line items
      const lineItems = invoice.invoice_line_items as { account_id: string | null; amount: number; description: string }[];
      const { data: defaultRevAcct } = await sb.from("chart_of_accounts").select("id").eq("account_number", 4000).single();
      const defaultRevId = defaultRevAcct?.id;

      for (const li of lineItems) {
        jeLines.push({
          account_id: li.account_id || defaultRevId || arAcct.id,
          debit: 0,
          credit: Number(li.amount),
          description: li.description,
        });
      }

      // Tax credit if applicable
      if (Number(invoice.tax_amount) > 0) {
        const { data: taxAcct } = await sb.from("chart_of_accounts").select("id").eq("account_number", 2300).single();
        jeLines.push({
          account_id: taxAcct?.id || defaultRevId || arAcct.id,
          debit: 0,
          credit: Number(invoice.tax_amount),
          description: "Sales tax",
        });
      }

      const { data: je, error: jeErr } = await sb.from("journal_entries").insert({
        entry_date: invoice.invoice_date,
        description: `Invoice #${invoice.invoice_number} sent`,
        reference: `INV-${invoice.invoice_number}`,
        source: "invoice",
        source_id: invoice.id,
        status: "posted",
        total_amount: Number(invoice.total),
        created_by: userId,
        created_by_name: userInfo.name,
        posted_at: new Date().toISOString(),
      }).select().single();

      if (jeErr) throw jeErr;

      await sb.from("journal_entry_lines").insert(
        jeLines.map((l, i) => ({ journal_entry_id: je.id, account_id: l.account_id, debit: l.debit, credit: l.credit, description: l.description, line_order: i }))
      );

      // Update invoice status
      const { data: updated, error: upErr } = await sb.from("invoices").update({
        status: "sent",
        journal_entry_id: je.id,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();

      if (upErr) throw upErr;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "invoice_sent",
        details: { invoice_id: id, invoice_number: invoice.invoice_number, total: invoice.total },
      });

      return NextResponse.json(updated);

    } else if (action === "payment") {
      if (!["sent", "partial", "overdue"].includes(invoice.status))
        return NextResponse.json({ error: "Invoice must be sent before receiving payment" }, { status: 400 });

      const paymentAmount = Number(body.amount);
      if (!paymentAmount || paymentAmount <= 0)
        return NextResponse.json({ error: "Payment amount must be positive" }, { status: 400 });

      const balanceDue = Number(invoice.balance_due);
      if (paymentAmount > balanceDue)
        return NextResponse.json({ error: `Payment exceeds balance due (${balanceDue})` }, { status: 400 });

      // Find Cash (1000) and AR (1100) accounts
      const [cashRes, arRes] = await Promise.all([
        sb.from("chart_of_accounts").select("id").eq("account_number", 1000).single(),
        sb.from("chart_of_accounts").select("id").eq("account_number", 1100).single(),
      ]);

      if (!cashRes.data || !arRes.data)
        return NextResponse.json({ error: "Cash (1000) or AR (1100) account not found" }, { status: 400 });

      // Create payment JE: DR Cash / CR AR
      const { data: je, error: jeErr } = await sb.from("journal_entries").insert({
        entry_date: body.payment_date as string || new Date().toISOString().split("T")[0],
        description: `Payment received — Invoice #${invoice.invoice_number}`,
        reference: (body.reference as string) || `PMT-INV-${invoice.invoice_number}`,
        source: "invoice",
        source_id: invoice.id,
        status: "posted",
        total_amount: paymentAmount,
        created_by: userId,
        created_by_name: userInfo.name,
        posted_at: new Date().toISOString(),
      }).select().single();

      if (jeErr) throw jeErr;

      await sb.from("journal_entry_lines").insert([
        { journal_entry_id: je.id, account_id: cashRes.data.id, debit: paymentAmount, credit: 0, description: "Cash received", line_order: 0 },
        { journal_entry_id: je.id, account_id: arRes.data.id, debit: 0, credit: paymentAmount, description: "AR reduction", line_order: 1 },
      ]);

      // Record payment
      await sb.from("invoice_payments").insert({
        invoice_id: id,
        payment_date: body.payment_date as string || new Date().toISOString().split("T")[0],
        amount: paymentAmount,
        payment_method: (body.payment_method as string) || "check",
        reference: (body.reference as string) || null,
        notes: (body.notes as string) || null,
        journal_entry_id: je.id,
        recorded_by: userId,
        recorded_by_name: userInfo.name,
      });

      // Update invoice balances
      const newAmountPaid = Math.round((Number(invoice.amount_paid) + paymentAmount) * 100) / 100;
      const newBalanceDue = Math.round((Number(invoice.total) - newAmountPaid) * 100) / 100;
      const newStatus = newBalanceDue <= 0 ? "paid" : "partial";

      const { data: updated, error: upErr } = await sb.from("invoices").update({
        amount_paid: newAmountPaid,
        balance_due: newBalanceDue,
        status: newStatus,
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();

      if (upErr) throw upErr;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "invoice_payment_recorded",
        details: { invoice_id: id, invoice_number: invoice.invoice_number, amount: paymentAmount, new_status: newStatus },
      });

      return NextResponse.json(updated);

    } else if (action === "void") {
      if (invoice.status === "voided")
        return NextResponse.json({ error: "Invoice already voided" }, { status: 400 });

      // If there's a JE, void it
      if (invoice.journal_entry_id) {
        await sb.from("journal_entries").update({
          status: "voided",
          voided_at: new Date().toISOString(),
          voided_by: userId,
          voided_reason: "Invoice voided",
        }).eq("id", invoice.journal_entry_id);
      }

      const { data: updated, error: upErr } = await sb.from("invoices").update({
        status: "voided",
        balance_due: 0,
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();

      if (upErr) throw upErr;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "invoice_voided",
        details: { invoice_id: id, invoice_number: invoice.invoice_number },
      });

      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/invoices PATCH", err);
    return NextResponse.json({ error: "Failed to update invoice" }, { status: 502 });
  }
}
