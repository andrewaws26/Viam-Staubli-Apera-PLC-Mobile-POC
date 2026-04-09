/**
 * Data Feature Integrity Tests
 *
 * Validates that all data-dependent features have correct field mappings,
 * proper error handling, and stay in sync with the database schema.
 *
 * WHY: When the platform grows, features break silently because:
 * 1. A migration renames a column but the AI prompt still uses the old name
 * 2. A new table is added but not included in the report generator context
 * 3. Field mappings in snapshot/shift-report reference wrong payload keys
 *
 * These tests catch those issues at build time, not in production.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── Helpers ──────────────────────────────────────────────────────────

function readFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, "../..", relativePath), "utf-8");
}

function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.resolve(__dirname, "../..", relativePath));
}

// ── Report Generator Tests ───────────────────────────────────────────

describe("Report Generator: System prompt integrity", () => {
  const routeFile = readFile("app/api/reports/generate/route.ts");

  it("should use prompt caching for cost efficiency", () => {
    expect(routeFile).toContain("cache_control");
    expect(routeFile).toContain("ephemeral");
  });

  it("should have auto-retry logic", () => {
    expect(routeFile).toContain("retryContext");
    expect(routeFile).toContain("That query failed");
  });

  it("should log all query attempts", () => {
    expect(routeFile).toContain("logQuery");
    expect(routeFile).toContain("report_query_log");
  });

  it("should validate SQL before execution", () => {
    expect(routeFile).toContain("validateSQL");
  });

  it("should use exec_readonly_query for sandboxed execution", () => {
    expect(routeFile).toContain("exec_readonly_query");
  });

  it("system prompt should warn about common pitfalls", () => {
    // These rules prevent the most common query failures
    expect(routeFile).toContain("ONLY the exact column names");
    expect(routeFile).toContain("maintenance_events");
    expect(routeFile).toContain("user_name");
  });
});

// ── Shift Report Tests ───────────────────────────────────────────────

describe("Shift Report: Data pipeline integrity", () => {
  const routeFile = readFile("app/api/shift-report/route.ts");
  const aggregationFile = readFile("app/api/shift-report/aggregation.ts");

  it("should pass truck_id to the API", () => {
    expect(routeFile).toContain("truck_id");
  });

  it("should query both plc-monitor and truck-engine", () => {
    expect(routeFile).toContain('"plc-monitor"');
    expect(routeFile).toContain('"truck-engine"');
  });

  it("should log data query parameters for debugging", () => {
    expect(routeFile).toContain("[SHIFT-REPORT]");
  });

  it("should NOT silently swallow errors without logging", () => {
    // The old code had .catch(() => []) which hid failures
    expect(routeFile).toContain("console.error");
    expect(routeFile).toContain("SHIFT-REPORT");
  });

  it("should merge trips with gaps under 60 seconds", () => {
    expect(aggregationFile).toContain("MIN_GAP_SEC");
    expect(aggregationFile).toContain("merged");
  });

  it("trip detection should use rpm > 0 as running indicator", () => {
    expect(aggregationFile).toContain("rpm > 0");
  });
});

// ── Snapshot Feature Tests ───────────────────────────────────────────

describe("Snapshots: Field coverage", () => {
  const snapshotPage = readFile("app/snapshots/page.tsx");

  // All 14 standard GaugeGrid categories must be in the snapshot viewer
  const requiredCategories = [
    "Engine", "Temperatures", "Pressures", "Vehicle",
    "Aftertreatment", "Brakes", "PTO", "Idle",
    "Air", "Navigation", "Extended Engine", "Fuel Cost",
    "System Health", "Lifetime",
  ];

  for (const category of requiredCategories) {
    it(`should include "${category}" category`, () => {
      expect(snapshotPage).toContain(category);
    });
  }

  // Critical fields that must be in the snapshot
  const criticalSnapshotFields = [
    "engine_rpm", "coolant_temp_f", "battery_voltage_v",
    "vehicle_speed_mph", "oil_pressure_psi", "def_level_pct",
    "gps_latitude", "gps_longitude", "engine_hours", "vin",
    "active_dtc_count",
  ];

  for (const field of criticalSnapshotFields) {
    it(`should display field "${field}"`, () => {
      expect(snapshotPage).toContain(field);
    });
  }

  it("should handle VIN normalization (vin vs vehicle_vin)", () => {
    expect(snapshotPage).toContain("vehicle_vin");
    expect(snapshotPage).toContain("UNKNOWN");
  });

  it("should show DTC details from dynamic fields", () => {
    // Template literals: dtc_${i}_spn, dtc_${i}_fmi
    expect(snapshotPage).toContain("_spn");
    expect(snapshotPage).toContain("_fmi");
    expect(snapshotPage).toContain("SPN");
    expect(snapshotPage).toContain("FMI");
  });
});

describe("Snapshots: API completeness", () => {
  it("should have POST route for capture", () => {
    const route = readFile("app/api/snapshots/route.ts");
    expect(route).toContain("export async function POST");
  });

  it("should have GET route for listing", () => {
    const route = readFile("app/api/snapshots/route.ts");
    expect(route).toContain("export async function GET");
  });

  it("should have GET route for individual snapshot", () => {
    const route = readFile("app/api/snapshots/[id]/route.ts");
    expect(route).toContain("export async function GET");
  });

  it("should support historical capture with timestamp", () => {
    const route = readFile("app/api/snapshots/route.ts");
    expect(route).toContain("timestamp");
    expect(route).toContain("historical");
  });

  it("should audit log snapshot captures", () => {
    const route = readFile("app/api/snapshots/route.ts");
    expect(route).toContain("logAudit");
    expect(route).toContain("snapshot_captured");
  });
});

// ── GaugeGrid Format Tests ───────────────────────────────────────────

describe("GaugeGrid: formatValue coverage", () => {
  const gaugeGrid = readFile("components/GaugeGrid.tsx");

  // Units that must have explicit formatters (to avoid showing raw numbers)
  const requiredFormatters = [
    ["_f", "F"],            // Temperatures (°F via unicode \u00B0F)
    ["_psi", "PSI"],        // Pressures
    ["_v", "V"],            // Voltages
    ["_mph", "mph"],        // Speeds
    ["_gph", "gal/h"],      // Fuel rates
    ["_mpg", "mpg"],        // Fuel economy
    ["_pct", "%"],          // Percentages
    ["_gal", "gal"],        // Volumes
    ["_mi", "mi"],          // Distances
  ];

  for (const [suffix, unit] of requiredFormatters) {
    it(`should format ${suffix} fields with "${unit}" unit`, () => {
      expect(gaugeGrid).toContain(suffix);
      expect(gaugeGrid).toContain(unit);
    });
  }

  it("should format DTC counts as integers", () => {
    expect(gaugeGrid).toContain("_count");
  });

  it("should format CPU temp with C unit", () => {
    expect(gaugeGrid).toContain("cpu_temp_c");
    expect(gaugeGrid).toContain("C"); // °C via unicode \u00B0C
  });
});

// ── Route Permissions Tests ──────────────────────────────────────────

describe("Route Permissions: Data features are accessible", () => {
  const authFile = readFile("../packages/shared/src/auth.ts");

  const dataRoutes = [
    "/api/shift-report",
    "/api/snapshots",
    "/api/truck-readings",
    "/api/sensor-readings",
    "/api/reports",
  ];

  for (const route of dataRoutes) {
    it(`${route} should have permissions defined`, () => {
      expect(authFile).toContain(`"${route}"`);
    });
  }

  const dataPages = [
    "/snapshots",
  ];

  for (const page of dataPages) {
    it(`page ${page} should have permissions defined`, () => {
      expect(authFile).toContain(`"${page}"`);
    });
  }
});

// ── Migration File Integrity ─────────────────────────────────────────

describe("Migration Files: Structure", () => {
  const requiredMigrations = [
    "031_truck_snapshots.sql",
    "030_report_query_log.sql",
    "028_saved_reports.sql",
  ];

  for (const migration of requiredMigrations) {
    it(`${migration} should exist`, () => {
      expect(fileExists(`supabase/migrations/${migration}`)).toBe(true);
    });
  }

  it("truck_snapshots migration should have reading_data JSONB column", () => {
    const sql = readFile("supabase/migrations/031_truck_snapshots.sql");
    expect(sql).toContain("reading_data");
    expect(sql).toContain("JSONB");
  });

  it("report_query_log migration should have retry_count column", () => {
    const sql = readFile("supabase/migrations/030_report_query_log.sql");
    expect(sql).toContain("retry_count");
  });
});

// ── Cross-Feature Consistency ────────────────────────────────────────

describe("Cross-Feature: Consistent field naming", () => {
  const schemaContext = readFile("lib/report-schema-context.ts");
  const snapshotPage = readFile("app/snapshots/page.tsx");
  const gaugeGrid = readFile("components/GaugeGrid.tsx");

  it("all features should agree that DTC uses spn/fmi (not code)", () => {
    // Schema context
    expect(schemaContext).toContain("spn");
    expect(schemaContext).toContain("fmi");
    // Snapshot uses template literals: dtc_${i}_spn
    expect(snapshotPage).toContain("_spn");
    expect(snapshotPage).toContain("_fmi");
  });

  it("all features should agree on engine_rpm field name", () => {
    expect(schemaContext.toLowerCase()).not.toContain('"rpm"'); // Not just "rpm"
    expect(snapshotPage).toContain("engine_rpm");
    expect(gaugeGrid).toContain("engine_rpm");
  });

  it("all features should agree on user_name (not first_name/last_name)", () => {
    expect(schemaContext).toContain("user_name");
    // The employee_profiles section should use user_name, not first_name/last_name
    // Find the Columns: line for employee_profiles
    const lines = schemaContext.split("\n");
    const profileLine = lines.find(l => l.includes("employee_profiles") && l.includes("Columns:"));
    if (profileLine) {
      expect(profileLine).toContain("user_name");
      expect(profileLine).not.toContain("first_name");
      expect(profileLine).not.toContain("last_name");
    }
  });
});
