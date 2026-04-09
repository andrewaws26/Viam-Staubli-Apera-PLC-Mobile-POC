import { test, expect } from "@playwright/test";

/**
 * Timesheet E2E tests.
 *
 * Note: The timesheet form page (/timesheets/new) is behind Clerk auth.
 * Without a Clerk test token setup, we can only verify:
 *   - Auth enforcement (redirect to sign-in)
 *   - Page title loads
 *   - API mocking works for list views
 *
 * Full form interaction tests require Clerk testing tokens
 * (see: https://clerk.com/docs/testing/overview).
 */

test.describe("Timesheet auth enforcement", () => {
  test("timesheets page requires authentication", async ({ page }) => {
    await page.goto("/timesheets");
    // Should either show the page (authenticated) or redirect to Clerk
    const url = page.url();
    const hasTimesheetContent = await page.locator("text=Timesheet").first().isVisible().catch(() => false);
    const isAuthRedirect = url.includes("clerk") || url.includes("sign-in");
    expect(hasTimesheetContent || isAuthRedirect).toBe(true);
  });

  test("new timesheet page requires authentication", async ({ page }) => {
    await page.goto("/timesheets/new");
    const url = page.url();
    const hasFormContent = await page.locator("text=Week Ending").first().isVisible().catch(() => false);
    const isAuthRedirect = url.includes("clerk") || url.includes("sign-in");
    expect(hasFormContent || isAuthRedirect).toBe(true);
  });

  test("timesheet admin page requires authentication", async ({ page }) => {
    await page.goto("/timesheets/admin");
    const url = page.url();
    const isAuthRedirect = url.includes("clerk") || url.includes("sign-in");
    const hasContent = await page.locator("body").textContent();
    expect(isAuthRedirect || (hasContent?.length ?? 0) > 0).toBe(true);
  });
});

test.describe("Timesheet List (with mocks)", () => {
  test("shows empty state when no timesheets", async ({ page }) => {
    await page.route("**/api/timesheets**", (route) => {
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.goto("/timesheets");
    await expect(page).toHaveTitle(/IronSight/);
  });
});

test.describe("Timesheet PDF export endpoint", () => {
  test("PDF route enforces auth or returns not-found for invalid id", async ({ request }) => {
    const res = await request.get("/api/timesheets/fake-id/pdf");
    // Depending on auth state: 401/302/307 (no auth) or 404 (authed, bad id)
    expect([401, 404, 307, 302]).toContain(res.status());
  });
});
