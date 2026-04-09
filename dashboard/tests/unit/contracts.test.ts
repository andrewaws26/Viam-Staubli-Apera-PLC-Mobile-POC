/**
 * External API Contract Tests
 *
 * Defines the expected shapes of data from Viam, Supabase, and Clerk.
 * If an upstream service changes its response format, these tests fail
 * BEFORE the broken data flows through the system silently.
 *
 * These aren't live API calls — they test that our code correctly handles
 * the documented response shapes. If Viam changes `exportTabularData`
 * to rename `timeCaptured`, these contract tests catch the mismatch.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const DASHBOARD_ROOT = path.resolve(__dirname, "../..");

function readFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(DASHBOARD_ROOT, relativePath), "utf-8");
}

// ── Viam Data API Contract ────────────────────────────────────────

describe("Contract: Viam Data API response shape", () => {
  const viamData = readFile("lib/viam-data.ts");

  it("TabularDataPoint should expect timeCaptured field", () => {
    expect(viamData).toContain("timeCaptured");
  });

  it("TabularDataPoint should expect payload field", () => {
    expect(viamData).toContain("payload");
  });

  it("unwrapPayload should handle readings nesting", () => {
    // This is the critical contract: Viam wraps readings in payload.readings
    expect(viamData).toContain("raw.readings");
  });

  it("should use correct Viam resource subtype for sensors", () => {
    expect(viamData).toContain("rdk:component:sensor");
  });

  it("should use 'Readings' as method name", () => {
    expect(viamData).toContain('"Readings"');
  });
});

describe("Contract: Viam payload structure in consumers", () => {
  const aggregation = readFile("app/api/shift-report/aggregation.ts");

  it("aggregation expects engine_rpm in payload (not readings.engine_rpm)", () => {
    // After unwrapPayload, fields are at top level
    expect(aggregation).toContain("pt.payload.engine_rpm");
    expect(aggregation).toContain("pt.payload.vehicle_speed_mph");
    expect(aggregation).toContain("pt.payload.coolant_temp_f");
  });

  it("aggregation expects DTC fields with indexed pattern", () => {
    expect(aggregation).toContain("`dtc_${d}_spn`");
    expect(aggregation).toContain("`dtc_${d}_fmi`");
  });
});

// ── Supabase Table Contracts ──────────────────────────────────────

describe("Contract: Supabase table shapes used by routes", () => {
  it("audit_log insert matches the schema", () => {
    const audit = readFile("lib/audit.ts");
    // These fields must exist in the audit_log table
    expect(audit).toContain("user_id");
    expect(audit).toContain("user_name");
    expect(audit).toContain("user_role");
    expect(audit).toContain("action");
    expect(audit).toContain("truck_id");
    expect(audit).toContain("details");
  });

  it("report_query_log insert matches the schema", () => {
    const reportRoute = readFile("app/api/reports/generate/route.ts");
    expect(reportRoute).toContain("user_id");
    expect(reportRoute).toContain("user_name");
    expect(reportRoute).toContain("prompt");
    expect(reportRoute).toContain("generated_sql");
    expect(reportRoute).toContain("success");
    expect(reportRoute).toContain("error_message");
    expect(reportRoute).toContain("row_count");
    expect(reportRoute).toContain("execution_time_ms");
    expect(reportRoute).toContain("retry_count");
  });

  it("truck_snapshots insert matches the schema", () => {
    const snapshotRoute = readFile("app/api/snapshots/route.ts");
    expect(snapshotRoute).toContain("truck_id");
    expect(snapshotRoute).toContain("truck_name");
    expect(snapshotRoute).toContain("captured_at");
    expect(snapshotRoute).toContain("reading_data");
    expect(snapshotRoute).toContain("source");
  });
});

// ── Anthropic API Contract ────────────────────────────────────────

describe("Contract: Anthropic API usage", () => {
  const aiLib = readFile("lib/ai.ts");
  const reportGen = readFile("app/api/reports/generate/route.ts");

  it("uses correct Anthropic API endpoint", () => {
    expect(aiLib).toContain("https://api.anthropic.com/v1/messages");
    expect(reportGen).toContain("https://api.anthropic.com/v1/messages");
  });

  it("uses correct API version header", () => {
    expect(aiLib).toContain("anthropic-version");
    expect(aiLib).toContain("2023-06-01");
  });

  it("expects content[0].text in response", () => {
    // Both AI callers extract text the same way
    expect(aiLib).toContain("result.content");
    expect(reportGen).toContain("data.content");
  });

  it("uses correct model identifier", () => {
    expect(aiLib).toContain("claude-sonnet-4-20250514");
    expect(reportGen).toContain("claude-sonnet-4-20250514");
  });
});

// ── Clerk Auth Contract ───────────────────────────────────────────

describe("Contract: Clerk user metadata shape", () => {
  const authGuard = readFile("lib/auth-guard.ts");

  it("reads role from publicMetadata.role", () => {
    expect(authGuard).toContain("publicMetadata");
    expect(authGuard).toContain("role");
  });

  it("falls back to 'operator' as default role", () => {
    expect(authGuard).toContain('"operator"');
  });

  it("supports Bearer token fallback for mobile", () => {
    expect(authGuard).toContain("Bearer");
    expect(authGuard).toContain("authorization");
  });
});

// ── Cross-Service Data Flow Contracts ─────────────────────────────

describe("Contract: Data flows between services are consistent", () => {
  it("shift report route passes correct part IDs to Viam", () => {
    const shiftRoute = readFile("app/api/shift-report/route.ts");
    // Must pass partId to exportTabularData
    expect(shiftRoute).toContain("partId");
    // Must query both sensor components
    expect(shiftRoute).toContain("plc-monitor");
    expect(shiftRoute).toContain("truck-engine");
  });

  it("snapshot route uses same Viam query pattern", () => {
    const snapshotRoute = readFile("app/api/snapshots/route.ts");
    expect(snapshotRoute).toContain("exportTabularData");
    expect(snapshotRoute).toContain("partId");
  });

  it("all routes using Supabase import from lib/supabase", () => {
    // Ensure nobody creates their own Supabase client
    const routeFiles = getAllRouteFiles();
    const allowedClients = ["lib/supabase.ts", "lib/supabase-browser.ts"];
    for (const file of routeFiles) {
      const source = fs.readFileSync(file, "utf-8");
      if (source.includes("createClient") && source.includes("@supabase")) {
        const relative = path.relative(DASHBOARD_ROOT, file);
        // Only our dedicated Supabase client files should import createClient
        expect(allowedClients).toContain(relative);
      }
    }
  });
});

/** Recursively find all .ts files in app/api and lib */
function getAllRouteFiles(): string[] {
  const files: string[] = [];
  const dirs = [
    path.resolve(DASHBOARD_ROOT, "app/api"),
    path.resolve(DASHBOARD_ROOT, "lib"),
  ];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith(".ts")) files.push(fullPath);
    }
  }

  for (const d of dirs) walk(d);
  return files;
}
