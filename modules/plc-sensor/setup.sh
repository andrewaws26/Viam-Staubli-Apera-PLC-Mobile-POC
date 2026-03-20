#!/bin/bash
# One-time setup for the plc-sensor module.
# Called by `viam module build` or manually during initial deployment.
set -euo pipefail

MODULE_DIR="$(cd "$(dirname "$0")" && pwd)"

log() { echo "[plc-sensor-setup] $*"; }

# Validate Python 3.10+
PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)
if [ -z "${PY_VERSION}" ]; then
    log "ERROR: python3 not found."
    exit 1
fi
PY_MAJOR=$(echo "${PY_VERSION}" | cut -d. -f1)
PY_MINOR=$(echo "${PY_VERSION}" | cut -d. -f2)
if [ "${PY_MAJOR}" -lt 3 ] || { [ "${PY_MAJOR}" -eq 3 ] && [ "${PY_MINOR}" -lt 10 ]; }; then
    log "ERROR: Python ${PY_VERSION} found, need 3.10+."
    exit 1
fi

log "Python ${PY_VERSION} OK — installing dependencies..."
pip3 install -r "${MODULE_DIR}/requirements.txt" || {
    log "ERROR: pip install failed."
    exit 1
}
log "Setup complete."
