#!/bin/bash
# Viam module entry point — manages virtualenv and launches the cell sensor.
# Plug-and-play: creates venv on first run, installs deps, validates, launches.
set -euo pipefail

MODULE_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="${MODULE_DIR}/.venv"
REQ_FILE="${MODULE_DIR}/requirements.txt"
STAMP_FILE="${VENV_DIR}/.deps-installed"
ENTRY="${MODULE_DIR}/src/cell_sensor.py"

log() { echo "[cell-sensor] $(date '+%H:%M:%S') $*"; }

# ── Validate Python version (viam-sdk requires 3.10+) ──
PYTHON="python3"
PY_VERSION=$("${PYTHON}" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)
if [ -z "${PY_VERSION}" ]; then
    log "ERROR: python3 not found."
    exit 1
fi
PY_MAJOR=$(echo "${PY_VERSION}" | cut -d. -f1)
PY_MINOR=$(echo "${PY_VERSION}" | cut -d. -f2)
if [ "${PY_MAJOR}" -lt 3 ] || { [ "${PY_MAJOR}" -eq 3 ] && [ "${PY_MINOR}" -lt 10 ]; }; then
    log "ERROR: Python ${PY_VERSION} found but 3.10+ is required."
    exit 1
fi
log "Python ${PY_VERSION} OK"

# ── Create virtualenv on first run ──
if [ ! -d "${VENV_DIR}" ]; then
    log "Creating virtualenv at ${VENV_DIR}..."
    "${PYTHON}" -m venv "${VENV_DIR}" || { log "ERROR: Failed to create virtualenv."; exit 1; }
fi

# ── Install/update dependencies (only if requirements.txt changed) ──
if [ ! -f "${STAMP_FILE}" ] || [ "${REQ_FILE}" -nt "${STAMP_FILE}" ]; then
    log "Installing dependencies from ${REQ_FILE}..."
    "${VENV_DIR}/bin/pip" install --upgrade pip --quiet 2>&1 | tail -1 || true
    if ! "${VENV_DIR}/bin/pip" install -r "${REQ_FILE}" --quiet 2>&1; then
        log "ERROR: pip install failed."
        exit 1
    fi
    touch "${STAMP_FILE}"
    log "Dependencies installed OK"
else
    log "Dependencies up to date (skipping install)"
fi

# ── Validate entry point exists ──
if [ ! -f "${ENTRY}" ]; then
    log "ERROR: Entry point not found at ${ENTRY}."
    exit 1
fi

# ── Launch the module ──
log "Starting cell_sensor module..."
exec "${VENV_DIR}/bin/python3" "${ENTRY}" "$@"
