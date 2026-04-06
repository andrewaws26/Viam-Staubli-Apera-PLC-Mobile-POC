import { test, expect } from "@playwright/test";
import {
  mockTruckReadings,
  mockTruckReadingsIdle,
  mockPlcReadings,
} from "../mocks/sensor-data";

/**
 * Intercept both sensor and truck API routes so the Dashboard renders
 * with controlled data and no real Viam connection.
 */
function mockAllReadings(
  page: import("@playwright/test").Page,
  opts?: {
    plc?: Record<string, unknown>;
    truck?: Record<string, unknown>;
  },
) {
  const plcData = opts?.plc ?? mockPlcReadings;
  const truckData = opts?.truck ?? mockTruckReadings;

  return Promise.all([
    page.route("**/api/sensor-readings**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(plcData),
      });
    }),
    page.route("**/api/truck-readings**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(truckData),
      });
    }),
  ]);
}

test.describe("Truck Panel", () => {
  test("shows CHECK ENGINE badge when malfunction lamp is active", async ({
    page,
  }) => {
    await mockAllReadings(page, {
      truck: { ...mockTruckReadings, malfunction_lamp: 1 },
    });

    await page.goto("/");
    await expect(page.locator("text=Initialising")).toBeHidden({
      timeout: 15_000,
    });

    // The TruckPanel renders "CHECK ENGINE" when malfunction_lamp is truthy
    await expect(page.locator("text=CHECK ENGINE")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("does not show CHECK ENGINE badge when lamp is off", async ({
    page,
  }) => {
    await mockAllReadings(page, {
      truck: { ...mockTruckReadingsIdle, malfunction_lamp: 0 },
    });

    await page.goto("/");
    await expect(page.locator("text=Initialising")).toBeHidden({
      timeout: 15_000,
    });

    // Wait a moment for data to render, then confirm badge is absent
    await page.waitForTimeout(2_000);
    await expect(page.locator("text=CHECK ENGINE")).toBeHidden();
  });

  test("displays active DTC count", async ({ page }) => {
    await mockAllReadings(page, {
      truck: { ...mockTruckReadings, active_dtc_count: 3 },
    });

    await page.goto("/");
    await expect(page.locator("text=Initialising")).toBeHidden({
      timeout: 15_000,
    });

    // The panel should display the DTC count somewhere
    await expect(page.locator("text=/3.*DTC|DTC.*3/i").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Ask AI button is present on the page", async ({ page }) => {
    await mockAllReadings(page);

    await page.goto("/");
    await expect(page.locator("text=Initialising")).toBeHidden({
      timeout: 15_000,
    });

    // The AIChatPanel renders an "Ask AI" button
    await expect(page.locator("text=Ask AI").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("clicking Ask AI opens the chat panel", async ({ page }) => {
    await mockAllReadings(page);

    // Also mock the AI chat endpoint so it does not fail
    await page.route("**/api/ai-chat**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "Hello! How can I help?" }),
      });
    });

    await page.goto("/");
    await expect(page.locator("text=Initialising")).toBeHidden({
      timeout: 15_000,
    });

    const askButton = page.locator("text=Ask AI").first();
    await expect(askButton).toBeVisible({ timeout: 10_000 });
    await askButton.click();

    // After clicking, the button text changes to "Close Chat"
    await expect(page.locator("text=Close Chat")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("shows offline state when truck readings are unavailable", async ({
    page,
  }) => {
    await mockAllReadings(page, {
      truck: { _offline: true, _reason: "no_recent_data" },
    });

    await page.goto("/");
    await expect(page.locator("text=Initialising")).toBeHidden({
      timeout: 15_000,
    });

    // CHECK ENGINE should NOT appear for offline truck
    await page.waitForTimeout(2_000);
    await expect(page.locator("text=CHECK ENGINE")).toBeHidden();
  });
});
