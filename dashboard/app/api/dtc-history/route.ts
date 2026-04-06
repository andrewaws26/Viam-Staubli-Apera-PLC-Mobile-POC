import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const truckId = request.nextUrl.searchParams.get("truck_id");
  if (!truckId) return NextResponse.json({ error: "Missing truck_id" }, { status: 400 });

  const activeOnly = request.nextUrl.searchParams.get("active") === "true";
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 50, 200);

  try {
    const sb = getSupabase();
    let query = sb.from("dtc_history").select("*").eq("truck_id", truckId);
    if (activeOnly) query = query.eq("active", true);
    const { data, error } = await query.order("first_seen_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/dtc-history", err);
    return NextResponse.json(
      { error: "Failed to fetch DTC history", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
