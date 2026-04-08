import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

async function getUserInfo(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) || "operator";
    return { role };
  } catch {
    return { role: "operator" };
  }
}

/**
 * GET /api/accounting/customers
 * List all customers. Optional ?active_only=true.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const activeOnly = params.get("active_only") === "true";

  try {
    const sb = getSupabase();
    let query = sb.from("customers").select("*").order("company_name", { ascending: true });
    if (activeOnly) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/customers GET", err);
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 502 });
  }
}

/**
 * POST /api/accounting/customers — Create customer. Manager/developer only.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.company_name)
    return NextResponse.json({ error: "company_name is required" }, { status: 400 });

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from("customers").insert({
      company_name: body.company_name,
      contact_name: body.contact_name || null,
      email: body.email || null,
      phone: body.phone || null,
      billing_address: body.billing_address || null,
      payment_terms: body.payment_terms || "Net 30",
      credit_limit: body.credit_limit || null,
      tax_id: body.tax_id || null,
      notes: body.notes || null,
    }).select().single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/customers POST", err);
    return NextResponse.json({ error: "Failed to create customer" }, { status: 502 });
  }
}

/**
 * PATCH /api/accounting/customers — Update customer. Manager/developer only.
 */
export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const allowed = ["company_name", "contact_name", "email", "phone", "billing_address", "payment_terms", "credit_limit", "tax_id", "notes", "is_active"];
  const safe: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) { if (k in updates) safe[k] = updates[k]; }

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from("customers").update(safe).eq("id", id as string).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/customers PATCH", err);
    return NextResponse.json({ error: "Failed to update customer" }, { status: 502 });
  }
}
