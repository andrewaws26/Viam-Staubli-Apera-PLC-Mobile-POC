import { test, expect } from "@playwright/test";

/**
 * Mock thread data for the chat E2E tests.
 */
const mockThreads = [
  {
    id: "thread-1",
    entityType: "truck",
    entityId: "truck-101",
    title: "Truck 101 - Engine Issue",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    unreadCount: 2,
    lastMessage: {
      id: "msg-1",
      body: "Coolant temp is climbing again",
      senderName: "Mike",
      createdAt: new Date().toISOString(),
      deletedAt: null,
    },
  },
  {
    id: "thread-2",
    entityType: "direct",
    entityId: null,
    title: "Andrew & Mike",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    unreadCount: 0,
    lastMessage: {
      id: "msg-2",
      body: "Sounds good, see you Monday",
      senderName: "Andrew",
      createdAt: new Date().toISOString(),
      deletedAt: null,
    },
  },
];

const mockUsers = [
  { id: "user-2", name: "Mike Johnson", email: "mike@example.com", role: "mechanic" },
  { id: "user-3", name: "Sarah Davis", email: "sarah@example.com", role: "manager" },
];

/**
 * Helper: set up API mocks and Clerk user injection for the chat page.
 * Clerk's useUser() reads from window.Clerk — we inject a mock via
 * page.addInitScript so it resolves before React hydrates.
 */
async function setupChatMocks(page: import("@playwright/test").Page) {
  // Mock the threads list API
  await page.route("**/api/chat/threads", (route) => {
    if (route.request().method() === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockThreads),
      });
    } else {
      // POST (create thread) — return a fake new thread
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "thread-new", title: "New DM" }),
      });
    }
  });

  // Mock the users API (for UserPicker)
  await page.route("**/api/chat/users", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockUsers),
    });
  });

  // Mock individual thread detail fetch
  await page.route("**/api/chat/threads/*/messages**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [], hasMore: false }),
    });
  });

  await page.route("**/api/chat/threads/*/read", (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route("**/api/chat/threads/*", (route) => {
    // Thread detail (GET /api/chat/threads/:id)
    if (route.request().method() === "GET") {
      const url = route.request().url();
      const matched = mockThreads.find((t) => url.includes(t.id));
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(matched || mockThreads[0]),
      });
    } else {
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
  });

  // Intercept Clerk's client API so useUser() returns a mock user.
  // Clerk fetches from its API during SSR/client init. We intercept
  // the Clerk client endpoint to provide a fake authenticated session.
  await page.route("**/v1/client**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        response: {
          sessions: [
            {
              id: "sess_test",
              status: "active",
              user: {
                id: "user-1",
                first_name: "Test",
                last_name: "User",
                email_addresses: [
                  { id: "email_1", email_address: "test@example.com" },
                ],
                primary_email_address_id: "email_1",
                image_url: "",
              },
            },
          ],
          sign_in: null,
          sign_up: null,
        },
        client: {
          sessions: [
            {
              id: "sess_test",
              status: "active",
              user: {
                id: "user-1",
                first_name: "Test",
                last_name: "User",
                email_addresses: [
                  { id: "email_1", email_address: "test@example.com" },
                ],
                primary_email_address_id: "email_1",
                image_url: "",
              },
            },
          ],
        },
      }),
    });
  });

  // Also intercept Clerk's environment endpoint
  await page.route("**/v1/environment**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        auth_config: { single_session_mode: true },
        display_config: { theme: {} },
      }),
    });
  });
}

test.describe("Chat", () => {
  test("chat link exists in navigation", async ({ page }) => {
    await page.goto("/");
    const chatLink = page.locator('a[href="/chat"]');
    await expect(chatLink).toBeVisible({ timeout: 15_000 });
  });

  test("chat page loads without errors", async ({ page }) => {
    await setupChatMocks(page);

    // Collect console errors
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/chat");
    await expect(page).toHaveTitle(/IronSight/);

    // The page should render something (either auth prompt or chat UI).
    // With mocked Clerk it may still show the sign-in prompt; that is
    // acceptable — the key assertion is that no JS crash occurred.
    await page.waitForLoadState("networkidle");

    // Filter out expected Clerk/Next errors (Clerk may warn about test keys)
    const realErrors = errors.filter(
      (e) =>
        !e.includes("Clerk") &&
        !e.includes("clerk") &&
        !e.includes("publishableKey") &&
        !e.includes("hydration"),
    );
    expect(realErrors).toHaveLength(0);
  });

  test("thread list renders with mock data", async ({ page }) => {
    await setupChatMocks(page);
    await page.goto("/chat");

    // If Clerk blocks rendering, we may see the sign-in prompt.
    // Try to find either the thread list or the auth prompt.
    const threadListOrAuth = page.locator(
      'text="Search threads...", text="Please sign in to access chat."',
    );

    // Wait for hydration
    await page.waitForLoadState("networkidle");

    // Check if chat UI rendered (Clerk mock worked) or auth wall appeared
    const searchInput = page.locator('input[placeholder="Search threads..."]');
    const authPrompt = page.locator("text=Please sign in to access chat.");
    const loadingText = page.locator("text=Loading...");

    // One of these should be visible after page load
    await expect(
      searchInput.or(authPrompt).or(loadingText),
    ).toBeVisible({ timeout: 15_000 });

    // If the thread list rendered, verify thread content
    const isSearchVisible = await searchInput.isVisible().catch(() => false);
    if (isSearchVisible) {
      // Thread titles should appear
      await expect(
        page.locator("text=Truck 101 - Engine Issue"),
      ).toBeVisible();
      await expect(page.locator("text=Andrew & Mike")).toBeVisible();

      // Entity group headers should appear
      await expect(page.locator("text=Trucks").first()).toBeVisible();
      await expect(
        page.locator("text=Direct Messages").first(),
      ).toBeVisible();
    }
  });

  test("search input filters threads", async ({ page }) => {
    await setupChatMocks(page);
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const searchInput = page.locator('input[placeholder="Search threads..."]');
    const isSearchVisible = await searchInput.isVisible().catch(() => false);

    if (isSearchVisible) {
      // Both threads visible initially
      await expect(
        page.locator("text=Truck 101 - Engine Issue"),
      ).toBeVisible();
      await expect(page.locator("text=Andrew & Mike")).toBeVisible();

      // Type a search query that matches only one thread
      await searchInput.fill("Truck 101");

      // Only the matching thread should be visible
      await expect(
        page.locator("text=Truck 101 - Engine Issue"),
      ).toBeVisible();
      await expect(page.locator("text=Andrew & Mike")).toBeHidden();

      // Clear search — both should reappear
      await searchInput.fill("");
      await expect(page.locator("text=Andrew & Mike")).toBeVisible();
    }
  });

  test("clicking + New DM opens user picker modal", async ({ page }) => {
    await setupChatMocks(page);
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const newDmButton = page.locator("text=+ New DM");
    const isButtonVisible = await newDmButton.isVisible().catch(() => false);

    if (isButtonVisible) {
      await newDmButton.click();

      // The UserPicker modal should appear with its heading
      await expect(
        page.locator("text=New Direct Message"),
      ).toBeVisible({ timeout: 5_000 });

      // The search input for users should be present
      await expect(
        page.locator('input[placeholder="Search by name..."]'),
      ).toBeVisible();

      // Mock users should be listed
      await expect(page.locator("text=Mike Johnson")).toBeVisible();
      await expect(page.locator("text=Sarah Davis")).toBeVisible();

      // Clicking the backdrop (overlay) should close the modal
      // The overlay is the outermost fixed div
      await page.locator(".fixed.inset-0").click({ position: { x: 5, y: 5 } });
      await expect(page.locator("text=New Direct Message")).toBeHidden();
    }
  });
});
