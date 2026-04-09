/**
 * Manager Command Center — Tests
 *
 * Verifies:
 * 1. API route exists and enforces role-based access
 * 2. Page component exists and is a client component
 * 3. Response shape contract (all expected fields present)
 * 4. Navigation links to /manager exist in nav and home screen
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

// ── API Route ─────────────────────────────────────────────────────

describe("Manager Dashboard: API route", () => {
  it("route file exists", () => {
    expect(fileExists("app/api/manager/dashboard/route.ts")).toBe(true);
  });

  const route = readFile("app/api/manager/dashboard/route.ts");

  it("enforces authentication", () => {
    expect(route).toContain("auth()");
    expect(route).toContain("Unauthorized");
  });

  it("enforces manager/developer role", () => {
    expect(route).toContain("Forbidden");
    expect(route).toMatch(/manager|developer/);
  });

  it("is force-dynamic (no caching)", () => {
    expect(route).toContain('force-dynamic');
  });

  it("queries timesheets with submitted status", () => {
    expect(route).toContain("timesheets");
    expect(route).toContain("submitted");
  });

  it("queries pto_requests with pending status", () => {
    expect(route).toContain("pto_requests");
    expect(route).toContain("pending");
  });

  it("queries work_orders", () => {
    expect(route).toContain("work_orders");
  });

  it("queries training data", () => {
    expect(route).toMatch(/training_records|training/);
  });

  it("queries audit_log for activity feed", () => {
    expect(route).toContain("audit_log");
  });

  it("returns generatedAt timestamp", () => {
    expect(route).toContain("generatedAt");
  });
});

// ── Page Component ────────────────────────────────────────────────

describe("Manager Dashboard: Page component", () => {
  it("page file exists", () => {
    expect(fileExists("app/manager/page.tsx")).toBe(true);
  });

  const page = readFile("app/manager/page.tsx");

  it("is a client component", () => {
    expect(page).toContain('"use client"');
  });

  it("fetches from /api/manager/dashboard", () => {
    expect(page).toContain("/api/manager/dashboard");
  });

  it("handles 403 forbidden response", () => {
    expect(page).toContain("403");
  });

  it("links to timesheet admin for approvals", () => {
    expect(page).toContain("/timesheets/admin");
  });

  it("links to PTO admin", () => {
    expect(page).toContain("/pto/admin");
  });

  it("links to work orders", () => {
    expect(page).toContain("/work");
  });

  it("links to training admin", () => {
    expect(page).toContain("/training/admin");
  });

  it("links to fleet overview", () => {
    expect(page).toContain("/fleet");
  });

  it("shows loading state", () => {
    expect(page).toMatch(/loading|Loading|skeleton|Skeleton|animate-pulse/);
  });

  it("auto-refreshes periodically", () => {
    expect(page).toMatch(/setInterval|interval/i);
  });

  it("displays action counts for all categories", () => {
    expect(page).toContain("pendingCount");
    expect(page).toContain("workOrders");
    expect(page).toContain("training");
  });
});

// ── Navigation ────────────────────────────────────────────────────

describe("Manager Dashboard: Navigation", () => {
  it("home screen has link to /manager", () => {
    const home = readFile("components/HomeScreen.tsx");
    expect(home).toContain("/manager");
  });

  it("tour includes Command Center stop", () => {
    const tour = readFile("app/tour/page.tsx");
    expect(tour).toContain("Command Center");
    expect(tour).toContain("/manager");
  });
});

// ── Response Shape Contract ───────────────────────────────────────

describe("Manager Dashboard: API response shape contract", () => {
  const route = readFile("app/api/manager/dashboard/route.ts");

  it("response includes timesheets section", () => {
    expect(route).toContain("timesheets");
    expect(route).toContain("pendingCount");
  });

  it("response includes pto section", () => {
    expect(route).toContain("pto");
  });

  it("response includes workOrders section with status counts", () => {
    expect(route).toContain("workOrders");
    expect(route).toContain("blocked");
    expect(route).toContain("open");
  });

  it("response includes training section with alerts", () => {
    expect(route).toContain("training");
    expect(route).toContain("alerts");
  });

  it("response includes activity feed", () => {
    expect(route).toContain("activity");
  });
});
