#!/bin/bash
# IronSight Mobile — Overnight QA Runner
# Boots iOS simulator, builds the app, runs all Maestro flows, collects screenshots.
#
# Usage: ./mobile/scripts/run-maestro-qa.sh
# Prereqs: Xcode, Maestro, Java (OpenJDK)

set -euo pipefail

export PATH="/opt/homebrew/opt/openjdk/bin:$PATH:$HOME/.maestro/bin"
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/mobile"
SCREENSHOT_DIR="$MOBILE_DIR/tests/maestro-screenshots"
REPORT_PATH="$MOBILE_DIR/tests/maestro-qa-report.md"
SIMULATOR="iPhone 17 Pro"

echo "=== IronSight Mobile QA — $(date) ==="

# 1. Boot simulator
echo "[1/5] Booting simulator: $SIMULATOR"
xcrun simctl boot "$SIMULATOR" 2>/dev/null || echo "  (already booted)"
sleep 3

# 2. Build and install the app on the simulator
echo "[2/5] Building Expo app for simulator..."
cd "$MOBILE_DIR"
npx expo run:ios --simulator "$SIMULATOR" --no-bundler 2>&1 | tail -5 || {
  echo "ERROR: Expo build failed. Trying prebuild + xcodebuild..."
  npx expo prebuild --platform ios --clean 2>&1 | tail -3
  xcodebuild -workspace ios/*.xcworkspace -scheme ironsight-mobile \
    -configuration Debug -destination "platform=iOS Simulator,name=$SIMULATOR" \
    -derivedDataPath build/ build 2>&1 | tail -5
  xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/*.app
}

# 3. Clean screenshot dir
echo "[3/5] Preparing screenshot directory..."
rm -rf "$SCREENSHOT_DIR"
mkdir -p "$SCREENSHOT_DIR"

# 4. Run Maestro flows
echo "[4/5] Running Maestro test flows..."
MAESTRO_OUTPUT_DIR="$SCREENSHOT_DIR" maestro test "$MOBILE_DIR/.maestro/" \
  --format junit \
  --output "$MOBILE_DIR/tests/maestro-results.xml" \
  2>&1 | tee "$MOBILE_DIR/tests/maestro-output.log" || true

# Copy any screenshots maestro captured
find /tmp -name "*.png" -newer "$0" -maxdepth 2 2>/dev/null | head -20 | while read f; do
  cp "$f" "$SCREENSHOT_DIR/" 2>/dev/null || true
done

# 5. Also grab a raw simulator screenshot of whatever's on screen
echo "[5/5] Taking final simulator screenshot..."
xcrun simctl io booted screenshot "$SCREENSHOT_DIR/final-sim-state.png" 2>/dev/null || true

# Generate report
echo "=== Generating QA report ==="
FLOW_COUNT=$(ls "$MOBILE_DIR/.maestro/"*.yaml 2>/dev/null | wc -l | tr -d ' ')
SCREENSHOT_COUNT=$(ls "$SCREENSHOT_DIR/"*.png 2>/dev/null | wc -l | tr -d ' ')
LOG_TAIL=$(tail -30 "$MOBILE_DIR/tests/maestro-output.log" 2>/dev/null || echo "No log output")

cat > "$REPORT_PATH" << REPORT
# IronSight Mobile QA Report

**Date:** $(date '+%Y-%m-%d %H:%M:%S')
**Simulator:** $SIMULATOR
**Flows run:** $FLOW_COUNT
**Screenshots captured:** $SCREENSHOT_COUNT

## Maestro Output (last 30 lines)

\`\`\`
$LOG_TAIL
\`\`\`

## Screenshots

$(ls "$SCREENSHOT_DIR/"*.png 2>/dev/null | while read f; do echo "- $(basename "$f")"; done || echo "No screenshots captured")

## Next Steps

- Review screenshots in \`mobile/tests/maestro-screenshots/\`
- Check \`mobile/tests/maestro-results.xml\` for JUnit results
- Check \`mobile/tests/maestro-output.log\` for full output
REPORT

echo ""
echo "=== QA Complete ==="
echo "Report: $REPORT_PATH"
echo "Screenshots: $SCREENSHOT_DIR"
echo "Flows: $FLOW_COUNT | Screenshots: $SCREENSHOT_COUNT"
