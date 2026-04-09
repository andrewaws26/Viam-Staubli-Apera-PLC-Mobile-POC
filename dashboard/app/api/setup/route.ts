import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

async function getUserRole(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator"
    );
  } catch {
    return "operator";
  }
}

/** GET — fetch company settings + setup status */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("company_settings")
      .select("*")
      .maybeSingle();

    if (error) {
      // Table may not exist yet (migration not applied)
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        return NextResponse.json({ setup_completed: false, needs_migration: true });
      }
      throw error;
    }
    return NextResponse.json(data || { setup_completed: false });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[SETUP] GET error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

/** POST — create or update company settings */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(userId);
  if (role !== "developer" && role !== "manager") {
    return NextResponse.json(
      { error: "Only managers can configure company settings" },
      { status: 403 },
    );
  }

  try {
    const body = await req.json();
    const sb = getSupabase();

    const payload = {
      company_name: body.company_name || "",
      address_line1: body.address_line1 || "",
      address_line2: body.address_line2 || "",
      city: body.city || "",
      state: body.state || "",
      zip: body.zip || "",
      phone: body.phone || "",
      email: body.email || "",
      website: body.website || "",
      ein: body.ein || "",
      industry: body.industry || "",
      fiscal_year_start_month: body.fiscal_year_start_month || 1,
      accounting_method: body.accounting_method || "accrual",
      updated_at: new Date().toISOString(),
    };

    // Check if a row already exists (singleton)
    const { data: existing } = await sb
      .from("company_settings")
      .select("id")
      .maybeSingle();

    let data, error;
    if (existing) {
      ({ data, error } = await sb
        .from("company_settings")
        .update(payload)
        .eq("id", existing.id)
        .select()
        .single());
    } else {
      ({ data, error } = await sb
        .from("company_settings")
        .insert(payload)
        .select()
        .single());
    }

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[SETUP] POST error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

/** PATCH — mark setup as complete */
export async function PATCH() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(userId);
  if (role !== "developer" && role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const sb = getSupabase();
    const { data: existing } = await sb
      .from("company_settings")
      .select("id")
      .maybeSingle();

    if (!existing) {
      return NextResponse.json(
        { error: "Run setup first" },
        { status: 400 },
      );
    }

    const { data, error } = await sb
      .from("company_settings")
      .update({
        setup_completed: true,
        setup_completed_at: new Date().toISOString(),
        setup_completed_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[SETUP] PATCH error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
