import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const { id } = await params;
  const sb = getSupabase();

  const { data, error } = await sb
    .from("dev_sessions")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  return NextResponse.json({
    session: {
      id: data.id,
      sessionType: data.session_type,
      status: data.status,
      title: data.title,
      description: data.description,
      promptTemplateId: data.prompt_template_id,
      inputContext: data.input_context,
      outputSummary: data.output_summary,
      tokensUsed: data.tokens_used,
      costCents: data.cost_cents,
      startedAt: data.started_at,
      endedAt: data.ended_at,
      createdBy: data.created_by,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const { status, title, outputSummary, tokensUsed, costCents } = body;

  const update: Record<string, unknown> = {};
  if (status !== undefined) update.status = status;
  if (title !== undefined) update.title = title;
  if (outputSummary !== undefined) update.output_summary = outputSummary;
  if (tokensUsed !== undefined) update.tokens_used = tokensUsed;
  if (costCents !== undefined) update.cost_cents = costCents;

  // Auto-set ended_at when status transitions to a terminal state
  if (status === "completed" || status === "failed" || status === "cancelled") {
    update.ended_at = new Date().toISOString();
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("dev_sessions")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ session: data });
}
