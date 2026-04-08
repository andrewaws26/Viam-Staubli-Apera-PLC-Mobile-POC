/**
 * POST /api/reports/generate
 *
 * Natural language -> Claude -> SQL -> sandboxed execution -> results.
 * 4-layer security: auth, app-level SQL validation, DB function, audit log.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole, getAuthUserId } from "@/lib/auth-guard";
import { logAudit } from "@/lib/audit";
import { ReportGenerateBody, parseBody } from "@/lib/api-schemas";
import { getSupabase } from "@/lib/supabase";
import { SCHEMA_CONTEXT, EXAMPLE_QUERIES } from "@/lib/report-schema-context";
import { validateSQL } from "@/lib/report-validate";

// ── Claude System Prompt ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are a SQL query generator for the IronSight company database (PostgreSQL on Supabase).

Given a natural language question, generate a single PostgreSQL SELECT query that answers it.

RULES:
- Return ONLY the SQL query. No explanation, no markdown fences, no comments.
- Always include LIMIT 500 unless the user explicitly asks for all results.
- Use descriptive column aliases (e.g., "employee_name" not "name").
- Format dates with to_char(col, 'YYYY-MM-DD') for readable output.
- Handle NULLs with COALESCE where appropriate.
- Use LEFT JOIN when a relationship might not exist.
- Never generate INSERT, UPDATE, DELETE, or DDL statements.
- The customers table uses "company_name" not "name".
- The vendors table uses "company_name" not "name".
- User IDs are TEXT (Clerk format: "user_xxx"), not UUIDs.
- truck_id fields are TEXT; fleet_trucks.id is UUID — cast with ::text when joining.
- For monetary values, round to 2 decimal places with ROUND(col, 2).

${SCHEMA_CONTEXT}

${EXAMPLE_QUERIES}`;

// ── Parse SQL from Claude response ────────────────────────────────

function extractSQL(text: string): string {
  // Try to extract from code fences first
  const fenced = text.match(/```(?:sql)?\s*\n?([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // Otherwise use the whole response (Claude was told to return only SQL)
  return text.trim();
}

// ── Route Handler ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const denied = await requireRole("/api/reports/generate");
  if (denied) return denied;

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

  try {
    // Step 1: Send to Claude with cached schema context
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
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
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error("[REPORT-ERROR]", "Claude API", claudeResponse.status, errText);
      return NextResponse.json(
        { error: "AI service error", details: errText },
        { status: 502 },
      );
    }

    const claudeData = await claudeResponse.json();
    const rawText =
      claudeData.content?.[0]?.type === "text"
        ? claudeData.content[0].text
        : "";

    // Step 2: Extract and validate SQL
    const sql = extractSQL(rawText);
    if (!sql) {
      return NextResponse.json(
        { error: "AI did not generate a valid query", raw: rawText },
        { status: 422 },
      );
    }

    const validation = validateSQL(sql);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Generated query failed safety check", reason: validation.reason, sql },
        { status: 422 },
      );
    }

    // Step 3: Execute via sandboxed RPC
    const sb = getSupabase();
    const startMs = Date.now();
    const { data, error } = await sb.rpc("exec_readonly_query", {
      query_text: sql,
    });
    const executionMs = Date.now() - startMs;

    if (error) {
      console.error("[REPORT-ERROR]", "exec_readonly_query", error.message);
      return NextResponse.json(
        { error: "Query execution failed", details: error.message, sql },
        { status: 422 },
      );
    }

    const results = (data as Record<string, unknown>[]) || [];

    // Step 4: Audit log
    logAudit({
      action: "report_generated",
      details: { prompt, sql, row_count: results.length, execution_time_ms: executionMs },
    });

    return NextResponse.json({
      sql,
      results,
      row_count: results.length,
      execution_time_ms: executionMs,
    });
  } catch (err) {
    console.error("[REPORT-ERROR]", "generate", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
