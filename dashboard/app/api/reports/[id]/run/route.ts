/**
 * POST /api/reports/[id]/run
 *
 * Re-execute a saved report's SQL. Updates run count and last_run_at.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";
import { logAudit } from "@/lib/audit";
import { getSupabase } from "@/lib/supabase";
import { validateSQL } from "@/lib/report-validate";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole("/api/reports");
  if (denied) return denied;

  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const sb = getSupabase();

  // Fetch the saved report
  const { data: report, error: fetchErr } = await sb
    .from("saved_reports")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Check access: own report or shared
  if (report.created_by !== userId && !report.is_shared) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Re-validate SQL (safety check even for saved queries)
  const validation = validateSQL(report.generated_sql);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Saved query failed safety check", reason: validation.reason },
      { status: 422 },
    );
  }

  // Execute
  const startMs = Date.now();
  const { data, error } = await sb.rpc("exec_readonly_query", {
    query_text: report.generated_sql,
  });
  const executionMs = Date.now() - startMs;

  if (error) {
    console.error("[REPORT-ERROR]", "run", error.message);
    return NextResponse.json(
      { error: "Query execution failed", details: error.message },
      { status: 422 },
    );
  }

  const results = (data as Record<string, unknown>[]) || [];

  // Update run stats
  await sb
    .from("saved_reports")
    .update({
      last_run_at: new Date().toISOString(),
      run_count: (report.run_count || 0) + 1,
    })
    .eq("id", id);

  await logAudit({
    action: "report_run",
    details: { report_id: id, report_name: report.name, row_count: results.length },
  });

  return NextResponse.json({
    sql: report.generated_sql,
    results,
    row_count: results.length,
    execution_time_ms: executionMs,
  });
}
