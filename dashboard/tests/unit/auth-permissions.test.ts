/**
 * Auth & Route Permissions Tests
 *
 * Tests the ROUTE_PERMISSIONS map and role helper functions in
 * packages/shared/src/auth.ts. These permissions control which API
 * routes and pages each role can access.
 *
 * WHAT TO ADD:
 * When you add a new API route or page, add it to ROUTE_PERMISSIONS
 * in auth.ts AND add a test here verifying the correct roles.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/auth-permissions.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  ROUTE_PERMISSIONS,
  hasRole,
  cleanRole,
  canManageFleet,
  canSeeAllTrucks,
  canUseAI,
  canIssueCommands,
} from "@ironsight/shared/auth";
import type { UserRole } from "@ironsight/shared/auth";

// All 4 roles for convenience
const ALL_ROLES: UserRole[] = ["developer", "manager", "mechanic", "operator"];
const ADMIN_ROLES: UserRole[] = ["developer", "manager"];

// ── Route existence ─────────────────────────────────────────────────

describe("ROUTE_PERMISSIONS has all expected routes", () => {
  const expectedRoutes = [
    // Profiles
    "/api/profiles",
    "/api/profiles/upload",
    // PTO
    "/api/pto",
    "/api/pto/admin",
    "/api/pto/balance",
    // Training
    "/api/training",
    "/api/training/requirements",
    "/api/training/admin",
    // Per Diem
    "/api/per-diem",
    "/api/per-diem/rates",
    // Timesheets
    "/api/timesheets",
    "/api/timesheets/admin",
    "/api/timesheets/vehicles",
    // Fleet & telemetry
    "/api/fleet/status",
    "/api/fleet/trucks",
    "/api/sensor-readings",
    "/api/truck-readings",
    // AI
    "/api/ai-chat",
    "/api/ai-diagnose",
    // Commands
    "/api/plc-command",
    "/api/truck-command",
    // Pages
    "/profile",
    "/pto",
    "/pto/admin",
    "/training",
    "/training/admin",
    "/timesheets",
    "/timesheets/admin",
  ];

  for (const route of expectedRoutes) {
    it(`route "${route}" exists in ROUTE_PERMISSIONS`, () => {
      expect(ROUTE_PERMISSIONS[route]).toBeDefined();
      expect(Array.isArray(ROUTE_PERMISSIONS[route])).toBe(true);
      expect(ROUTE_PERMISSIONS[route].length).toBeGreaterThan(0);
    });
  }
});

// ── /api/profiles ───────────────────────────────────────────────────

describe("/api/profiles permissions", () => {
  it("is accessible by all 4 roles", () => {
    const perms = ROUTE_PERMISSIONS["/api/profiles"];
    for (const role of ALL_ROLES) {
      expect(perms).toContain(role);
    }
  });

  it("has exactly 4 roles (one per UserRole)", () => {
    expect(ROUTE_PERMISSIONS["/api/profiles"]).toHaveLength(4);
  });
});

// ── /api/pto ────────────────────────────────────────────────────────

describe("/api/pto permissions", () => {
  it("is accessible by all 4 roles", () => {
    const perms = ROUTE_PERMISSIONS["/api/pto"];
    for (const role of ALL_ROLES) {
      expect(perms).toContain(role);
    }
  });
});

describe("/api/pto/admin permissions", () => {
  it("is accessible only by developer and manager", () => {
    const perms = ROUTE_PERMISSIONS["/api/pto/admin"];
    expect(perms).toContain("developer");
    expect(perms).toContain("manager");
    expect(perms).not.toContain("mechanic");
    expect(perms).not.toContain("operator");
  });

  it("has exactly 2 roles", () => {
    expect(ROUTE_PERMISSIONS["/api/pto/admin"]).toHaveLength(2);
  });
});

// ── /api/training ───────────────────────────────────────────────────

describe("/api/training permissions", () => {
  it("is accessible by all 4 roles", () => {
    const perms = ROUTE_PERMISSIONS["/api/training"];
    for (const role of ALL_ROLES) {
      expect(perms).toContain(role);
    }
  });
});

describe("/api/training/admin permissions", () => {
  it("is accessible only by developer and manager", () => {
    const perms = ROUTE_PERMISSIONS["/api/training/admin"];
    expect(perms).toContain("developer");
    expect(perms).toContain("manager");
    expect(perms).not.toContain("mechanic");
    expect(perms).not.toContain("operator");
  });

  it("has exactly 2 roles", () => {
    expect(ROUTE_PERMISSIONS["/api/training/admin"]).toHaveLength(2);
  });
});

// ── /api/per-diem ───────────────────────────────────────────────────

describe("/api/per-diem permissions", () => {
  it("is accessible by all 4 roles", () => {
    const perms = ROUTE_PERMISSIONS["/api/per-diem"];
    for (const role of ALL_ROLES) {
      expect(perms).toContain(role);
    }
  });
});

describe("/api/per-diem/rates permissions", () => {
  it("is accessible only by developer and manager", () => {
    const perms = ROUTE_PERMISSIONS["/api/per-diem/rates"];
    expect(perms).toContain("developer");
    expect(perms).toContain("manager");
    expect(perms).not.toContain("mechanic");
    expect(perms).not.toContain("operator");
  });

  it("has exactly 2 roles", () => {
    expect(ROUTE_PERMISSIONS["/api/per-diem/rates"]).toHaveLength(2);
  });
});

// ── /api/timesheets ─────────────────────────────────────────────────

describe("/api/timesheets permissions", () => {
  it("is accessible by all 4 roles", () => {
    const perms = ROUTE_PERMISSIONS["/api/timesheets"];
    for (const role of ALL_ROLES) {
      expect(perms).toContain(role);
    }
  });
});

describe("/api/timesheets/admin permissions", () => {
  it("is accessible only by developer and manager", () => {
    const perms = ROUTE_PERMISSIONS["/api/timesheets/admin"];
    expect(perms).toContain("developer");
    expect(perms).toContain("manager");
    expect(perms).not.toContain("mechanic");
    expect(perms).not.toContain("operator");
  });
});

// ── hasRole() ───────────────────────────────────────────────────────

describe("hasRole()", () => {
  it("returns true when role is in the allowed list", () => {
    expect(hasRole("developer", ["developer", "manager"])).toBe(true);
    expect(hasRole("mechanic", ["mechanic"])).toBe(true);
  });

  it("returns false when role is NOT in the allowed list", () => {
    expect(hasRole("operator", ["developer", "manager"])).toBe(false);
    expect(hasRole("mechanic", ["developer"])).toBe(false);
  });

  it("strips 'org:' prefix from Clerk roles before comparing", () => {
    // Clerk returns roles as "org:developer", "org:mechanic", etc.
    expect(hasRole("org:developer", ["developer"])).toBe(true);
    expect(hasRole("org:mechanic", ["mechanic", "developer"])).toBe(true);
    expect(hasRole("org:operator", ["developer", "manager"])).toBe(false);
  });

  it("returns false for undefined role", () => {
    expect(hasRole(undefined, ["developer"])).toBe(false);
  });

  it("returns false for empty allowed list", () => {
    expect(hasRole("developer", [])).toBe(false);
  });
});

// ── cleanRole() ─────────────────────────────────────────────────────

describe("cleanRole()", () => {
  it("strips org: prefix", () => {
    expect(cleanRole("org:developer")).toBe("developer");
    expect(cleanRole("org:operator")).toBe("operator");
    expect(cleanRole("org:mechanic")).toBe("mechanic");
    expect(cleanRole("org:manager")).toBe("manager");
  });

  it("returns role unchanged if no org: prefix", () => {
    expect(cleanRole("developer")).toBe("developer");
    expect(cleanRole("mechanic")).toBe("mechanic");
  });
});

// ── canManageFleet() ────────────────────────────────────────────────

describe("canManageFleet()", () => {
  it("returns true only for developer and manager", () => {
    expect(canManageFleet("developer")).toBe(true);
    expect(canManageFleet("manager")).toBe(true);
  });

  it("returns false for mechanic and operator", () => {
    expect(canManageFleet("mechanic")).toBe(false);
    expect(canManageFleet("operator")).toBe(false);
  });

  it("handles org: prefix correctly", () => {
    expect(canManageFleet("org:developer")).toBe(true);
    expect(canManageFleet("org:manager")).toBe(true);
    expect(canManageFleet("org:mechanic")).toBe(false);
    expect(canManageFleet("org:operator")).toBe(false);
  });
});

// ── canSeeAllTrucks() ───────────────────────────────────────────────

describe("canSeeAllTrucks()", () => {
  it("returns true for non-operator roles", () => {
    expect(canSeeAllTrucks("developer")).toBe(true);
    expect(canSeeAllTrucks("manager")).toBe(true);
    expect(canSeeAllTrucks("mechanic")).toBe(true);
  });

  it("returns false for operator (limited to assigned trucks only)", () => {
    expect(canSeeAllTrucks("operator")).toBe(false);
    expect(canSeeAllTrucks("org:operator")).toBe(false);
  });
});

// ── canUseAI() ──────────────────────────────────────────────────────

describe("canUseAI()", () => {
  it("returns true for developer, manager, mechanic", () => {
    expect(canUseAI("developer")).toBe(true);
    expect(canUseAI("manager")).toBe(true);
    expect(canUseAI("mechanic")).toBe(true);
  });

  it("returns false for operator", () => {
    expect(canUseAI("operator")).toBe(false);
    expect(canUseAI("org:operator")).toBe(false);
  });
});

// ── canIssueCommands() ──────────────────────────────────────────────

describe("canIssueCommands()", () => {
  it("returns true for developer, manager, mechanic", () => {
    expect(canIssueCommands("developer")).toBe(true);
    expect(canIssueCommands("manager")).toBe(true);
    expect(canIssueCommands("mechanic")).toBe(true);
  });

  it("returns false for operator", () => {
    expect(canIssueCommands("operator")).toBe(false);
    expect(canIssueCommands("org:operator")).toBe(false);
  });
});

// ── Admin-only route pattern ────────────────────────────────────────

describe("admin-only routes follow consistent pattern", () => {
  // All routes ending in /admin should be restricted to developer + manager
  const adminRoutes = Object.keys(ROUTE_PERMISSIONS).filter((route) =>
    route.endsWith("/admin")
  );

  it("there are admin routes to test", () => {
    expect(adminRoutes.length).toBeGreaterThan(0);
  });

  for (const route of adminRoutes) {
    it(`${route} is restricted to developer and manager only`, () => {
      const perms = ROUTE_PERMISSIONS[route];
      expect(perms).toContain("developer");
      expect(perms).toContain("manager");
      expect(perms).not.toContain("mechanic");
      expect(perms).not.toContain("operator");
    });
  }
});
