#!/usr/bin/env bash
# ============================================================================
# run-all-tests.sh — Single command to validate the entire IronSight codebase.
#
# Runs in order:
#   1. Python linting (ruff)
#   2. TypeScript linting (ESLint)
#   3. PLC sensor unit tests (pytest + coverage)
#   4. J1939 sensor unit tests (pytest + coverage)
#   5. Common module tests (pytest)
#   6. Dashboard unit tests (vitest + coverage)
#   7. Dashboard build check (next build)
#
# Usage:
#   ./scripts/run-all-tests.sh          # Run everything
#   ./scripts/run-all-tests.sh --quick  # Skip build and coverage (fast CI check)
#   ./scripts/run-all-tests.sh --lint   # Only run linters
#
# Exit codes:
#   0 = all checks passed
#   1 = one or more checks failed (scroll up for details)
#
# HOW TO ADD NEW CHECKS:
#   1. Add a run_step call in the appropriate section below
#   2. Use run_step "Label" command arg1 arg2 ...
#   3. The script will track pass/fail and continue to the next step
# ============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DASHBOARD_DIR="$REPO_ROOT/dashboard"

# ── Parse flags ──────────────────────────────────────────────────────
QUICK=false
LINT_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=true ;;
    --lint)  LINT_ONLY=true ;;
  esac
done

# ── Colors (if terminal supports them) ────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  NC='\033[0m'
else
  GREEN='' RED='' YELLOW='' BLUE='' NC=''
fi

# ── Step runner ──────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
FAILED_STEPS=()

run_step() {
  local label="$1"
  shift
  echo ""
  echo -e "${BLUE}━━━ $label ━━━${NC}"
  if "$@"; then
    echo -e "${GREEN}  PASS${NC} $label"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "${RED}  FAIL${NC} $label"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_STEPS+=("$label")
  fi
}

skip_step() {
  local label="$1"
  echo -e "${YELLOW}  SKIP${NC} $label"
  SKIP_COUNT=$((SKIP_COUNT + 1))
}

# ============================================================================
# 1. LINTING
# ============================================================================

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   IronSight — Full Test Suite        ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"

run_step "Python lint (ruff)" \
  ruff check "$REPO_ROOT/modules/"

run_step "TypeScript lint (ESLint)" \
  bash -c "cd '$DASHBOARD_DIR' && npx eslint . --max-warnings 0"

if $LINT_ONLY; then
  echo ""
  echo -e "${BLUE}━━━ Lint-only mode — skipping tests ━━━${NC}"
  if [ $FAIL_COUNT -gt 0 ]; then
    echo -e "${RED}$FAIL_COUNT lint check(s) failed: ${FAILED_STEPS[*]}${NC}"
    exit 1
  fi
  echo -e "${GREEN}All lint checks passed.${NC}"
  exit 0
fi

# ============================================================================
# 2. PYTHON TESTS
# ============================================================================

if $QUICK; then
  run_step "PLC sensor tests (pytest)" \
    python3 -m pytest "$REPO_ROOT/modules/plc-sensor/tests/" -v --tb=short

  run_step "J1939 sensor tests (pytest)" \
    python3 -m pytest "$REPO_ROOT/modules/j1939-sensor/tests/" -v --tb=short
else
  run_step "PLC sensor tests (pytest + coverage)" \
    python3 -m pytest "$REPO_ROOT/modules/plc-sensor/tests/" -v --tb=short \
      --cov=modules/plc-sensor/src --cov-report=term-missing

  run_step "J1939 sensor tests (pytest + coverage)" \
    python3 -m pytest "$REPO_ROOT/modules/j1939-sensor/tests/" -v --tb=short \
      --cov=modules/j1939-sensor/src --cov-report=term-missing
fi

# Common module tests (small suite, no coverage needed)
if [ -d "$REPO_ROOT/modules/common/tests" ]; then
  run_step "Common module tests (pytest)" \
    python3 -m pytest "$REPO_ROOT/modules/common/tests/" -v --tb=short
fi

# ============================================================================
# 3. DASHBOARD TESTS
# ============================================================================

if $QUICK; then
  run_step "Dashboard unit tests (vitest)" \
    bash -c "cd '$DASHBOARD_DIR' && npx vitest run"
else
  run_step "Dashboard unit tests (vitest + coverage)" \
    bash -c "cd '$DASHBOARD_DIR' && npx vitest run --coverage"
fi

# ============================================================================
# 4. BUILD CHECK (skipped in --quick mode)
# ============================================================================

if $QUICK; then
  skip_step "Dashboard build (next build) — skipped in quick mode"
else
  run_step "Dashboard build (next build)" \
    bash -c "cd '$DASHBOARD_DIR' && npx next build"
fi

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Results                            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo -e "  ${GREEN}Passed:${NC}  $PASS_COUNT"
echo -e "  ${RED}Failed:${NC}  $FAIL_COUNT"
echo -e "  ${YELLOW}Skipped:${NC} $SKIP_COUNT"

if [ $FAIL_COUNT -gt 0 ]; then
  echo ""
  echo -e "${RED}Failed steps:${NC}"
  for step in "${FAILED_STEPS[@]}"; do
    echo -e "  ${RED}✗${NC} $step"
  done
  exit 1
fi

echo ""
echo -e "${GREEN}All checks passed.${NC}"
exit 0
