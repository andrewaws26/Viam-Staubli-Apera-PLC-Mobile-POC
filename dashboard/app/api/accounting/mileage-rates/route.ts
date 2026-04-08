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
 * GET /api/accounting/mileage-rates
 * List mileage rates.
 *   ?active_only=true  — only active rates
 *   ?as_of_date=YYYY-MM-DD — returns the effective rate for that date (most recent effective_date <= as_of_date)
 * Manager/developer only.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const activeOnly = params.get("active_only") === "true";
  const asOfDate = params.get("as_of_date");

  try {
    const sb = getSupabase();

    // Return the effective rate for a given date
    if (asOfDate) {
      let query = sb
        .from("mileage_rates")
        .select("*")
        .lte("effective_date", asOfDate)
        .eq("is_active", true)
        .order("effective_date", { ascending: false });

      const rateType = params.get("rate_type");
      if (rateType) query = query.eq("rate_type", rateType);

      const { data, error } = await query.limit(1);
      if (error) throw error;
      return NextResponse.json(data?.[0] ?? null);
    }

    // List all rates
    let query = sb
      .from("mileage_rates")
      .select("*")
      .order("effective_date", { ascending: false });

    if (activeOnly) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/mileage-rates GET", err);
    return NextResponse.json({ error: "Failed to fetch mileage rates" }, { status: 502 });
  }
}

/**
 * POST /api/accounting/mileage-rates
 * Create a new mileage rate.
 * Body: { effective_date, rate_per_mile, rate_type?, description? }
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

  const { effective_date, rate_per_mile, rate_type, description } = body as {
    effective_date?: string;
    rate_per_mile?: number;
    rate_type?: string;
    description?: string;
  };

  if (!effective_date || rate_per_mile == null)
    return NextResponse.json({ error: "Missing required fields: effective_date, rate_per_mile" }, { status: 400 });

  try {
    const sb = getSupabase();

    const { data, error } = await sb
      .from("mileage_rates")
      .insert({
        effective_date,
        rate_per_mile,
        rate_type: rate_type || "standard",
        description: description || null,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/mileage-rates POST", err);
    return NextResponse.json({ error: "Failed to create mileage rate" }, { status: 502 });
  }
}

/**
 * PATCH /api/accounting/mileage-rates
 * Update a mileage rate.
 * Body: { id, effective_date?, rate_per_mile?, rate_type?, description?, is_active? }
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
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const allowedFields = ["effective_date", "rate_per_mile", "rate_type", "description", "is_active"];
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });

  try {
    const sb = getSupabase();

    const { data, error } = await sb
      .from("mileage_rates")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/mileage-rates PATCH", err);
    return NextResponse.json({ error: "Failed to update mileage rate" }, { status: 502 });
  }
}

/**
 * DELETE /api/accounting/mileage-rates
 * Soft-deactivate a mileage rate (sets is_active = false).
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

    const { data, error } = await sb
      .from("mileage_rates")
      .update({ is_active: false })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/mileage-rates DELETE", err);
    return NextResponse.json({ error: "Failed to deactivate mileage rate" }, { status: 502 });
  }
}
