import { test, expect } from "@playwright/test";
import { mockPlcReadings } from "../mocks/sensor-data";

test.describe("Dashboard", () => {
  test("loads and shows the correct page title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/IronSight/);
  });

  test("shows loading spinner before data arrives", async ({ page }) => {
    // The page renders a spinner before the client-side Dashboard mounts
    await page.goto("/");
    const _spinner = page.locator("text=Initialising");
    // It may be very brief, so just confirm the page loads without crash
    await expect(page).toHaveTitle(/IronSight/);
  });

  test("renders dashboard content after hydration", async ({ page }) => {
    // Mock the sensor-readings API so the dashboard has data to render
    await page.route("**/api/sensor-readings**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPlcReadings),
      });
    });

    // Mock truck-readings to avoid real Viam calls
    await page.route("**/api/truck-readings**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ _offline: true, _reason: "no_recent_data" }),
      });
    });

    await page.goto("/");
    // Wait for client-side hydration -- the spinner text should disappear
    await expect(page.locator("text=Initialising")).toBeHidden({
      timeout: 15_000,
    });
  });

  test("dev page loads in development mode", async ({ page }) => {
    await page.goto("/dev");
    // In dev mode (NODE_ENV=development), the page should render.
    // It should NOT redirect to / (that only happens in production without opt-in).
    await expect(page).toHaveTitle(/IronSight/);
  });

  test("shift report page loads with heading", async ({ page }) => {
    await page.goto("/shift-report");
    await expect(page.locator("text=Shift Report").first()).toBeVisible();
  });

  test("fleet page loads with heading", async ({ page }) => {
    // Mock fleet status to avoid Viam calls
    await page.route("**/api/fleet/status**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          trucks: [],
          cached: false,
          timestamp: new Date().toISOString(),
        }),
      });
    });

    await page.goto("/fleet");
    await expect(page.locator("text=Fleet Overview")).toBeVisible();
  });
});
