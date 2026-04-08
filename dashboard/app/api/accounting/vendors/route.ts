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
 * GET /api/accounting/vendors
 * List all vendors. Optional ?active_only=true, ?is_1099=true.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const activeOnly = params.get("active_only") === "true";
  const is1099 = params.get("is_1099") === "true";

  try {
    const sb = getSupabase();
    let query = sb.from("vendors").select("*").order("company_name", { ascending: true });
    if (activeOnly) query = query.eq("is_active", true);
    if (is1099) query = query.eq("is_1099_vendor", true);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/vendors GET", err);
    return NextResponse.json({ error: "Failed to fetch vendors" }, { status: 502 });
  }
}

/**
 * POST /api/accounting/vendors — Create vendor. Manager/developer only.
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
    const { data, error } = await sb.from("vendors").insert({
      company_name: body.company_name,
      contact_name: body.contact_name || null,
      email: body.email || null,
      phone: body.phone || null,
      address: body.address || null,
      payment_terms: body.payment_terms || "Net 30",
      default_expense_account_id: body.default_expense_account_id || null,
      tax_id: body.tax_id || null,
      is_1099_vendor: body.is_1099_vendor || false,
      notes: body.notes || null,
    }).select().single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/vendors POST", err);
    return NextResponse.json({ error: "Failed to create vendor" }, { status: 502 });
  }
}

/**
 * PATCH /api/accounting/vendors — Update vendor. Manager/developer only.
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

  const allowed = ["company_name", "contact_name", "email", "phone", "address", "payment_terms", "default_expense_account_id", "tax_id", "is_1099_vendor", "notes", "is_active"];
  const safe: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) { if (k in updates) safe[k] = updates[k]; }

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from("vendors").update(safe).eq("id", id as string).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/vendors PATCH", err);
    return NextResponse.json({ error: "Failed to update vendor" }, { status: 502 });
  }
}
