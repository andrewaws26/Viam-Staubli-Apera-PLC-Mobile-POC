import { NextRequest, NextResponse } from "next/server";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";
import { getSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");
  const suite = req.nextUrl.searchParams.get("suite");

  const sb = getSupabase();
  let query = sb
    .from("dev_test_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (suite) {
    query = query.eq("suite", suite);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const testRuns = (data || []).map((t: Record<string, unknown>) => ({
    id: t.id,
    suite: t.suite,
    status: t.status,
    totalTests: t.total_tests,
    passed: t.passed,
    failed: t.failed,
    skipped: t.skipped,
    durationMs: t.duration_ms,
    trigger: t.trigger,
    commitSha: t.commit_sha,
    branch: t.branch,
    outputUrl: t.output_url,
    details: t.details,
    startedAt: t.started_at,
    endedAt: t.ended_at,
  }));

  return NextResponse.json({ testRuns });
}

export async function POST(req: NextRequest) {
  const denied = await requireRole("/api/dev-portal");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { suite, status, totalTests, passed, failed, skipped, durationMs, trigger, commitSha, branch, outputUrl, details } = body;

  if (!suite) {
    return NextResponse.json({ error: "suite is required" }, { status: 400 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("dev_test_runs")
    .insert({
      suite,
      status: status || "running",
      total_tests: totalTests ?? null,
      passed: passed ?? null,
      failed: failed ?? null,
      skipped: skipped ?? null,
      duration_ms: durationMs ?? null,
      trigger: trigger || "manual",
      commit_sha: commitSha || null,
      branch: branch || null,
      output_url: outputUrl || null,
      details: details || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ testRun: data }, { status: 201 });
}
