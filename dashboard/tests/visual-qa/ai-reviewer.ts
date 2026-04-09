/**
 * IronSight AI Visual Reviewer
 *
 * Sends page screenshots to Claude Vision for design quality evaluation.
 * Run after Playwright captures screenshots to visual-qa/captures/.
 *
 * Usage:
 *   npx tsx tests/visual-qa/ai-reviewer.ts
 *
 * Requires ANTHROPIC_API_KEY in environment or .env.local
 */

import * as fs from "fs";
import * as path from "path";
import { buildReviewPrompt, calculateWeightedScore } from "./design-criteria";

const CAPTURES_DIR = path.join(__dirname, "captures");
const REPORT_PATH = path.join(__dirname, "visual-qa-report.md");

interface PageReview {
  page: string;
  viewport: string;
  scores: Record<string, { score: number; feedback: string }>;
  overall_score: number;
  critical_issues: string[];
  top_suggestion: string;
}

// Map screenshot filenames to their section for context
function getSection(filename: string): string {
  if (filename.startsWith("fleet") || filename.startsWith("shift") || filename.startsWith("snapshot"))
    return "Fleet";
  if (filename.startsWith("work") || filename.startsWith("chat"))
    return "Operations";
  if (
    filename.startsWith("timesheet") ||
    filename.startsWith("pto") ||
    filename.startsWith("training") ||
    filename.startsWith("profile") ||
    filename.startsWith("team") ||
    filename.startsWith("admin-vehicle")
  )
    return "People";
  if (filename.startsWith("accounting") || filename.startsWith("payroll"))
    return "Finance";
  if (filename.startsWith("manager") || filename.startsWith("report") || filename.startsWith("inventory"))
    return "Manager & Reports";
  if (filename.startsWith("dev") || filename.startsWith("vision"))
    return "System";
  if (filename.startsWith("sign-in") || filename.startsWith("tour"))
    return "Public";
  return "Home";
}

function getPagePath(filename: string): string {
  // Convert filename back to approximate route path
  const name = filename.replace(".png", "");
  const mapping: Record<string, string> = {
    home: "/",
    "fleet-overview": "/fleet",
    "shift-report": "/shift-report",
    snapshots: "/snapshots",
    "fleet-docs": "/fleet/docs",
    "fleet-ai-docs": "/fleet/ai-docs",
    "work-board": "/work",
    "work-docs": "/work/docs",
    chat: "/chat",
    timesheets: "/timesheets",
    "timesheet-new": "/timesheets/new",
    "timesheet-admin": "/timesheets/admin",
    "timesheet-docs": "/timesheets/docs",
    pto: "/pto",
    "pto-new": "/pto/new",
    "pto-admin": "/pto/admin",
    training: "/training",
    "training-admin": "/training/admin",
    profile: "/profile",
    team: "/team",
    "admin-vehicles": "/admin/vehicles",
    "accounting-home": "/accounting",
    "accounting-new-entry": "/accounting/new",
    "accounting-invoices": "/accounting/invoices",
    "accounting-bills": "/accounting/bills",
    "accounting-customers": "/accounting/customers",
    "accounting-bank": "/accounting/bank",
    "accounting-recurring": "/accounting/recurring",
    "accounting-periods": "/accounting/periods",
    "accounting-payroll": "/accounting/payroll-run",
    "accounting-employee-tax": "/accounting/employee-tax",
    "accounting-vendor-1099": "/accounting/vendor-1099",
    "accounting-budget": "/accounting/budget",
    "accounting-fixed-assets": "/accounting/fixed-assets",
    "accounting-estimates": "/accounting/estimates",
    "accounting-expense-rules": "/accounting/expense-rules",
    "accounting-audit-trail": "/accounting/audit-trail",
    "accounting-payment-reminders": "/accounting/payment-reminders",
    "accounting-sales-tax": "/accounting/sales-tax",
    "accounting-receipt-ocr": "/accounting/receipt-ocr",
    "accounting-tax-reports": "/accounting/tax-reports",
    "accounting-reports": "/accounting/reports",
    "accounting-docs": "/accounting/docs",
    "manager-dashboard": "/manager",
    reports: "/reports",
    inventory: "/inventory",
    payroll: "/payroll",
    "dev-tools": "/dev",
    vision: "/vision",
    tour: "/tour",
    "sign-in": "/sign-in",
  };
  return mapping[name] ?? `/${name}`;
}

function getViewport(filename: string): string {
  if (filename.includes("-mobile")) return "mobile (375x812)";
  if (filename.includes("-tablet")) return "tablet (768x1024)";
  return "desktop (1280x720)";
}

async function callClaude(
  imageBase64: string,
  prompt: string
): Promise<PageReview | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("❌ ANTHROPIC_API_KEY not set");
    return null;
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`❌ Claude API error: ${response.status} ${err}`);
    return null;
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = data.content.find((c) => c.type === "text")?.text;
  if (!text) return null;

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as PageReview;
  } catch (e) {
    console.error("❌ Failed to parse Claude response:", text.slice(0, 200));
    return null;
  }
}

function generateReport(reviews: PageReview[]): string {
  const now = new Date().toISOString();
  const avgScore =
    reviews.length > 0
      ? Math.round(
          (reviews.reduce((s, r) => s + r.overall_score, 0) / reviews.length) *
            10
        ) / 10
      : 0;

  const allCritical = reviews.flatMap((r) =>
    r.critical_issues.map((issue) => `- **${r.page}**: ${issue}`)
  );

  // Group by section
  const sections = new Map<string, PageReview[]>();
  for (const r of reviews) {
    const sec = getSection(
      Object.entries(getPagePathReverse()).find(
        ([, v]) => v === r.page
      )?.[0] ?? ""
    );
    if (!sections.has(sec)) sections.set(sec, []);
    sections.get(sec)!.push(r);
  }

  let md = `# IronSight Visual QA — AI Design Review

**Date:** ${now}
**Pages reviewed:** ${reviews.length}
**Average design score:** ${avgScore}/10
**Health:** ${avgScore >= 8 ? "GREEN" : avgScore >= 6 ? "YELLOW" : "RED"}

---

`;

  if (allCritical.length > 0) {
    md += `## Critical Issues\n\n${allCritical.join("\n")}\n\n---\n\n`;
  }

  md += `## Scores by Page\n\n`;
  md += `| Page | Score | Layout | Read | Consist | Intuitive | Data | Complete | Top Suggestion |\n`;
  md += `|------|-------|--------|------|---------|-----------|------|----------|----------------|\n`;

  const sorted = [...reviews].sort((a, b) => a.overall_score - b.overall_score);
  for (const r of sorted) {
    const s = r.scores;
    md += `| ${r.page} | **${r.overall_score}** | ${s.layout?.score ?? "-"} | ${s.readability?.score ?? "-"} | ${s.consistency?.score ?? "-"} | ${s.intuitiveness?.score ?? "-"} | ${s.data_presentation?.score ?? "-"} | ${s.completeness?.score ?? "-"} | ${truncate(r.top_suggestion, 60)} |\n`;
  }

  md += `\n---\n\n## Detailed Feedback\n\n`;

  for (const r of sorted) {
    md += `### ${r.page} — ${r.overall_score}/10\n\n`;
    for (const [key, val] of Object.entries(r.scores)) {
      md += `- **${key}** (${val.score}/10): ${val.feedback}\n`;
    }
    if (r.critical_issues.length > 0) {
      md += `- **CRITICAL:** ${r.critical_issues.join("; ")}\n`;
    }
    md += `- **Top suggestion:** ${r.top_suggestion}\n\n`;
  }

  md += `---\n\n## Improvement Priorities\n\n`;

  // Find pages with lowest scores per criterion
  const criteriaWorst: Record<string, { page: string; score: number }[]> = {};
  for (const r of reviews) {
    for (const [key, val] of Object.entries(r.scores)) {
      if (!criteriaWorst[key]) criteriaWorst[key] = [];
      criteriaWorst[key].push({ page: r.page, score: val.score });
    }
  }

  for (const [criterion, pages] of Object.entries(criteriaWorst)) {
    const worst = pages.sort((a, b) => a.score - b.score).slice(0, 3);
    if (worst[0]?.score <= 6) {
      md += `**${criterion}** — weakest pages: ${worst.map((w) => `${w.page} (${w.score})`).join(", ")}\n\n`;
    }
  }

  md += `\n---\n*Generated by IronSight AI Visual QA — Claude Vision*\n`;
  return md;
}

function getPagePathReverse(): Record<string, string> {
  // Just return empty — we'll use the review's own page field
  return {};
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

// =========================================================================
//  MAIN
// =========================================================================

async function main() {
  console.log("🔍 IronSight AI Visual Reviewer\n");

  if (!process.env.ANTHROPIC_API_KEY) {
    // Try loading from .env.local
    const envPath = path.join(__dirname, "..", "..", ".env.local");
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf-8");
      const match = envContent.match(/^ANTHROPIC_API_KEY=(.+)$/m);
      if (match && match[1]) {
        process.env.ANTHROPIC_API_KEY = match[1].trim();
      }
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY not found in environment or .env.local");
    process.exit(1);
  }

  if (!fs.existsSync(CAPTURES_DIR)) {
    console.error(
      "❌ No captures found. Run visual regression tests first:\n" +
        "   npx playwright test tests/e2e/visual-regression.spec.ts --update-snapshots"
    );
    process.exit(1);
  }

  const screenshots = fs
    .readdirSync(CAPTURES_DIR)
    .filter((f) => f.endsWith(".png"))
    .sort();

  if (screenshots.length === 0) {
    console.error("❌ No screenshots in captures directory");
    process.exit(1);
  }

  console.log(`📸 Found ${screenshots.length} screenshots to review\n`);

  const reviews: PageReview[] = [];
  let reviewed = 0;

  for (const filename of screenshots) {
    const pagePath = getPagePath(filename);
    const viewport = getViewport(filename);
    const section = getSection(filename);

    console.log(
      `  [${++reviewed}/${screenshots.length}] Reviewing ${pagePath} (${viewport})...`
    );

    const imagePath = path.join(CAPTURES_DIR, filename);
    const imageBase64 = fs.readFileSync(imagePath).toString("base64");
    const prompt = buildReviewPrompt(pagePath, viewport, section);

    const review = await callClaude(imageBase64, prompt);
    if (review) {
      // Recalculate weighted score to ensure consistency
      review.overall_score = calculateWeightedScore(review.scores);
      reviews.push(review);
      const emoji =
        review.overall_score >= 8
          ? "✅"
          : review.overall_score >= 6
            ? "⚠️"
            : "❌";
      console.log(`       ${emoji} ${review.overall_score}/10`);
      if (review.critical_issues.length > 0) {
        console.log(
          `       🚨 ${review.critical_issues.length} critical issue(s)`
        );
      }
    } else {
      console.log("       ⏭️  Skipped (API error)");
    }

    // Rate limit: ~1 request per second
    await new Promise((r) => setTimeout(r, 1200));
  }

  console.log(`\n📝 Writing report...`);
  const report = generateReport(reviews);
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`✅ Report saved to ${REPORT_PATH}`);

  // Summary
  const avg =
    reviews.length > 0
      ? Math.round(
          (reviews.reduce((s, r) => s + r.overall_score, 0) / reviews.length) *
            10
        ) / 10
      : 0;
  const critCount = reviews.reduce(
    (s, r) => s + r.critical_issues.length,
    0
  );
  console.log(
    `\n📊 ${reviews.length} pages reviewed — avg score: ${avg}/10 — ${critCount} critical issues`
  );
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
