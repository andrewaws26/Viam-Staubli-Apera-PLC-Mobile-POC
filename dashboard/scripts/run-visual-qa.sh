#!/usr/bin/env bash
#
# IronSight Visual QA Runner
#
# Runs the full visual QA pipeline:
#   1. Playwright visual regression (screenshot every page, pixel-diff)
#   2. AI design review (Claude Vision evaluates each screenshot)
#   3. Combined report
#
# Usage:
#   bash scripts/run-visual-qa.sh                    # Full run (regression + AI review)
#   bash scripts/run-visual-qa.sh --update           # Update baselines then AI review
#   bash scripts/run-visual-qa.sh --ai-only          # Skip Playwright, just run AI on existing captures
#   bash scripts/run-visual-qa.sh --regression-only   # Just pixel-diff, no AI
#

set -euo pipefail
cd "$(dirname "$0")/.."

TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
MODE="${1:---full}"

echo "═══════════════════════════════════════════════════"
echo "  IronSight Visual QA — $TIMESTAMP"
echo "═══════════════════════════════════════════════════"
echo ""

# Load env vars from .env.local if .env.test doesn't exist
if [ -f .env.test ]; then
  set -a; source .env.test; set +a
elif [ -f .env.local ]; then
  set -a; source .env.local; set +a
fi

# ── Step 1: Playwright Visual Regression ───────────────────────────
if [ "$MODE" != "--ai-only" ]; then
  echo "📸 Step 1: Capturing screenshots & running visual regression..."
  echo ""

  if [ "$MODE" = "--update" ]; then
    echo "   (Updating baselines with --update-snapshots)"
    npx playwright test tests/e2e/visual-regression.spec.ts --update-snapshots --reporter=list 2>&1 || true
  else
    npx playwright test tests/e2e/visual-regression.spec.ts --reporter=list 2>&1 || true
  fi

  # Count captures
  CAPTURE_COUNT=$(ls -1 tests/visual-qa/captures/*.png 2>/dev/null | wc -l | tr -d ' ')
  echo ""
  echo "   📸 $CAPTURE_COUNT screenshots captured"
  echo ""
fi

# ── Step 2: AI Design Review ──────────────────────────────────────
if [ "$MODE" != "--regression-only" ]; then
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "⚠️  ANTHROPIC_API_KEY not set — skipping AI review"
    echo "   Set it in .env.local or .env.test to enable AI design evaluation"
  else
    echo "🤖 Step 2: AI design review (Claude Vision)..."
    echo ""
    npx tsx tests/visual-qa/ai-reviewer.ts 2>&1
    echo ""
  fi
fi

# ── Summary ──────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════"
echo "  Visual QA Complete"
echo "═══════════════════════════════════════════════════"
echo ""
echo "Reports:"

if [ -f tests/visual-qa/visual-qa-report.md ]; then
  echo "  📝 AI Review:    tests/visual-qa/visual-qa-report.md"
fi
if [ -d playwright-report ]; then
  echo "  📊 Playwright:   npx playwright show-report"
fi

echo ""
echo "Commands:"
echo "  Update baselines:  bash scripts/run-visual-qa.sh --update"
echo "  AI review only:    bash scripts/run-visual-qa.sh --ai-only"
echo "  Regression only:   bash scripts/run-visual-qa.sh --regression-only"
echo ""
