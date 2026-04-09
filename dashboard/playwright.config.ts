import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    // Auth setup — runs first, saves session for other projects
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
    },

    // Desktop Chrome — main test target
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/.auth/user.json",
      },
      dependencies: ["auth-setup"],
      testIgnore: /auth\.setup\.ts/,
    },

    // Mobile Safari — responsive testing
    {
      name: "mobile",
      use: {
        ...devices["iPhone 14"],
        storageState: "tests/.auth/user.json",
      },
      dependencies: ["auth-setup"],
      testMatch: /visual-regression\.spec\.ts/,
    },
  ],

  webServer: {
    command: "npm run dev",
    port: 3000,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
});
