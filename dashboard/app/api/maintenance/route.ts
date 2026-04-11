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
    const role = (user.publicMetadata as Record<string, unknown>)?.role as string || "operator";
    return { name, role };
  } catch {
    return { name: "Unknown", role: "operator" };
  }
}

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const truckId = request.nextUrl.searchParams.get("truck_id");

  try {
    const sb = getSupabase();
    let query = sb.from("maintenance_events").select("*");
    if (truckId) query = query.eq("truck_id", truckId);
    const { data, error } = await query.order("performed_at", { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/maintenance", err);
    return NextResponse.json(
      { error: "Failed to fetch maintenance", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { truck_id, event_type, description, mileage, engine_hours, performed_by, performed_at, next_due_mileage, next_due_date } = body as Record<string, string | number | null>;

  if (!truck_id || !event_type || !performed_by) {
    return NextResponse.json({ error: "Missing truck_id, event_type, or performed_by" }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("maintenance_events")
      .insert({
        truck_id,
        event_type,
        description: description || null,
        mileage: mileage ? Number(mileage) : null,
        engine_hours: engine_hours ? Number(engine_hours) : null,
        performed_by,
        performed_at: performed_at || new Date().toISOString(),
        next_due_mileage: next_due_mileage ? Number(next_due_mileage) : null,
        next_due_date: next_due_date || null,
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw error;

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "maintenance_logged",
      truckId: truck_id as string,
      details: { event_type, performed_by, mileage, description: (description as string)?.substring(0, 100) },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/maintenance", err);
    return NextResponse.json(
      { error: "Failed to log maintenance", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only developer/manager can delete
  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const sb = getSupabase();
    const { error } = await sb.from("maintenance_events").delete().eq("id", id);
    if (error) throw error;

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "maintenance_deleted",
      details: { event_id: id },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[API-ERROR]", "/api/maintenance", err);
    return NextResponse.json(
      { error: "Failed to delete", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
