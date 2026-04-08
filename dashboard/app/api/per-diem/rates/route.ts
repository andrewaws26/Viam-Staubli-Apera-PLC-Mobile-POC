import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";

/**
 * Fetches display name and role from Clerk for the given user ID.
 * Falls back to safe defaults if Clerk is unreachable.
 */
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
 * GET /api/per-diem/rates
 * Returns all per diem rate definitions (both active and inactive).
 * Available to all authenticated users — needed for display purposes.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sb = getSupabase();

    const { data, error } = await sb
      .from("per_diem_rates")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/per-diem/rates GET", err);
    return NextResponse.json(
      { error: "Failed to fetch per diem rates" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/per-diem/rates
 * Manager/developer only — creates a new per diem rate.
 *
 * Required body fields:
 *   - name       (string, e.g. "Night Out", "Layover")
 *   - daily_rate (number, in dollars)
 *
 * Optional: description (string), is_active (boolean, default true)
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";

  if (!isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, daily_rate, description, is_active } = body as Record<string, unknown>;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Missing or invalid name" }, { status: 400 });
  }

  if (daily_rate === undefined || daily_rate === null || Number(daily_rate) < 0) {
    return NextResponse.json({ error: "daily_rate must be a non-negative number" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // Check for duplicate rate name
    const { data: existing } = await sb
      .from("per_diem_rates")
      .select("id")
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "A rate with this name already exists", existing_id: existing.id },
        { status: 409 },
      );
    }

    const { data, error } = await sb
      .from("per_diem_rates")
      .insert({
        name,
        daily_rate: Number(daily_rate),
        description: description || null,
        is_active: is_active !== false, // default true
      })
      .select()
      .single();

    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "per_diem_rate_updated",
      details: {
        rate_id: data.id,
        action: "created",
        name: name as string,
        daily_rate: Number(daily_rate),
      },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/per-diem/rates POST", err);
    return NextResponse.json(
      { error: "Failed to create per diem rate" },
      { status: 502 },
    );
  }
}

/**
 * PATCH /api/per-diem/rates
 * Manager/developer only — updates an existing per diem rate.
 * Requires ?rate_id= query param.
 *
 * Body fields (all optional): name, daily_rate, description, is_active
 */
export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";

  if (!isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateId = request.nextUrl.searchParams.get("rate_id");
  if (!rateId) {
    return NextResponse.json({ error: "Missing rate_id query param" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const editableFields = ["name", "daily_rate", "description", "is_active"];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const changedFields: string[] = [];

  for (const field of editableFields) {
    if (field in body) {
      if (field === "daily_rate") {
        const val = Number(body[field]);
        if (isNaN(val) || val < 0) {
          return NextResponse.json(
            { error: "daily_rate must be a non-negative number" },
            { status: 400 },
          );
        }
        update[field] = val;
      } else {
        update[field] = body[field];
      }
      changedFields.push(field);
    }
  }

  if (changedFields.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // Verify the rate exists
    const { data: existing } = await sb
      .from("per_diem_rates")
      .select("id, name")
      .eq("id", rateId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Rate not found" }, { status: 404 });
    }

    const { data, error } = await sb
      .from("per_diem_rates")
      .update(update)
      .eq("id", rateId)
      .select()
      .single();

    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "per_diem_rate_updated",
      details: {
        rate_id: rateId,
        action: "updated",
        previous_name: existing.name,
        changed_fields: changedFields,
      },
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", "/api/per-diem/rates PATCH", err);
    return NextResponse.json(
      { error: "Failed to update per diem rate" },
      { status: 502 },
    );
  }
}
