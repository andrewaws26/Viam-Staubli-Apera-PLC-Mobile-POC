import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

/**
 * GET /api/profiles/[userId]
 * Returns a specific user's profile by their Clerk user ID.
 * All authenticated users can view any profile — needed for coworker
 * display in timesheets, PTO calendars, and team directories.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId: currentUserId } = await auth();
  if (!currentUserId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId: targetUserId } = await params;

  try {
    const sb = getSupabase();

    const { data, error } = await sb
      .from("profiles")
      .select("*")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", `/api/profiles/${targetUserId} GET`, err);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 502 },
    );
  }
}
