#!/bin/bash
# Run all tests across the project
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Python Tests: plc-sensor ==="
python3 -m pytest "$REPO_ROOT/modules/plc-sensor/tests/" -v --tb=short
echo ""

echo "=== Python Tests: j1939-sensor ==="
python3 -m pytest "$REPO_ROOT/modules/j1939-sensor/tests/" -v --tb=short
echo ""

echo "=== Dashboard Build ==="
cd "$REPO_ROOT/dashboard" && npx next build
echo ""

echo "All tests passed!"
