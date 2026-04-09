import { NextRequest, NextResponse } from "next/server";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");
  const status = req.nextUrl.searchParams.get("status");
  const sessionType = req.nextUrl.searchParams.get("type");

  const sb = getSupabase();
  let query = sb
    .from("dev_sessions")
    .select("*")
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (sessionType) query = query.eq("session_type", sessionType);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    sessions: (data || []).map((s: Record<string, unknown>) => ({
      id: s.id,
      sessionType: s.session_type,
      status: s.status,
      title: s.title,
      description: s.description,
      promptTemplateId: s.prompt_template_id,
      inputContext: s.input_context,
      outputSummary: s.output_summary,
      tokensUsed: s.tokens_used,
      costCents: s.cost_cents,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      createdBy: s.created_by,
    })),
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { sessionType, title, description, promptTemplateId, inputContext } = body;

  const sb = getSupabase();
  const { data, error } = await sb
    .from("dev_sessions")
    .insert({
      session_type: sessionType || "manual",
      title: title || null,
      description: description || null,
      prompt_template_id: promptTemplateId || null,
      input_context: inputContext || null,
      created_by: userId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ session: data }, { status: 201 });
}
