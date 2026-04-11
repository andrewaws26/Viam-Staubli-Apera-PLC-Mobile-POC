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
 * GET /api/accounting/estimates
 * List estimates. Optional filters: ?status=, ?customer_id=
 * Single estimate with full details: ?id=uuid
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

    // Single estimate with full details
    if (id) {
      const { data, error } = await sb.from("estimates")
        .select("*, customers(company_name, contact_name, email, phone, billing_address), estimate_line_items(*)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return NextResponse.json(data);
    }

    let query = sb.from("estimates")
      .select("*, customers(company_name), estimate_line_items(count)")
      .order("estimate_date", { ascending: false });

    if (status) query = query.eq("status", status);
    if (customerId) query = query.eq("customer_id", customerId);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/estimates GET", err);
    return NextResponse.json({ error: "Failed to fetch estimates" }, { status: 502 });
  }
}

/**
 * POST /api/accounting/estimates
 * Create a new estimate with line items.
 * Body: { customer_id, estimate_date, expiry_date?, notes?, terms?, tax_rate?,
 *         lines: [{description, quantity, unit_price}] }
 *
 * Auto-generates estimate_number from sequence.
 * Auto-computes subtotal, tax, total from lines.
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

  const { customer_id, estimate_date, expiry_date, notes, terms, tax_rate, lines } = body as {
    customer_id?: string;
    estimate_date?: string;
    expiry_date?: string;
    notes?: string;
    terms?: string;
    tax_rate?: number;
    lines?: { description: string; quantity: number; unit_price: number }[];
  };

  if (!customer_id || !lines || lines.length === 0)
    return NextResponse.json({ error: "Missing required fields (customer_id, lines)" }, { status: 400 });

  // Compute totals
  const subtotal = lines.reduce((s, l) => s + (l.quantity || 1) * (l.unit_price || 0), 0);
  const taxRateVal = tax_rate || 0;
  const taxAmount = Math.round(subtotal * taxRateVal * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  try {
    const sb = getSupabase();

    // Get next estimate number from sequence
    const { data: seqData, error: seqErr } = await sb.rpc("nextval_text", { seq_name: "estimate_number_seq" });
    let estimateNumber: number;
    if (seqErr || !seqData) {
      // Fallback: query max estimate_number and increment
      const { data: maxRow } = await sb.from("estimates").select("estimate_number").order("estimate_number", { ascending: false }).limit(1);
      estimateNumber = (maxRow && maxRow.length > 0) ? Number(maxRow[0].estimate_number) + 1 : 1001;
    } else {
      estimateNumber = Number(seqData);
    }

    const { data: estimate, error: estErr } = await sb
      .from("estimates")
      .insert({
        estimate_number: estimateNumber,
        customer_id,
        estimate_date: estimate_date || new Date().toISOString().split("T")[0],
        expiry_date: expiry_date || null,
        notes: notes || null,
        terms: terms || null,
        tax_rate: taxRateVal,
        subtotal: Math.round(subtotal * 100) / 100,
        tax_amount: taxAmount,
        total,
        created_by: userId,
        created_by_name: userInfo.name,
      })
      .select()
      .single();

    if (estErr) throw estErr;

    // Insert line items
    const { error: linesErr } = await sb
      .from("estimate_line_items")
      .insert(
        lines.map((l, i) => ({
          estimate_id: estimate.id,
          description: l.description,
          quantity: l.quantity || 1,
          unit_price: l.unit_price || 0,
          amount: Math.round((l.quantity || 1) * (l.unit_price || 0) * 100) / 100,
          line_order: i,
        }))
      );

    if (linesErr) throw linesErr;

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "estimate_created",
      details: {
        estimate_id: estimate.id,
        estimate_number: estimateNumber,
        customer_id,
        total,
      },
    });

    return NextResponse.json(estimate, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/estimates POST", err);
    return NextResponse.json({ error: "Failed to create estimate" }, { status: 502 });
  }
}

/**
 * PATCH /api/accounting/estimates
 * Status transitions and estimate-to-invoice conversion.
 *
 * Send:    { id, action: "send" }    — draft -> sent, sets sent_at
 * Accept:  { id, action: "accept" }  — sent -> accepted, sets accepted_at
 * Reject:  { id, action: "reject" }  — sent -> rejected
 * Expire:  { id, action: "expire" }  — sent -> expired
 * Convert: { id, action: "convert" } — accepted -> converted, creates invoice
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

    // Fetch estimate with line items
    const { data: estimate, error: fetchErr } = await sb
      .from("estimates")
      .select("*, estimate_line_items(*)")
      .eq("id", id)
      .single();

    if (fetchErr || !estimate) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });

    if (action === "send") {
      if (estimate.status !== "draft")
        return NextResponse.json({ error: "Can only send a draft estimate" }, { status: 400 });

      const { data: updated, error: upErr } = await sb.from("estimates").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();

      if (upErr) throw upErr;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "estimate_sent",
        details: { estimate_id: id, estimate_number: estimate.estimate_number, total: estimate.total },
      });

      return NextResponse.json(updated);

    } else if (action === "accept") {
      if (estimate.status !== "sent")
        return NextResponse.json({ error: "Can only accept a sent estimate" }, { status: 400 });

      const { data: updated, error: upErr } = await sb.from("estimates").update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();

      if (upErr) throw upErr;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "estimate_accepted",
        details: { estimate_id: id, estimate_number: estimate.estimate_number },
      });

      return NextResponse.json(updated);

    } else if (action === "reject") {
      if (estimate.status !== "sent")
        return NextResponse.json({ error: "Can only reject a sent estimate" }, { status: 400 });

      const { data: updated, error: upErr } = await sb.from("estimates").update({
        status: "rejected",
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();

      if (upErr) throw upErr;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "estimate_rejected",
        details: { estimate_id: id, estimate_number: estimate.estimate_number },
      });

      return NextResponse.json(updated);

    } else if (action === "expire") {
      if (estimate.status !== "sent")
        return NextResponse.json({ error: "Can only expire a sent estimate" }, { status: 400 });

      const { data: updated, error: upErr } = await sb.from("estimates").update({
        status: "expired",
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();

      if (upErr) throw upErr;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "estimate_expired",
        details: { estimate_id: id, estimate_number: estimate.estimate_number },
      });

      return NextResponse.json(updated);

    } else if (action === "convert") {
      if (estimate.status !== "accepted")
        return NextResponse.json({ error: "Can only convert an accepted estimate" }, { status: 400 });

      // Create invoice from estimate — uses the invoice_number_seq for auto-numbering
      const { data: invoice, error: invErr } = await sb
        .from("invoices")
        .insert({
          customer_id: estimate.customer_id,
          invoice_date: new Date().toISOString().split("T")[0],
          due_date: estimate.expiry_date || new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
          notes: estimate.notes || null,
          terms: estimate.terms || null,
          tax_rate: Number(estimate.tax_rate),
          subtotal: Number(estimate.subtotal),
          tax_amount: Number(estimate.tax_amount),
          total: Number(estimate.total),
          balance_due: Number(estimate.total),
          amount_paid: 0,
          created_by: userId,
          created_by_name: userInfo.name,
        })
        .select()
        .single();

      if (invErr) throw invErr;

      // Copy line items to invoice_line_items
      const lineItems = estimate.estimate_line_items as {
        description: string; quantity: number; unit_price: number; amount: number; line_order: number;
      }[];

      if (lineItems && lineItems.length > 0) {
        const { error: linesErr } = await sb.from("invoice_line_items").insert(
          lineItems.map((l) => ({
            invoice_id: invoice.id,
            description: l.description,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
            amount: Number(l.amount),
            line_order: l.line_order,
          }))
        );
        if (linesErr) throw linesErr;
      }

      // Mark estimate as converted
      const { data: updated, error: upErr } = await sb.from("estimates").update({
        status: "converted",
        converted_invoice_id: invoice.id,
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();

      if (upErr) throw upErr;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "estimate_converted",
        details: {
          estimate_id: id,
          estimate_number: estimate.estimate_number,
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
        },
      });

      return NextResponse.json({ estimate: updated, invoice });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/estimates PATCH", err);
    return NextResponse.json({ error: "Failed to update estimate" }, { status: 502 });
  }
}

/**
 * DELETE /api/accounting/estimates
 * Delete a draft estimate entirely, or void non-draft estimates.
 * Body: { id }
 * Manager/developer only.
 */
export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const id = body.id as string;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const sb = getSupabase();

    const { data: estimate, error: fetchErr } = await sb
      .from("estimates")
      .select("id, status, estimate_number")
      .eq("id", id)
      .single();

    if (fetchErr || !estimate) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });

    if (estimate.status === "draft") {
      // Hard delete drafts (line items cascade)
      const { error: delErr } = await sb.from("estimates").delete().eq("id", id);
      if (delErr) throw delErr;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "estimate_deleted",
        details: { estimate_id: id, estimate_number: estimate.estimate_number },
      });

      return NextResponse.json({ deleted: true });
    } else {
      // Non-draft: set status to rejected as a soft void
      const { data: updated, error: upErr } = await sb.from("estimates").update({
        status: "rejected",
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();

      if (upErr) throw upErr;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "estimate_voided",
        details: { estimate_id: id, estimate_number: estimate.estimate_number },
      });

      return NextResponse.json(updated);
    }
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/estimates DELETE", err);
    return NextResponse.json({ error: "Failed to delete estimate" }, { status: 502 });
  }
}
