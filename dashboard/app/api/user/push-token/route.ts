import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";

export async function POST(request: NextRequest) {
  const denied = await requireRole("/api/user/push-token");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { expo_token?: string; device_name?: string; platform?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { expo_token, device_name, platform } = body;
  if (!expo_token?.trim()) {
    return NextResponse.json({ error: "Missing expo_token" }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("push_tokens")
      .upsert(
        {
          user_id: userId,
          expo_token: expo_token.trim(),
          device_name: device_name ?? null,
          platform: platform ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,expo_token" }
      )
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/user/push-token POST", err);
    return NextResponse.json(
      { error: "Failed to register push token", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await requireRole("/api/user/push-token");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { expo_token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { expo_token } = body;
  if (!expo_token?.trim()) {
    return NextResponse.json({ error: "Missing expo_token" }, { status: 400 });
  }

  try {
    const sb = getSupabase();
    const { error } = await sb
      .from("push_tokens")
      .delete()
      .eq("user_id", userId)
      .eq("expo_token", expo_token.trim());

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[API-ERROR]", "/api/user/push-token DELETE", err);
    return NextResponse.json(
      { error: "Failed to remove push token", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
