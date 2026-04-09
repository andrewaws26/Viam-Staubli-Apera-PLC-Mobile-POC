/**
 * IronSight Design System reference and AI review criteria.
 *
 * This file defines what "good" looks like for the IronSight dashboard.
 * The AI reviewer uses this to evaluate screenshots against our design standards.
 */

export const DESIGN_SYSTEM = {
  colors: {
    background: "#030712", // gray-950
    card: "#1f2937", // gray-800
    cardElevated: "#374151", // gray-700
    border: "#374151", // gray-700
    primary: "#7c3aed", // violet-600
    primaryLight: "#8b5cf6", // violet-500
    text: "#f9fafb", // gray-50
    textSecondary: "#9ca3af", // gray-400
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
  },
  fonts: {
    body: "system-ui, sans-serif",
    mono: "monospace (for data values)",
  },
  spacing: "Tailwind scale (4px base unit)",
  borderRadius: "rounded-lg (8px) for cards, rounded-md (6px) for inputs",
  theme: "Dark mode only — no light mode",
};

export const REVIEW_CRITERIA = [
  {
    id: "layout",
    name: "Layout & Hierarchy",
    weight: 2,
    description:
      "Is information organized with clear visual hierarchy? Are sections properly grouped with appropriate whitespace? Does the page structure guide the eye from most important to least important?",
  },
  {
    id: "readability",
    name: "Readability",
    weight: 2,
    description:
      "Is all text readable with sufficient contrast against the dark background? Are font sizes appropriate — headings distinct from body, data values scannable? Are line lengths comfortable (not too wide on desktop)?",
  },
  {
    id: "consistency",
    name: "Design Consistency",
    weight: 1.5,
    description:
      "Does the page follow the IronSight design system — dark gray-950 background, gray-800 cards, violet-600 primary accents? Are components (buttons, inputs, tables, badges) styled consistently? Does spacing feel uniform?",
  },
  {
    id: "intuitiveness",
    name: "Intuitiveness",
    weight: 2,
    description:
      "Would a field mechanic or office manager understand what this page does within 3 seconds? Are interactive elements obviously clickable/tappable? Is the page's purpose immediately clear from the heading and layout? Are actions easy to find?",
  },
  {
    id: "data_presentation",
    name: "Data Presentation",
    weight: 1.5,
    description:
      "Is data displayed in a scannable, well-organized way? Are tables/lists properly aligned? Are numbers/dates formatted consistently? Are empty states helpful (not just blank)? Is information density appropriate — not too sparse, not overwhelming?",
  },
  {
    id: "completeness",
    name: "Visual Completeness",
    weight: 1,
    description:
      "Does the page appear fully rendered — no broken layouts, missing icons, cut-off text, or obvious placeholder content? Are loading states handled? Is the page free of visual glitches?",
  },
];

export function buildReviewPrompt(
  pagePath: string,
  viewport: string,
  section: string
): string {
  return `You are a senior UX designer and QA engineer reviewing a page from IronSight — a dark-themed enterprise fleet management and company operations dashboard used by mechanics, managers, and office staff at a railroad tie installation company.

## Design System Reference
- Background: ${DESIGN_SYSTEM.colors.background} (near-black)
- Cards: ${DESIGN_SYSTEM.colors.card} (dark gray)
- Primary accent: ${DESIGN_SYSTEM.colors.primary} (violet)
- Text: ${DESIGN_SYSTEM.colors.text} (near-white)
- Secondary text: ${DESIGN_SYSTEM.colors.textSecondary} (gray)
- Status colors: green (success/online), amber (warning), red (error/offline)
- Theme: Dark mode only

## Page Being Reviewed
- Path: ${pagePath}
- Section: ${section}
- Viewport: ${viewport}

## Evaluation Criteria
Rate each criterion 1-10 and provide 1-2 sentences of specific, actionable feedback.

${REVIEW_CRITERIA.map(
  (c) => `### ${c.name} (weight: ${c.weight}x)
${c.description}`
).join("\n\n")}

## Response Format
Respond with ONLY valid JSON — no markdown, no explanation:
{
  "page": "${pagePath}",
  "viewport": "${viewport}",
  "scores": {
    ${REVIEW_CRITERIA.map((c) => `"${c.id}": { "score": <1-10>, "feedback": "<specific feedback>" }`).join(",\n    ")}
  },
  "overall_score": <weighted average 1-10>,
  "critical_issues": ["<list any broken layouts, unreadable text, or blocking UX issues — empty array if none>"],
  "top_suggestion": "<single most impactful improvement for this page>"
}`;
}

export function calculateWeightedScore(
  scores: Record<string, { score: number }>
): number {
  let total = 0;
  let weightSum = 0;
  for (const criterion of REVIEW_CRITERIA) {
    const s = scores[criterion.id];
    if (s) {
      total += s.score * criterion.weight;
      weightSum += criterion.weight;
    }
  }
  return weightSum > 0 ? Math.round((total / weightSum) * 10) / 10 : 0;
}
