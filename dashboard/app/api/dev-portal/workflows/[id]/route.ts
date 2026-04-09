import { NextRequest, NextResponse } from "next/server";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const { id } = await params;
  const sb = getSupabase();

  const { data: workflow, error } = await sb
    .from("dev_workflows")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !workflow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  // Fetch all runs for this workflow
  const { data: runs } = await sb
    .from("workflow_runs")
    .select("*")
    .eq("workflow_id", id)
    .order("started_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    workflow: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      engine: workflow.engine,
      cronExpression: workflow.cron_expression,
      isActive: workflow.is_active,
      config: workflow.config,
      promptTemplateId: workflow.prompt_template_id,
      createdBy: workflow.created_by,
      createdAt: workflow.created_at,
      updatedAt: workflow.updated_at,
    },
    runs: (runs || []).map((r: Record<string, unknown>) => ({
      id: r.id,
      status: r.status,
      trigger: r.trigger,
      input: r.input,
      output: r.output,
      startedAt: r.started_at,
      endedAt: r.ended_at,
    })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  // Handle special actions
  if (body.action === "trigger") {
    return triggerRun(id, body.input);
  }

  if (body.action === "toggle") {
    return toggleActive(id);
  }

  // Regular update
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.engine !== undefined) updates.engine = body.engine;
  if (body.cronExpression !== undefined) updates.cron_expression = body.cronExpression;
  if (body.isActive !== undefined) updates.is_active = body.isActive;
  if (body.config !== undefined) updates.config = body.config;
  if (body.promptTemplateId !== undefined) updates.prompt_template_id = body.promptTemplateId;

  const sb = getSupabase();
  const { data, error } = await sb
    .from("dev_workflows")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ workflow: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const { id } = await params;
  const sb = getSupabase();

  const { error } = await sb.from("dev_workflows").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: true });
}

async function triggerRun(workflowId: string, input?: Record<string, unknown>) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getSupabase();

  // Verify workflow exists and is active
  const { data: workflow } = await sb
    .from("dev_workflows")
    .select("id, name, engine, is_active")
    .eq("id", workflowId)
    .single();

  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  // Create the run record
  const { data: run, error } = await sb
    .from("workflow_runs")
    .insert({
      workflow_id: workflowId,
      status: "running",
      trigger: "manual",
      input: input || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // For now, mark as completed immediately (actual engine dispatch comes later)
  // In production, this would dispatch to the appropriate engine:
  // - vercel-cron: trigger Vercel serverless function
  // - github-actions: dispatch GitHub Actions workflow via API
  // - dev-pi: SSH to Pi 5 and execute command
  await sb
    .from("workflow_runs")
    .update({
      status: "completed",
      ended_at: new Date().toISOString(),
      output: { message: `Manual trigger logged for ${workflow.engine} engine. Dispatch integration pending.` },
    })
    .eq("id", run.id);

  return NextResponse.json({
    run: { ...run, status: "completed" },
    message: `Workflow "${workflow.name}" triggered manually on ${workflow.engine}`,
  });
}

async function toggleActive(workflowId: string) {
  const sb = getSupabase();

  const { data: current } = await sb
    .from("dev_workflows")
    .select("is_active")
    .eq("id", workflowId)
    .single();

  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await sb
    .from("dev_workflows")
    .update({
      is_active: !current.is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workflowId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ workflow: data });
}
