import { test as setup, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const authFile = path.join(__dirname, "..", ".auth", "user.json");

// Auto-load credentials from .env.test if not already in environment
const envTestPath = path.join(__dirname, "..", "..", ".env.test");
if (fs.existsSync(envTestPath) && !process.env.E2E_CLERK_EMAIL) {
  const content = fs.readFileSync(envTestPath, "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^([\w]+)=(.+)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

/**
 * Authenticates with Clerk using a sign-in token (bypasses new-device email verification).
 *
 * Uses Clerk Backend API to create a sign-in token for the QA bot user,
 * then navigates to the token URL which auto-signs in without needing
 * email/password or device verification.
 *
 * Requires environment variables:
 *   CLERK_SECRET_KEY     — Clerk backend secret key
 *   E2E_CLERK_EMAIL      — test account email (used to find user ID)
 */
setup("authenticate with Clerk", async ({ page }) => {
  const clerkSecret = process.env.CLERK_SECRET_KEY;
  const email = process.env.E2E_CLERK_EMAIL;

  if (!clerkSecret || !email) {
    console.warn(
      "\n  CLERK_SECRET_KEY and E2E_CLERK_EMAIL not set.\n" +
        "   Visual QA will skip auth-gated pages.\n" +
        "   Set these in .env.test\n"
    );
    await page.goto("/sign-in");
    await page.context().storageState({ path: authFile });
    return;
  }

  // Step 1: Find the user ID by email via Clerk Backend API
  const userRes = await fetch(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${clerkSecret}` } }
  );
  const users = await userRes.json();
  if (!users.length) {
    throw new Error(`No Clerk user found for email: ${email}`);
  }
  const userId = users[0].id;
  console.log(`Found Clerk user: ${userId} (${email})`);

  // Step 2: Create a sign-in token (bypasses email verification / 2FA)
  const tokenRes = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clerkSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: userId }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.token) {
    throw new Error(
      `Failed to create sign-in token: ${JSON.stringify(tokenData)}`
    );
  }
  console.log("Created Clerk sign-in token");

  // Step 3: Use the Clerk Frontend API to accept the token via the app
  // Navigate to the app's sign-in page with the ticket parameter
  const ticketUrl = `http://localhost:3000/sign-in?__clerk_ticket=${tokenData.token}`;
  await page.goto(ticketUrl, { timeout: 30000 });

  // Wait for successful redirect away from sign-in
  await page.waitForURL(/^(?!.*sign-in)/, { timeout: 30000 });
  await expect(page).toHaveTitle(/IronSight/);

  // Save authenticated state
  await page.context().storageState({ path: authFile });
  console.log("Auth saved to", authFile);
});
