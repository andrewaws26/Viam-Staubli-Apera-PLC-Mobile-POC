import { NextRequest, NextResponse } from "next/server";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");

  const sb = getSupabase();
  const { data, error } = await sb
    .from("deployment_history")
    .select("*")
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const deployments = (data || []).map((d: Record<string, unknown>) => ({
    id: d.id,
    target: d.target,
    status: d.status,
    commitSha: d.commit_sha,
    branch: d.branch,
    deployUrl: d.deploy_url,
    trigger: d.trigger,
    details: d.details,
    startedAt: d.started_at,
    endedAt: d.ended_at,
    createdBy: d.created_by,
  }));

  return NextResponse.json({ deployments });
}

export async function POST(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { target, status, commitSha, branch, deployUrl, trigger, details } = body;

  if (!target) {
    return NextResponse.json({ error: "target is required" }, { status: 400 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("deployment_history")
    .insert({
      target,
      status: status || "deploying",
      commit_sha: commitSha || null,
      branch: branch || null,
      deploy_url: deployUrl || null,
      trigger: trigger || "manual",
      details: details || null,
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deployment: data }, { status: 201 });
}
