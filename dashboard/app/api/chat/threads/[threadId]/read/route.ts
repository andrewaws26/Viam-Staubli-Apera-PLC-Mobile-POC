import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";

type RouteContext = { params: Promise<{ threadId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await context.params;
  const sb = getSupabase();

  try {
    const { error } = await sb
      .from("chat_thread_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("thread_id", threadId)
      .eq("user_id", userId);

    if (error) throw error;

    console.log("[TEAM-CHAT-LOG]", "Mark read", { threadId, userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[TEAM-CHAT-LOG]", "Mark read error:", err);
    return NextResponse.json(
      { error: "Failed to mark as read", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
