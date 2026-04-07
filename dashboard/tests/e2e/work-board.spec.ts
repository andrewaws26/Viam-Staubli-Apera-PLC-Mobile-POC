import { test, expect, Page } from "@playwright/test";
import { mockWorkOrders, mockTeamMembers } from "../mocks/work-orders";

/**
 * Helper: set up API mocks for the work board page.
 * Intercepts work-orders, team-members, and Clerk auth endpoints.
 */
async function setupWorkBoardMocks(page: Page) {
  // Mock work orders API
  await page.route("**/api/work-orders**", (route, request) => {
    if (request.method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockWorkOrders),
      });
    }
    if (request.method() === "PATCH") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    }
    if (request.method() === "POST") {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: "wo-new", ...mockWorkOrders[0] }),
      });
    }
    return route.continue();
  });

  // Mock team members API
  await page.route("**/api/team-members**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockTeamMembers),
    });
  });

  // Mock AI suggest steps API
  await page.route("**/api/ai-suggest-steps**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        steps: [
          "Check coolant level in reservoir",
          "Inspect radiator hoses for cracks",
          "Pressure test cooling system",
        ],
      }),
    });
  });
}

test.describe("Work Board", () => {
  test.beforeEach(async ({ page }) => {
    await setupWorkBoardMocks(page);
  });

  test("loads and displays board columns", async ({ page }) => {
    await page.goto("/work");
    // All 4 status columns should be visible
    await expect(page.locator("text=Open").first()).toBeVisible();
    await expect(page.locator("text=In Progress").first()).toBeVisible();
    await expect(page.locator("text=Blocked").first()).toBeVisible();
    await expect(page.locator("text=Done").first()).toBeVisible();
  });

  test("renders work order cards with titles", async ({ page }) => {
    await page.goto("/work");
    await expect(page.locator("text=Check coolant leak on Truck 12")).toBeVisible();
    await expect(page.locator("text=Replace air filter - Truck 5")).toBeVisible();
    await expect(page.locator("text=DPF regen keeps aborting")).toBeVisible();
    await expect(page.locator("text=Oil change - Truck 8")).toBeVisible();
  });

  test("shows subtask progress on cards", async ({ page }) => {
    await page.goto("/work");
    // wo-001 has 1/3 tasks done
    await expect(page.locator("text=1/3 tasks").first()).toBeVisible();
  });

  test("shows blocker reason on blocked cards", async ({ page }) => {
    await page.goto("/work");
    await expect(page.locator("text=Waiting on 7th injector part")).toBeVisible();
  });

  test("shows urgent badge on urgent work orders", async ({ page }) => {
    await page.goto("/work");
    const urgentBadges = page.locator("text=URGENT");
    await expect(urgentBadges.first()).toBeVisible();
  });

  test("expands card on click to show details", async ({ page }) => {
    await page.goto("/work");
    const card = page.locator("text=Check coolant leak on Truck 12");
    await card.click();
    // Should show description after expanding
    await expect(page.locator("text=Noticed puddle under engine")).toBeVisible();
    // Should show subtask checklist
    await expect(page.locator("text=Inspect radiator hoses")).toBeVisible();
    await expect(page.locator("text=Check water pump seal")).toBeVisible();
  });

  test("shows quick action buttons in expanded card", async ({ page }) => {
    await page.goto("/work");
    // Click an open work order to expand
    await page.locator("text=Check coolant leak on Truck 12").click();
    // Should show "Start" button for open items
    await expect(page.locator("button:has-text('Start')").first()).toBeVisible();
  });

  test("shows assign button in expanded card", async ({ page }) => {
    await page.goto("/work");
    await page.locator("text=Check coolant leak on Truck 12").click();
    await expect(page.locator("button:has-text('Assign')").first()).toBeVisible();
  });

  test("view toggle switches between Board and My Work", async ({ page }) => {
    await page.goto("/work");

    // Board view is default
    const boardBtn = page.locator("button:has-text('Board')").first();
    const myWorkBtn = page.locator("button:has-text('My Work')").first();
    await expect(boardBtn).toBeVisible();
    await expect(myWorkBtn).toBeVisible();

    // Switch to My Work
    await myWorkBtn.click();
    // In My Work, done items are hidden
    await expect(page.locator("text=Oil change - Truck 8")).toBeHidden();
    // Assigned and unassigned items should be visible
    await expect(page.locator("text=Check coolant leak on Truck 12")).toBeVisible();
    await expect(page.locator("text=Replace air filter - Truck 5")).toBeVisible();
  });

  test("My Work view shows status badges on cards", async ({ page }) => {
    await page.goto("/work");
    await page.locator("button:has-text('My Work')").first().click();
    // Cards in My Work should show status badges
    await expect(page.locator("text=In Progress").first()).toBeVisible();
  });

  test("shows column count badges", async ({ page }) => {
    await page.goto("/work");
    // Each column should show a count badge
    // Open has 1 item
    const openCount = page.locator("span.text-xs:has-text('1')").first();
    await expect(openCount).toBeVisible();
  });

  test("header shows active count", async ({ page }) => {
    await page.goto("/work");
    // 3 active (non-done) work orders
    await expect(page.locator("text=3 active")).toBeVisible();
  });

  test("has Dashboard nav link", async ({ page }) => {
    await page.goto("/work");
    const dashLink = page.locator("a:has-text('Dashboard')");
    await expect(dashLink).toBeVisible();
    await expect(dashLink).toHaveAttribute("href", "/");
  });

  test("linked DTCs display in expanded card", async ({ page }) => {
    await page.goto("/work");
    await page.locator("text=DPF regen keeps aborting").click();
    await expect(page.locator("text=SPN 3251 / FMI 0")).toBeVisible();
  });

  test("drag hint text visible in board view", async ({ page }) => {
    await page.goto("/work");
    await expect(page.locator("text=drag cards to change status")).toBeVisible();
  });

  test("drag hint hidden in My Work view", async ({ page }) => {
    await page.goto("/work");
    await page.locator("button:has-text('My Work')").first().click();
    await expect(page.locator("text=drag cards to change status")).toBeHidden();
  });
});

test.describe("Create Work Order Modal", () => {
  test.beforeEach(async ({ page }) => {
    await setupWorkBoardMocks(page);
  });

  test("opens create modal when clicking New Work Order", async ({ page }) => {
    await page.goto("/work");
    await page.locator("button:has-text('+ New Work Order')").click();
    await expect(page.locator("text=New Work Order").first()).toBeVisible();
    await expect(page.locator("text=What needs to be done?")).toBeVisible();
  });

  test("create modal has all required fields", async ({ page }) => {
    await page.goto("/work");
    await page.locator("button:has-text('+ New Work Order')").click();

    // Title input
    await expect(page.locator("input[placeholder*='Check coolant']")).toBeVisible();
    // Description textarea
    await expect(page.locator("textarea[placeholder*='additional context']")).toBeVisible();
    // Priority buttons
    await expect(page.locator("button:has-text('Low')")).toBeVisible();
    await expect(page.locator("button:has-text('Normal')")).toBeVisible();
    await expect(page.locator("button:has-text('Urgent')")).toBeVisible();
    // Assign dropdown
    await expect(page.locator("select")).toBeVisible();
    // Suggest Steps button
    await expect(page.locator("button:has-text('Suggest Steps')")).toBeVisible();
  });

  test("create button is disabled without title", async ({ page }) => {
    await page.goto("/work");
    await page.locator("button:has-text('+ New Work Order')").click();
    const createBtn = page.locator("button:has-text('Create')");
    await expect(createBtn).toBeDisabled();
  });

  test("create button enables after entering title", async ({ page }) => {
    await page.goto("/work");
    await page.locator("button:has-text('+ New Work Order')").click();
    await page.locator("input[placeholder*='Check coolant']").fill("Test work order");
    const createBtn = page.locator("button:has-text('Create')");
    await expect(createBtn).toBeEnabled();
  });

  test("suggest steps button is disabled without title", async ({ page }) => {
    await page.goto("/work");
    await page.locator("button:has-text('+ New Work Order')").click();
    const suggestBtn = page.locator("button:has-text('Suggest Steps')");
    await expect(suggestBtn).toBeDisabled();
  });

  test("suggest steps populates step list", async ({ page }) => {
    await page.goto("/work");
    await page.locator("button:has-text('+ New Work Order')").click();
    await page.locator("input[placeholder*='Check coolant']").fill("Check coolant leak");

    await page.locator("button:has-text('Suggest Steps')").click();
    // Wait for steps to appear
    await expect(page.locator("text=Check coolant level in reservoir")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator("text=Inspect radiator hoses for cracks")).toBeVisible();
    await expect(page.locator("text=Pressure test cooling system")).toBeVisible();
  });

  test("assign dropdown shows team members", async ({ page }) => {
    await page.goto("/work");
    await page.locator("button:has-text('+ New Work Order')").click();

    const select = page.locator("select");
    // Should have Unassigned + 3 team members = 4 options
    const options = select.locator("option");
    await expect(options).toHaveCount(4);
    await expect(options.nth(0)).toHaveText("Unassigned");
    await expect(options.nth(1)).toContainText("Andrew Sieg");
    await expect(options.nth(2)).toContainText("Mike Johnson");
    await expect(options.nth(3)).toContainText("Corey Smith");
  });

  test("cancel button closes modal", async ({ page }) => {
    await page.goto("/work");
    await page.locator("button:has-text('+ New Work Order')").click();
    await expect(page.locator("h2:has-text('New Work Order')")).toBeVisible();
    await page.locator("button:has-text('Cancel')").click();
    await expect(page.locator("h2:has-text('New Work Order')")).toBeHidden();
  });

  test("priority selection toggles correctly", async ({ page }) => {
    await page.goto("/work");
    await page.locator("button:has-text('+ New Work Order')").click();
    // Default is Normal (purple)
    const urgentBtn = page.locator("button:has-text('Urgent')");
    await urgentBtn.click();
    // Urgent should now be active (red)
    await expect(urgentBtn).toHaveClass(/bg-red-600/);
  });
});
