import { test, expect } from "@playwright/test";

/**
 * IronSight API Health Check Suite
 *
 * Verifies every API endpoint responds correctly:
 *   - GET routes: 200 or 401 (if auth fails), never 500
 *   - POST routes with empty body: 400 (validation) or 401, never 500
 *   - Grouped by module for clear reporting
 *
 * This is your API smoke test — catches broken imports, missing env vars,
 * and deployment issues before users hit them.
 */

const BASE = "http://localhost:3000";

interface Endpoint {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  // Expected status codes that indicate the endpoint is working (not crashed)
  healthy: number[];
  body?: Record<string, unknown>;
}

// Status codes that mean "endpoint exists and is handling requests"
const OK = [200, 201];
const AUTH_OR_OK = [200, 201, 401, 403];
const VALIDATION_OR_AUTH = [400, 401, 403, 422];

// =========================================================================
//  ENDPOINT REGISTRY — every API route in the app
// =========================================================================

const FLEET_ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/sensor-readings", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/truck-readings", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/cell-readings?sim=true", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/shift-report?date=2026-04-01&startHour=6&startMin=0&endHour=18&endMin=0", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/sensor-history", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/dtc-history", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/fleet/status", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/fleet/trucks", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/snapshots", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/truck-notes", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/truck-history", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/truck-history-local", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/truck-command", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "POST", path: "/api/truck-assignments", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "GET", path: "/api/maintenance", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/pi-health", healthy: AUTH_OR_OK },
];

const WORK_ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/work-orders", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/work-orders", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "PATCH", path: "/api/work-orders", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "GET", path: "/api/team-members", healthy: AUTH_OR_OK },
];

const CHAT_ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/chat/threads", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/chat/threads", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "GET", path: "/api/chat/threads/by-entity?entity_type=truck&entity_id=01", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/chat/users", healthy: AUTH_OR_OK },
];

const AI_ENDPOINTS: Endpoint[] = [
  { method: "POST", path: "/api/ai-chat", healthy: VALIDATION_OR_AUTH, body: { message: "test" } },
  { method: "POST", path: "/api/ai-diagnose", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "POST", path: "/api/ai-suggest-steps", healthy: VALIDATION_OR_AUTH, body: { title: "test" } },
  { method: "POST", path: "/api/ai-report-summary", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "POST", path: "/api/reports/generate", healthy: VALIDATION_OR_AUTH, body: { query: "test" } },
];

const TIMESHEET_ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/timesheets", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/timesheets", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "GET", path: "/api/timesheets/admin", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/timesheets/vehicles", healthy: AUTH_OR_OK },
];

const HR_ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/training", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/training/requirements", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/training/admin", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/pto", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/pto", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "GET", path: "/api/pto/admin", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/pto/balance", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/per-diem", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/per-diem/rates", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/profiles", healthy: AUTH_OR_OK },
];

const ACCOUNTING_ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/accounting/accounts", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/accounting/accounts", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "GET", path: "/api/accounting/entries", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/accounting/entries", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "GET", path: "/api/accounting/trial-balance", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/general-ledger", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/aging", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/cash-flow", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/invoices", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/accounting/invoices", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "GET", path: "/api/accounting/bills", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/accounting/bills", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "GET", path: "/api/accounting/customers", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/bank", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/recurring", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/budget", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/accounting/budget", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "GET", path: "/api/accounting/payroll-run", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/employee-tax", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/vendor-1099", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/fixed-assets", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/estimates", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/accounting/estimates", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "GET", path: "/api/accounting/expense-rules", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/receipt-ocr", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/audit-trail", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/payment-reminders", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/mileage-rates", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/sales-tax", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/accounting/tax-reports", healthy: AUTH_OR_OK },
];

const INVENTORY_ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/inventory", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/inventory", healthy: VALIDATION_OR_AUTH, body: {} },
  { method: "GET", path: "/api/inventory/alerts", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/inventory/usage", healthy: AUTH_OR_OK },
];

const SYSTEM_ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/help", healthy: OK },
  { method: "GET", path: "/api/reports", healthy: AUTH_OR_OK },
  { method: "GET", path: "/api/audit-log", healthy: AUTH_OR_OK },
  { method: "POST", path: "/api/webhooks/clerk", healthy: [200, 400, 401] },
];

// =========================================================================
//  TEST RUNNER
// =========================================================================

function describeEndpoints(groupName: string, endpoints: Endpoint[]) {
  test.describe(groupName, () => {
    for (const ep of endpoints) {
      test(`${ep.method} ${ep.path}`, async ({ request }) => {
        const url = `${BASE}${ep.path}`;
        let response;

        if (ep.method === "GET") {
          response = await request.get(url);
        } else if (ep.method === "POST") {
          response = await request.post(url, {
            data: ep.body ?? {},
            headers: { "Content-Type": "application/json" },
          });
        } else if (ep.method === "PATCH") {
          response = await request.patch(url, {
            data: ep.body ?? {},
            headers: { "Content-Type": "application/json" },
          });
        } else if (ep.method === "DELETE") {
          response = await request.delete(url);
        }

        expect(response).toBeDefined();
        const status = response!.status();

        // The endpoint should NOT return 500 (server crash) or 404 (missing route)
        expect(
          status,
          `${ep.method} ${ep.path} returned ${status} — expected one of [${ep.healthy.join(", ")}]`
        ).not.toBe(500);
        expect(status).not.toBe(404);

        // It should return one of the expected healthy status codes
        expect(
          ep.healthy,
          `${ep.method} ${ep.path} returned ${status}`
        ).toContain(status);
      });
    }
  });
}

describeEndpoints("Fleet & Sensor APIs", FLEET_ENDPOINTS);
describeEndpoints("Work Order APIs", WORK_ENDPOINTS);
describeEndpoints("Chat APIs", CHAT_ENDPOINTS);
describeEndpoints("AI Feature APIs", AI_ENDPOINTS);
describeEndpoints("Timesheet APIs", TIMESHEET_ENDPOINTS);
describeEndpoints("HR APIs (Training, PTO, Profiles)", HR_ENDPOINTS);
describeEndpoints("Accounting APIs", ACCOUNTING_ENDPOINTS);
describeEndpoints("Inventory APIs", INVENTORY_ENDPOINTS);
describeEndpoints("System APIs", SYSTEM_ENDPOINTS);
