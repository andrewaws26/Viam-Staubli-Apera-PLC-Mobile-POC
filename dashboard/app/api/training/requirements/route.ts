import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

/**
 * GET /api/training/requirements
 * Returns all active training requirements, ordered by name.
 * Available to all authenticated users — needed for display and
 * training record creation forms.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sb = getSupabase();

    const { data, error } = await sb
      .from("training_requirements")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/training/requirements GET", err);
    return NextResponse.json(
      { error: "Failed to fetch training requirements" },
      { status: 502 },
    );
  }
}
