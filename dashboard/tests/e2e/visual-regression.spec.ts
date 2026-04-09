import { test, expect, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * IronSight Visual Regression Suite
 *
 * Captures every page at desktop + mobile viewports.
 * Two layers:
 *   1. toHaveScreenshot() — pixel-diff against baseline (catches regressions)
 *   2. Saves captures to visual-qa/captures/ for AI design review
 *
 * First run creates baselines. Update with: npx playwright test --update-snapshots
 */

const CAPTURES_DIR = path.join(__dirname, "..", "visual-qa", "captures");

// Ensure captures directory exists
if (!fs.existsSync(CAPTURES_DIR)) {
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });
}

async function captureAndCompare(
  page: Page,
  name: string,
  options?: {
    fullPage?: boolean;
    waitFor?: string;
    waitForTimeout?: number;
    mask?: string[];
  }
) {
  await page.waitForLoadState("networkidle").catch(() => {});
  if (options?.waitFor) {
    await page
      .waitForSelector(options.waitFor, { timeout: 8000 })
      .catch(() => {});
  }
  // Let animations settle
  await page.waitForTimeout(options?.waitForTimeout ?? 800);

  // Build mask locators for dynamic content (timestamps, live data)
  const maskLocators = (options?.mask ?? []).map((sel) => page.locator(sel));

  // Save capture for AI review
  const capturePath = path.join(CAPTURES_DIR, `${name}.png`);
  await page.screenshot({
    path: capturePath,
    fullPage: options?.fullPage ?? true,
  });

  // Pixel-diff against baseline
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: options?.fullPage ?? true,
    maxDiffPixelRatio: 0.02,
    threshold: 0.3,
    mask: maskLocators,
  });
}

function isAuthenticated(page: Page): boolean {
  return !page.url().includes("sign-in");
}

// ---------------------------------------------------------------------------
// Helper: navigate and skip if auth redirects
// ---------------------------------------------------------------------------
async function gotoOrSkip(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 15000 });
  if (!isAuthenticated(page)) {
    test.skip(true, "Auth required — set E2E_CLERK_EMAIL/PASSWORD");
  }
}

// =========================================================================
//  HOME
// =========================================================================
test.describe("Home", () => {
  test("homepage / IronSight OS launcher", async ({ page }) => {
    await gotoOrSkip(page, "/");
    await captureAndCompare(page, "home", {
      waitFor: 'text="IronSight"',
    });
  });
});

// =========================================================================
//  FLEET SECTION
// =========================================================================
test.describe("Fleet", () => {
  test("fleet overview — all trucks", async ({ page }) => {
    await gotoOrSkip(page, "/fleet");
    await captureAndCompare(page, "fleet-overview", {
      waitFor: "h1, h2, [data-testid]",
    });
  });

  test("shift report", async ({ page }) => {
    await gotoOrSkip(page, "/shift-report");
    await captureAndCompare(page, "shift-report", {
      mask: ['time, [data-testid="timestamp"]'],
    });
  });

  test("snapshots", async ({ page }) => {
    await gotoOrSkip(page, "/snapshots");
    await captureAndCompare(page, "snapshots");
  });

  test("fleet docs", async ({ page }) => {
    await gotoOrSkip(page, "/fleet/docs");
    await captureAndCompare(page, "fleet-docs");
  });

  test("fleet AI docs", async ({ page }) => {
    await gotoOrSkip(page, "/fleet/ai-docs");
    await captureAndCompare(page, "fleet-ai-docs");
  });
});

// =========================================================================
//  OPERATIONS SECTION
// =========================================================================
test.describe("Operations", () => {
  test("work board", async ({ page }) => {
    await gotoOrSkip(page, "/work");
    await captureAndCompare(page, "work-board", {
      waitFor: 'text="Work Board", h1',
    });
  });

  test("work docs", async ({ page }) => {
    await gotoOrSkip(page, "/work/docs");
    await captureAndCompare(page, "work-docs");
  });

  test("team chat", async ({ page }) => {
    await gotoOrSkip(page, "/chat");
    await captureAndCompare(page, "chat", {
      waitFor: 'text="Chat", h1',
    });
  });
});

// =========================================================================
//  PEOPLE SECTION
// =========================================================================
test.describe("People", () => {
  test("my timesheets", async ({ page }) => {
    await gotoOrSkip(page, "/timesheets");
    await captureAndCompare(page, "timesheets");
  });

  test("new timesheet", async ({ page }) => {
    await gotoOrSkip(page, "/timesheets/new");
    await captureAndCompare(page, "timesheet-new");
  });

  test("timesheet admin", async ({ page }) => {
    await gotoOrSkip(page, "/timesheets/admin");
    await captureAndCompare(page, "timesheet-admin");
  });

  test("timesheet docs", async ({ page }) => {
    await gotoOrSkip(page, "/timesheets/docs");
    await captureAndCompare(page, "timesheet-docs");
  });

  test("PTO — time off", async ({ page }) => {
    await gotoOrSkip(page, "/pto");
    await captureAndCompare(page, "pto");
  });

  test("PTO — new request", async ({ page }) => {
    await gotoOrSkip(page, "/pto/new");
    await captureAndCompare(page, "pto-new");
  });

  test("PTO admin", async ({ page }) => {
    await gotoOrSkip(page, "/pto/admin");
    await captureAndCompare(page, "pto-admin");
  });

  test("training", async ({ page }) => {
    await gotoOrSkip(page, "/training");
    await captureAndCompare(page, "training");
  });

  test("training admin", async ({ page }) => {
    await gotoOrSkip(page, "/training/admin");
    await captureAndCompare(page, "training-admin");
  });

  test("my profile", async ({ page }) => {
    await gotoOrSkip(page, "/profile");
    await captureAndCompare(page, "profile");
  });

  test("team roster", async ({ page }) => {
    await gotoOrSkip(page, "/team");
    await captureAndCompare(page, "team");
  });

  test("vehicle admin", async ({ page }) => {
    await gotoOrSkip(page, "/admin/vehicles");
    await captureAndCompare(page, "admin-vehicles");
  });
});

// =========================================================================
//  FINANCE / ACCOUNTING SECTION
// =========================================================================
test.describe("Finance", () => {
  test("accounting home", async ({ page }) => {
    await gotoOrSkip(page, "/accounting");
    await captureAndCompare(page, "accounting-home");
  });

  test("accounting — new journal entry", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/new");
    await captureAndCompare(page, "accounting-new-entry");
  });

  test("invoices", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/invoices");
    await captureAndCompare(page, "accounting-invoices");
  });

  test("bills", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/bills");
    await captureAndCompare(page, "accounting-bills");
  });

  test("customers & vendors", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/customers");
    await captureAndCompare(page, "accounting-customers");
  });

  test("bank reconciliation", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/bank");
    await captureAndCompare(page, "accounting-bank");
  });

  test("recurring entries", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/recurring");
    await captureAndCompare(page, "accounting-recurring");
  });

  test("accounting periods", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/periods");
    await captureAndCompare(page, "accounting-periods");
  });

  test("payroll run", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/payroll-run");
    await captureAndCompare(page, "accounting-payroll");
  });

  test("employee tax / W-4", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/employee-tax");
    await captureAndCompare(page, "accounting-employee-tax");
  });

  test("vendor 1099", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/vendor-1099");
    await captureAndCompare(page, "accounting-vendor-1099");
  });

  test("budget", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/budget");
    await captureAndCompare(page, "accounting-budget");
  });

  test("fixed assets", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/fixed-assets");
    await captureAndCompare(page, "accounting-fixed-assets");
  });

  test("estimates", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/estimates");
    await captureAndCompare(page, "accounting-estimates");
  });

  test("expense rules & credit cards", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/expense-rules");
    await captureAndCompare(page, "accounting-expense-rules");
  });

  test("audit trail", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/audit-trail");
    await captureAndCompare(page, "accounting-audit-trail");
  });

  test("payment reminders", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/payment-reminders");
    await captureAndCompare(page, "accounting-payment-reminders");
  });

  test("sales tax", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/sales-tax");
    await captureAndCompare(page, "accounting-sales-tax");
  });

  test("receipt OCR", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/receipt-ocr");
    await captureAndCompare(page, "accounting-receipt-ocr");
  });

  test("tax reports", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/tax-reports");
    await captureAndCompare(page, "accounting-tax-reports");
  });

  test("financial reports", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/reports");
    await captureAndCompare(page, "accounting-reports");
  });

  test("accounting docs", async ({ page }) => {
    await gotoOrSkip(page, "/accounting/docs");
    await captureAndCompare(page, "accounting-docs");
  });
});

// =========================================================================
//  MANAGER / REPORTS / SYSTEM
// =========================================================================
test.describe("Manager & System", () => {
  test("command center", async ({ page }) => {
    await gotoOrSkip(page, "/manager");
    await captureAndCompare(page, "manager-dashboard");
  });

  test("reports", async ({ page }) => {
    await gotoOrSkip(page, "/reports");
    await captureAndCompare(page, "reports");
  });

  test("inventory", async ({ page }) => {
    await gotoOrSkip(page, "/inventory");
    await captureAndCompare(page, "inventory");
  });

  test("payroll overview", async ({ page }) => {
    await gotoOrSkip(page, "/payroll");
    await captureAndCompare(page, "payroll");
  });

  test("dev tools", async ({ page }) => {
    await gotoOrSkip(page, "/dev");
    await captureAndCompare(page, "dev-tools");
  });

  test("vision", async ({ page }) => {
    await gotoOrSkip(page, "/vision");
    await captureAndCompare(page, "vision");
  });
});

// =========================================================================
//  PUBLIC PAGES (no auth needed)
// =========================================================================
test.describe("Public", () => {
  test("tour / onboarding", async ({ page }) => {
    await page.goto("/tour", { waitUntil: "domcontentloaded" });
    await captureAndCompare(page, "tour");
  });

  test("sign-in page", async ({ page }) => {
    // Open incognito-like context to see sign-in without existing session
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000); // Clerk widget loads async
    await captureAndCompare(page, "sign-in", { fullPage: false });
  });
});
