#!/bin/bash
# Setup script — run once after cloning to prepare the cell-sensor module.
set -euo pipefail
cd "$(dirname "$0")"
chmod +x run.sh
echo "[cell-sensor] Setup complete. Module ready for viam-server."
