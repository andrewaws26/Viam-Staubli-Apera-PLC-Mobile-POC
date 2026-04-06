import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { canManageFleet } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

async function getUserRole(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (user.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  } catch {
    return "operator";
  }
}

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(userId);
  const isManager = canManageFleet(role);

  const truckId = request.nextUrl.searchParams.get("truck_id");
  const queryUserId = request.nextUrl.searchParams.get("user_id");

  try {
    const sb = getSupabase();
    let query = sb.from("truck_assignments").select("*");

    if (truckId) {
      query = query.eq("truck_id", truckId);
    }
    if (queryUserId) {
      // Non-managers can only see their own assignments
      if (!isManager && queryUserId !== userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      query = query.eq("user_id", queryUserId);
    }

    // If no filters and not a manager, restrict to own assignments
    if (!truckId && !queryUserId && !isManager) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query.order("assigned_at", { ascending: false });
    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/truck-assignments", err);
    return NextResponse.json(
      { error: "Failed to fetch assignments", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(userId);
  if (!canManageFleet(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { user_id?: string; user_name?: string; user_role?: string; truck_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { user_id, user_name, user_role, truck_id } = body;
  if (!user_id || !user_name || !truck_id) {
    return NextResponse.json({ error: "Missing user_id, user_name, or truck_id" }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("truck_assignments")
      .upsert(
        {
          user_id,
          user_name,
          user_role: user_role ?? "operator",
          truck_id,
          assigned_by: userId,
        },
        { onConflict: "user_id,truck_id" },
      )
      .select()
      .single();

    if (error) throw error;

    logAudit({
      action: "assignment_created",
      truckId: truck_id,
      details: { assigned_user: user_name, assigned_role: user_role ?? "operator", user_id },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/truck-assignments", err);
    return NextResponse.json(
      { error: "Failed to create assignment", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = await getUserRole(userId);
  if (!canManageFleet(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const assignmentId = request.nextUrl.searchParams.get("id");
  if (!assignmentId) {
    return NextResponse.json({ error: "Missing assignment id" }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    const { error } = await sb.from("truck_assignments").delete().eq("id", assignmentId);
    if (error) throw error;

    logAudit({ action: "assignment_deleted", details: { assignment_id: assignmentId } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[API-ERROR]", "/api/truck-assignments", err);
    return NextResponse.json(
      { error: "Failed to delete assignment", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
