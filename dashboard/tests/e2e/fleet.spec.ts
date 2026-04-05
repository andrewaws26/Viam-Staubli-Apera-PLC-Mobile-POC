import { test, expect } from "@playwright/test";
import { mockFleetStatus, mockFleetStatusEmpty } from "../mocks/sensor-data";

test.describe("Fleet Overview", () => {
  test("shows truck cards when fleet has trucks", async ({ page }) => {
    await page.route("**/api/fleet/status**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockFleetStatus),
      });
    });

    await page.goto("/fleet");

    // Truck 1 should appear as a card
    await expect(page.locator("text=Truck 1")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Truck 2")).toBeVisible();
  });

  test("shows DTC badge on truck with active codes", async ({ page }) => {
    await page.route("**/api/fleet/status**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockFleetStatus),
      });
    });

    await page.goto("/fleet");

    // Truck 2 has 2 DTCs -- the card should show a DTC badge
    await expect(page.locator("text=/2 DTC/i").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("shows online/offline status for trucks", async ({ page }) => {
    await page.route("**/api/fleet/status**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockFleetStatus),
      });
    });

    await page.goto("/fleet");

    // Should show connection status indicators
    await expect(page.locator("text=Live").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("text=Offline").first()).toBeVisible();
  });

  test("shows summary bar with counts", async ({ page }) => {
    await page.route("**/api/fleet/status**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockFleetStatus),
      });
    });

    await page.goto("/fleet");

    // Summary bar shows "1 / 2 online"
    await expect(page.locator("text=/1.*\\/.*2.*online/")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("shows empty state when no trucks configured", async ({ page }) => {
    await page.route("**/api/fleet/status**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockFleetStatusEmpty),
      });
    });

    await page.goto("/fleet");

    // The fleet heading should still be visible
    await expect(page.locator("text=Fleet Overview")).toBeVisible({
      timeout: 10_000,
    });

    // With zero trucks, the summary should show 0 online
    await expect(page.locator("text=/0.*\\/.*0.*online/")).toBeVisible();
  });

  test("handles API error gracefully", async ({ page }) => {
    await page.route("**/api/fleet/status**", (route) => {
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" }),
      });
    });

    await page.goto("/fleet");

    // Should show an error message rather than crashing
    await expect(
      page.locator("text=/failed|error|unavailable/i").first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
