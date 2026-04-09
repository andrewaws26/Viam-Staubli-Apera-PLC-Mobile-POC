import { NextRequest, NextResponse } from "next/server";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const engine = req.nextUrl.searchParams.get("engine");
  const activeOnly = req.nextUrl.searchParams.get("active");
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");

  const sb = getSupabase();
  let query = sb
    .from("dev_workflows")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (engine) query = query.eq("engine", engine);
  if (activeOnly === "true") query = query.eq("is_active", true);
  if (activeOnly === "false") query = query.eq("is_active", false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also fetch recent runs for each workflow
  const workflowIds = (data || []).map((w: Record<string, unknown>) => w.id);
  let runs: Record<string, unknown>[] = [];
  if (workflowIds.length > 0) {
    const { data: runData } = await sb
      .from("workflow_runs")
      .select("*")
      .in("workflow_id", workflowIds)
      .order("started_at", { ascending: false })
      .limit(200);
    runs = runData || [];
  }

  // Group runs by workflow
  const runsByWorkflow: Record<string, Record<string, unknown>[]> = {};
  for (const r of runs) {
    const wid = r.workflow_id as string;
    if (!runsByWorkflow[wid]) runsByWorkflow[wid] = [];
    runsByWorkflow[wid].push(r);
  }

  const workflows = (data || []).map((w: Record<string, unknown>) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    engine: w.engine,
    cronExpression: w.cron_expression,
    isActive: w.is_active,
    config: w.config,
    promptTemplateId: w.prompt_template_id,
    createdBy: w.created_by,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    recentRuns: (runsByWorkflow[w.id as string] || []).slice(0, 10).map((r) => ({
      id: r.id,
      status: r.status,
      trigger: r.trigger,
      input: r.input,
      output: r.output,
      startedAt: r.started_at,
      endedAt: r.ended_at,
    })),
    lastRun: runsByWorkflow[w.id as string]?.[0]
      ? {
          status: runsByWorkflow[w.id as string][0].status,
          startedAt: runsByWorkflow[w.id as string][0].started_at,
        }
      : null,
  }));

  return NextResponse.json({ workflows });
}

export async function POST(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, description, engine, cronExpression, config, promptTemplateId, isActive } = body;

  if (!name || !engine) {
    return NextResponse.json({ error: "name and engine are required" }, { status: 400 });
  }

  const validEngines = ["vercel-cron", "github-actions", "dev-pi"];
  if (!validEngines.includes(engine)) {
    return NextResponse.json({ error: `engine must be one of: ${validEngines.join(", ")}` }, { status: 400 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("dev_workflows")
    .insert({
      name,
      description: description || null,
      engine,
      cron_expression: cronExpression || null,
      is_active: isActive ?? false,
      config: config || {},
      prompt_template_id: promptTemplateId || null,
      created_by: userId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ workflow: data }, { status: 201 });
}
