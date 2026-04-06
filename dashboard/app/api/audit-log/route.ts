import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only developer/manager can view audit log
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const role = (user.publicMetadata as Record<string, unknown>)?.role as string || "operator";
    if (role !== "developer" && role !== "manager") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  const truckId = request.nextUrl.searchParams.get("truck_id");
  const action = request.nextUrl.searchParams.get("action");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 50, 200);

  try {
    const sb = getSupabase();
    let query = sb.from("audit_log").select("*");
    if (truckId) query = query.eq("truck_id", truckId);
    if (action) query = query.eq("action", action);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/audit-log", err);
    return NextResponse.json(
      { error: "Failed to fetch audit log", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
