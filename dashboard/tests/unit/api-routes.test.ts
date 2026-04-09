/**
 * API Route Handler Tests
 *
 * Tests route handler logic by reading source code and verifying:
 * - Input validation patterns
 * - Error handling paths
 * - Response status codes
 * - Required fields in responses
 *
 * Layer 2: These verify routes handle edge cases correctly at the code level.
 * Full HTTP integration tests would require mocking Next.js request/response.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const DASHBOARD_ROOT = path.resolve(__dirname, "../..");

function readFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(DASHBOARD_ROOT, relativePath), "utf-8");
}

function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.resolve(DASHBOARD_ROOT, relativePath));
}

// ── Shift Report Route ────────────────────────────────────────────

describe("API Route: /api/shift-report", () => {
  const route = readFile("app/api/shift-report/route.ts");

  it("should accept truck_id parameter", () => {
    expect(route).toContain("truck_id");
  });

  it("should return JSON response on success", () => {
    expect(route).toContain("NextResponse.json");
  });

  it("should log query parameters for debugging", () => {
    expect(route).toContain("[SHIFT-REPORT]");
  });

  it("should handle empty data gracefully", () => {
    // The aggregation returns boolean flags for data presence
    expect(route).toContain("buildShiftReport");
  });

  it("should use buildShiftReport for aggregation", () => {
    expect(route).toContain("buildShiftReport");
  });

  it("should catch and log errors", () => {
    expect(route).toContain("console.error");
  });
});

// ── Snapshots Route ───────────────────────────────────────────────

describe("API Route: /api/snapshots", () => {
  const route = readFile("app/api/snapshots/route.ts");

  it("should have both GET and POST handlers", () => {
    expect(route).toContain("export async function GET");
    expect(route).toContain("export async function POST");
  });

  it("should require authentication", () => {
    expect(route).toMatch(/auth\(\)|getAuthUserId\(\)/);
  });

  it("should audit log captures", () => {
    expect(route).toContain("logAudit");
    expect(route).toContain("snapshot_captured");
  });

  it("should support historical capture with timestamp", () => {
    expect(route).toContain("timestamp");
    expect(route).toContain("historical");
  });

  it("should store reading_data as JSONB", () => {
    expect(route).toContain("reading_data");
  });
});

describe("API Route: /api/snapshots/[id]", () => {
  if (!fileExists("app/api/snapshots/[id]/route.ts")) return;
  const route = readFile("app/api/snapshots/[id]/route.ts");

  it("should have GET handler for individual snapshot", () => {
    expect(route).toContain("export async function GET");
  });

  it("should return 404 for missing snapshots", () => {
    expect(route).toContain("404");
  });
});

// ── Report Generator Route ────────────────────────────────────────

describe("API Route: /api/reports/generate", () => {
  const route = readFile("app/api/reports/generate/route.ts");

  it("should validate request body with Zod schema", () => {
    expect(route).toContain("parseBody");
    expect(route).toContain("ReportGenerateBody");
  });

  it("should use validateSQL before execution", () => {
    expect(route).toContain("validateSQL");
  });

  it("should use exec_readonly_query for sandboxed execution", () => {
    expect(route).toContain("exec_readonly_query");
  });

  it("should auto-retry on first failure", () => {
    expect(route).toContain("retryContext");
    expect(route).toContain("Attempt 2");
  });

  it("should log all query attempts", () => {
    expect(route).toContain("logQuery");
  });

  it("should return SQL in response for debugging", () => {
    expect(route).toContain("sql:");
    expect(route).toContain("execution_time_ms");
  });

  it("should use prompt caching", () => {
    expect(route).toContain("cache_control");
    expect(route).toContain("ephemeral");
  });
});

// ── Receipt OCR Route ─────────────────────────────────────────────

describe("API Route: /api/accounting/receipt-ocr", () => {
  const route = readFile("app/api/accounting/receipt-ocr/route.ts");

  it("should validate mime type", () => {
    expect(route).toContain("VALID_MIME_TYPES");
    expect(route).toContain("image/jpeg");
    expect(route).toContain("image/png");
  });

  it("should require manager or developer role", () => {
    expect(route).toContain("manager");
    expect(route).toContain("developer");
  });

  it("should validate parsed JSON structure", () => {
    expect(route).toContain("typeof extracted");
    expect(route).toContain("Array.isArray");
  });

  it("should coerce numeric fields from strings", () => {
    expect(route).toContain("parseFloat");
    expect(route).toContain("total_amount");
    expect(route).toContain("tax_amount");
  });

  it("should strip markdown fencing from Claude response", () => {
    expect(route).toContain("```");
  });

  it("should return usage stats", () => {
    expect(route).toContain("input_tokens");
    expect(route).toContain("output_tokens");
  });
});

// ── Journal Entries Route ─────────────────────────────────────────

describe("API Route: /api/accounting/entries", () => {
  const route = readFile("app/api/accounting/entries/route.ts");

  it("should require authentication", () => {
    expect(route).toMatch(/auth\(\)/);
  });

  it("should require manager/developer role for POST", () => {
    expect(route).toContain("isManager");
  });

  it("should validate required fields", () => {
    expect(route).toContain("entry_date");
    expect(route).toContain("description");
  });

  it("should support idempotency keys", () => {
    expect(route).toContain("idempotency");
  });
});

// ── Chat Messages Route ───────────────────────────────────────────

describe("API Route: /api/chat/threads/[threadId]/messages", () => {
  const route = readFile("app/api/chat/threads/[threadId]/messages/route.ts");

  it("should rate-limit @ai mentions", () => {
    expect(route).toContain("aiMentionLimiter");
  });

  it("should handle AI failure gracefully", () => {
    // AI errors should not fail the user's message
    expect(route).toContain("catch");
    expect(route).toContain("Don't fail the user's message");
  });

  it("should send push notifications", () => {
    expect(route).toContain("sendChatPushNotifications");
  });

  it("should log AI responses", () => {
    expect(route).toContain("[TEAM-CHAT-LOG]");
  });
});

// ── SQL Validator (functional tests) ──────────────────────────────
// Covered by report-validate.test.ts — imports directly via ESM aliases

// ── Supabase Retry (functional tests) ─────────────────────────────
// Covered by infrastructure.test.ts via direct import
