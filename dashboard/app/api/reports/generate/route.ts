/**
 * POST /api/reports/generate
 *
 * Natural language -> Claude -> SQL -> sandboxed execution -> results.
 *
 * 4-layer security: auth, app-level SQL validation, DB function, audit log.
 * Auto-retry: if SQL execution fails, sends the error back to Claude for
 * a corrected query (one retry attempt).
 * All attempts (success + failure) logged to report_query_log for analysis.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { requireRole } from "@/lib/auth-guard";
import { logAudit } from "@/lib/audit";
import { ReportGenerateBody, parseBody } from "@/lib/api-schemas";
import { getSupabase } from "@/lib/supabase";
import { SCHEMA_CONTEXT, EXAMPLE_QUERIES } from "@/lib/report-schema-context";
import { validateSQL } from "@/lib/report-validate";

// ── Claude System Prompt ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are a SQL query generator for the IronSight company database (PostgreSQL on Supabase).

Given a natural language question, generate a single PostgreSQL SELECT query that answers it.

RULES:
- Return ONLY the SQL query. No explanation, no markdown fences, no comments, no trailing semicolons.
- Always include LIMIT 500 unless the user explicitly asks for all results.
- Use descriptive column aliases (e.g., "employee_name" not "name").
- Format dates with to_char(col, 'YYYY-MM-DD') for readable output.
- Handle NULLs with COALESCE where appropriate.
- Use LEFT JOIN when a relationship might not exist.
- Never generate INSERT, UPDATE, DELETE, or DDL statements.
- Use ONLY the exact column names from the schema below. Do NOT guess column names.
- The customers table uses "company_name" not "name".
- The vendors table uses "company_name" not "name".
- User IDs are TEXT (Clerk format: "user_xxx"), not UUIDs.
- fleet_trucks.id is TEXT (truck number), NOT UUID — no ::text cast needed.
- DTC codes are stored as (spn, fmi) integer pairs. There is NO "code" column.
- For monetary values, round to 2 decimal places with ROUND(col, 2).
- The table is "maintenance_events" NOT "maintenance_log".
- Work order status values: open/in_progress/blocked/done (NOT completed/cancelled).
- Work order priority values: low/normal/urgent (NOT medium/high).
- employee_profiles uses "user_name" NOT "first_name"/"last_name".

${SCHEMA_CONTEXT}

${EXAMPLE_QUERIES}`;

// ── Parse SQL from Claude response ────────────────────────────────

function extractSQL(text: string): string {
  const fenced = text.match(/```(?:sql)?\s*\n?([\s\S]*?)```/);
  let sql = fenced ? fenced[1].trim() : text.trim();
  sql = sql.replace(/;\s*$/, "");
  return sql;
}

// ── Get user info for logging ─────────────────────────────────────

async function getUser(userId: string): Promise<{ name: string; role: string }> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const name = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
    const role = (user.publicMetadata as Record<string, unknown>)?.role as string || "operator";
    return { name, role };
  } catch {
    return { name: "Unknown", role: "operator" };
  }
}

// ── Log query to report_query_log ─────────────────────────────────

function logQuery(entry: {
  userId: string;
  userName: string;
  prompt: string;
  sql: string | null;
  success: boolean;
  errorMessage: string | null;
  rowCount: number | null;
  executionMs: number | null;
  retryCount: number;
}): void {
  const sb = getSupabase();
  sb.from("report_query_log")
    .insert({
      user_id: entry.userId,
      user_name: entry.userName,
      prompt: entry.prompt,
      generated_sql: entry.sql,
      success: entry.success,
      error_message: entry.errorMessage,
      row_count: entry.rowCount,
      execution_time_ms: entry.executionMs,
      retry_count: entry.retryCount,
    })
    .then(({ error }) => {
      if (error) console.error("[REPORT-LOG-ERROR]", error.message);
    });
}

// ── Call Claude to generate SQL ───────────────────────────────────

async function generateSQL(
  apiKey: string,
  userPrompt: string,
  retryContext?: { failedSQL: string; errorMessage: string },
): Promise<{ sql: string | null; rawText: string; error?: string }> {
  const messages: { role: string; content: string }[] = [
    { role: "user", content: userPrompt },
  ];

  if (retryContext) {
    messages.push({
      role: "assistant",
      content: retryContext.failedSQL,
    });
    messages.push({
      role: "user",
      content: `That query failed with this error: "${retryContext.errorMessage}". Please fix the SQL. Return ONLY the corrected SQL query, nothing else.`,
    });
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return { sql: null, rawText: "", error: `Claude API ${response.status}: ${errText}` };
  }

  const data = await response.json();
  const rawText = data.content?.[0]?.type === "text" ? data.content[0].text : "";
  const sql = extractSQL(rawText);

  return { sql: sql || null, rawText };
}

// ── Route Handler ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const denied = await requireRole("/api/reports/generate");
  if (denied) return denied;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseBody(ReportGenerateBody, rawBody);
  if (parsed.error) {
    return NextResponse.json(parsed.error, { status: 400 });
  }

  const { prompt } = parsed.data;
  const userInfo = await getUser(userId);

  try {
    // ── Attempt 1: Generate and execute SQL ───────────────────────
    const gen1 = await generateSQL(apiKey, prompt);

    if (gen1.error) {
      console.error("[REPORT-ERROR]", "Claude API", gen1.error);
      logQuery({
        userId, userName: userInfo.name, prompt,
        sql: null, success: false, errorMessage: gen1.error,
        rowCount: null, executionMs: null, retryCount: 0,
      });
      return NextResponse.json(
        { error: "AI service error", details: gen1.error },
        { status: 502 },
      );
    }

    if (!gen1.sql) {
      logQuery({
        userId, userName: userInfo.name, prompt,
        sql: null, success: false, errorMessage: "AI did not generate a valid query",
        rowCount: null, executionMs: null, retryCount: 0,
      });
      return NextResponse.json(
        { error: "AI did not generate a valid query", raw: gen1.rawText },
        { status: 422 },
      );
    }

    const validation1 = validateSQL(gen1.sql);
    if (!validation1.valid) {
      logQuery({
        userId, userName: userInfo.name, prompt,
        sql: gen1.sql, success: false, errorMessage: `Safety check: ${validation1.reason}`,
        rowCount: null, executionMs: null, retryCount: 0,
      });
      return NextResponse.json(
        { error: "Generated query failed safety check", reason: validation1.reason, sql: gen1.sql },
        { status: 422 },
      );
    }

    // Execute attempt 1
    const sb = getSupabase();
    const start1 = Date.now();
    const result1 = await sb.rpc("exec_readonly_query", { query_text: gen1.sql });
    const ms1 = Date.now() - start1;

    if (!result1.error) {
      // Success on first try
      const results = (result1.data as Record<string, unknown>[]) || [];
      logQuery({
        userId, userName: userInfo.name, prompt,
        sql: gen1.sql, success: true, errorMessage: null,
        rowCount: results.length, executionMs: ms1, retryCount: 0,
      });
      logAudit({
        action: "report_generated",
        details: { prompt, sql: gen1.sql, row_count: results.length, execution_time_ms: ms1, retry: false },
      });
      return NextResponse.json({
        sql: gen1.sql,
        results,
        row_count: results.length,
        execution_time_ms: ms1,
      });
    }

    // ── Attempt 2: Auto-retry with error feedback ─────────────────
    console.log("[REPORT-RETRY]", "First query failed:", result1.error.message, "— retrying with error context");

    const gen2 = await generateSQL(apiKey, prompt, {
      failedSQL: gen1.sql,
      errorMessage: result1.error.message,
    });

    if (gen2.error || !gen2.sql) {
      logQuery({
        userId, userName: userInfo.name, prompt,
        sql: gen1.sql, success: false, errorMessage: result1.error.message,
        rowCount: null, executionMs: ms1, retryCount: 1,
      });
      return NextResponse.json(
        { error: "Query execution failed", details: result1.error.message, sql: gen1.sql },
        { status: 422 },
      );
    }

    const validation2 = validateSQL(gen2.sql);
    if (!validation2.valid) {
      logQuery({
        userId, userName: userInfo.name, prompt,
        sql: gen2.sql, success: false, errorMessage: `Retry safety check: ${validation2.reason}`,
        rowCount: null, executionMs: null, retryCount: 1,
      });
      return NextResponse.json(
        { error: "Retry query failed safety check", reason: validation2.reason, sql: gen2.sql },
        { status: 422 },
      );
    }

    // Execute attempt 2
    const start2 = Date.now();
    const result2 = await sb.rpc("exec_readonly_query", { query_text: gen2.sql });
    const ms2 = Date.now() - start2;

    if (result2.error) {
      // Both attempts failed
      console.error("[REPORT-ERROR]", "Both attempts failed:", result2.error.message);
      logQuery({
        userId, userName: userInfo.name, prompt,
        sql: gen2.sql, success: false, errorMessage: result2.error.message,
        rowCount: null, executionMs: ms2, retryCount: 1,
      });
      return NextResponse.json(
        { error: "Query execution failed after retry", details: result2.error.message, sql: gen2.sql, original_sql: gen1.sql },
        { status: 422 },
      );
    }

    // Success on retry
    const results2 = (result2.data as Record<string, unknown>[]) || [];
    logQuery({
      userId, userName: userInfo.name, prompt,
      sql: gen2.sql, success: true, errorMessage: null,
      rowCount: results2.length, executionMs: ms2, retryCount: 1,
    });
    logAudit({
      action: "report_generated",
      details: {
        prompt,
        sql: gen2.sql,
        original_sql: gen1.sql,
        original_error: result1.error.message,
        row_count: results2.length,
        execution_time_ms: ms2,
        retry: true,
      },
    });

    return NextResponse.json({
      sql: gen2.sql,
      results: results2,
      row_count: results2.length,
      execution_time_ms: ms2,
      retried: true,
    });
  } catch (err) {
    console.error("[REPORT-ERROR]", "generate", err);
    logQuery({
      userId, userName: userInfo.name, prompt,
      sql: null, success: false, errorMessage: err instanceof Error ? err.message : String(err),
      rowCount: null, executionMs: null, retryCount: 0,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
