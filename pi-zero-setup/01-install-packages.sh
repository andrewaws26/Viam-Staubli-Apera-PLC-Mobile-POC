#!/usr/bin/env bash
# Step 1: Update apt and install git, python3-pip, python3-venv on Pi Zero W
set -euo pipefail

PI="${RAIV_PLC_SSH:-andrew@raiv-plc.local}"

echo "=== Step 1: Updating apt and installing packages on Pi Zero W ==="
ssh "$PI" 'sudo apt update && sudo apt install -y git python3-pip python3-venv'

echo ""
echo "=== Verifying installations ==="
ssh "$PI" 'git --version && python3 --version && python3 -m venv --help > /dev/null && echo "All packages installed successfully"'
