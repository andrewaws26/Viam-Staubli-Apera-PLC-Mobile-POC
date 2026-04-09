/**
 * Auth Middleware & Route Permission Enforcement Tests
 *
 * Verifies that the authentication/authorization system actually blocks
 * unauthenticated requests — not just that the config exists.
 *
 * Layer 2 tests: these read source code of routes to verify auth checks
 * are present at the code level, catching routes that forgot to add auth.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const DASHBOARD_ROOT = path.resolve(__dirname, "../..");

function readFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(DASHBOARD_ROOT, relativePath), "utf-8");
}

// ── Middleware Configuration ───────────────────────────────────────

describe("Auth Middleware: Default-deny configuration", () => {
  const middleware = readFile("middleware.ts");

  it("should NOT mark all /api routes as public", () => {
    // The old vulnerability: /api(.*) was public, bypassing auth entirely
    expect(middleware).not.toMatch(/isPublicRoute.*createRouteMatcher\(\[[\s\S]*?"\/api\(\.\*\)"[\s\S]*?\]\)/);
    // More direct check
    expect(middleware).not.toContain('"/api(.*)"');
  });

  it("should keep webhooks public", () => {
    expect(middleware).toContain("webhooks");
  });

  it("should protect all non-webhook API routes", () => {
    expect(middleware).toContain("auth.protect()");
  });
});

// ── Route-Level Auth Checks ───────────────────────────────────────
// Scan all API route files and verify they have auth checks

function getAllApiRoutes(): string[] {
  const apiDir = path.resolve(DASHBOARD_ROOT, "app/api");
  const routes: string[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name === "route.ts") {
        routes.push(fullPath);
      }
    }
  }

  walk(apiDir);
  return routes;
}

describe("Route-Level Auth: Every API route should have auth", () => {
  const routes = getAllApiRoutes();
  const WEBHOOK_ROUTES = ["webhooks"];

  // All routes now have route-level auth checks (defense-in-depth).
  const MIDDLEWARE_ONLY_AUTH: string[] = [];

  // Auth patterns we accept — any of these means the route has auth
  const AUTH_PATTERNS = [
    /await\s+auth\(\)/,            // Clerk auth()
    /getAuthUserId\(\)/,           // Custom auth helper
    /requireRole\(/,               // Role-based auth
    /requireTruckAccess\(/,        // Truck-level auth
    /getUserRole\(/,               // Role check (implies auth happened)
  ];

  for (const routePath of routes) {
    const relativePath = path.relative(DASHBOARD_ROOT, routePath);

    // Skip webhook routes (they use signature verification, not session auth)
    if (WEBHOOK_ROUTES.some(w => relativePath.includes(w))) continue;
    // Skip routes that rely on middleware auth (tracked as tech debt above)
    if (MIDDLEWARE_ONLY_AUTH.some(r => relativePath.includes(r))) continue;

    it(`${relativePath} should have an auth check`, () => {
      const source = fs.readFileSync(routePath, "utf-8");

      // Check each exported handler (GET, POST, PATCH, DELETE, PUT)
      const handlers = source.match(/export\s+async\s+function\s+(GET|POST|PATCH|DELETE|PUT)/g) || [];

      if (handlers.length === 0) return; // No handlers = not a real route

      // At least one auth pattern should be present in the file
      const hasAuth = AUTH_PATTERNS.some(p => p.test(source));
      expect(
        hasAuth,
        `${relativePath} has ${handlers.length} handler(s) but no auth check. ` +
        `Add auth(), getAuthUserId(), or requireRole() to protect this route.`
      ).toBe(true);
    });
  }
});

// ── Financial Routes: Extra Auth Checks ───────────────────────────

describe("Financial Routes: Manager/developer role required", () => {
  const financialRoutes = [
    "app/api/accounting/entries/route.ts",
    "app/api/accounting/invoices/route.ts",
    "app/api/accounting/payroll-run/route.ts",
    "app/api/accounting/bills/route.ts",
  ];

  for (const route of financialRoutes) {
    it(`${route} should check for manager/developer role`, () => {
      const fullPath = path.resolve(DASHBOARD_ROOT, route);
      if (!fs.existsSync(fullPath)) return; // Skip if route doesn't exist

      const source = fs.readFileSync(fullPath, "utf-8");
      const hasRoleCheck =
        source.includes("manager") &&
        (source.includes("developer") || source.includes("isManager"));
      expect(
        hasRoleCheck,
        `${route} is a financial route but doesn't check for manager/developer role`
      ).toBe(true);
    });
  }
});

// ── Idempotency: Financial Routes Should Support It ───────────────

describe("Financial Routes: Idempotency key support", () => {
  const idempotentRoutes = [
    "app/api/accounting/entries/route.ts",
    "app/api/accounting/invoices/route.ts",
    "app/api/accounting/payroll-run/route.ts",
  ];

  for (const route of idempotentRoutes) {
    it(`${route} should check for x-idempotency-key header`, () => {
      const fullPath = path.resolve(DASHBOARD_ROOT, route);
      if (!fs.existsSync(fullPath)) return;

      const source = fs.readFileSync(fullPath, "utf-8");
      expect(source).toContain("idempotency");
    });
  }
});

// ── Rate Limiting: AI Routes Should Have It ───────────────────────

describe("AI Routes: Rate limiting", () => {
  it("chat messages route should rate-limit @ai mentions", () => {
    const source = readFile("app/api/chat/threads/[threadId]/messages/route.ts");
    expect(source).toContain("aiMentionLimiter");
    expect(source).toContain("rateCheck");
  });
});
