import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireRole } from "@/lib/auth-guard";

interface PushBody {
  truck_id?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  severity?: "critical" | "warning" | "info";
}

export async function POST(request: NextRequest) {
  const denied = await requireRole("/api/push/send");
  if (denied) return denied;

  let payload: PushBody;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { truck_id, title, body: msgBody, data, severity } = payload;
  if (!truck_id || !title || !msgBody) {
    return NextResponse.json({ error: "Missing truck_id, title, or body" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // Get users assigned to this truck
    const { data: assignments, error: assignErr } = await sb
      .from("truck_assignments")
      .select("user_id")
      .eq("truck_id", truck_id);

    if (assignErr) throw assignErr;

    const assignedUserIds = (assignments ?? []).map((a) => a.user_id);

    // Fetch push tokens: assigned users + all managers/developers get notifications
    // We query all tokens and let the caller decide scope; for now grab tokens
    // for assigned users. Managers/developers are included if they have tokens registered.
    let tokenQuery = sb.from("push_tokens").select("expo_token, user_id");

    if (assignedUserIds.length > 0) {
      tokenQuery = tokenQuery.in("user_id", assignedUserIds);
    } else {
      // No assignments — no tokens to send to
      return NextResponse.json({ sent: 0, tickets: [] });
    }

    const { data: tokens, error: tokenErr } = await tokenQuery;
    if (tokenErr) throw tokenErr;

    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ sent: 0, tickets: [] });
    }

    // Build Expo push messages
    const messages = tokens.map((t) => ({
      to: t.expo_token,
      title,
      body: msgBody,
      data: { ...data, truck_id, severity: severity ?? "info" },
      sound: severity === "critical" ? "default" : undefined,
      priority: severity === "critical" ? "high" as const : "default" as const,
    }));

    // Send via Expo Push API
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[API-ERROR]", "/api/push/send Expo API", response.status, text);
      return NextResponse.json(
        { error: "Expo Push API error", status: response.status, detail: text },
        { status: 502 },
      );
    }

    const result = await response.json();
    console.log("[PUSH-SEND]", { truck_id, severity, token_count: tokens.length, tickets: result.data?.length ?? 0 });

    return NextResponse.json({ sent: tokens.length, tickets: result.data ?? [] });
  } catch (err) {
    console.error("[API-ERROR]", "/api/push/send", err);
    return NextResponse.json(
      { error: "Failed to send push notification", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
