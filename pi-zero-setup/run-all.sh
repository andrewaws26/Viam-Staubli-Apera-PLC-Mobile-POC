#!/usr/bin/env bash
# Master script: runs all steps in order
# Usage: bash pi-zero-setup/run-all.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=========================================="
echo "  Pi Zero W PLC Simulator Setup"
echo "  Target: ${RAIV_PLC_SSH:-andrew@raiv-plc.local}"
echo "=========================================="
echo ""

echo ">>> Running Step 1: Install packages..."
bash "$SCRIPT_DIR/01-install-packages.sh"
echo ""

echo ">>> Running Step 2-3: Clone repo & setup venv..."
bash "$SCRIPT_DIR/02-clone-and-setup.sh"
echo ""

echo ">>> Running Step 4-5: Configure, run, and verify..."
bash "$SCRIPT_DIR/03-configure-and-run.sh"
echo ""

echo ">>> Running Step 6: Test Modbus registers..."
bash "$SCRIPT_DIR/04-test-registers.sh"
echo ""

echo ">>> Running Step 7: Install systemd service for boot startup..."
bash "$SCRIPT_DIR/05-install-systemd.sh"
echo ""

echo "=========================================="
echo "  ALL STEPS COMPLETE"
echo "  PLC simulator starts on boot via systemd"
echo "=========================================="
