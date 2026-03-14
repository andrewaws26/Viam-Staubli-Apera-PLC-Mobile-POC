#!/bin/bash
# Viam module entry point — manages virtualenv and launches the sensor module.
set -e

MODULE_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="${MODULE_DIR}/.venv"

# Create virtualenv on first run
if [ ! -d "${VENV_DIR}" ]; then
    echo "Creating virtualenv at ${VENV_DIR}..."
    python3 -m venv "${VENV_DIR}"
    "${VENV_DIR}/bin/pip" install --upgrade pip
    "${VENV_DIR}/bin/pip" install -r "${MODULE_DIR}/requirements.txt"
fi

exec "${VENV_DIR}/bin/python3" "${MODULE_DIR}/src/vision_health_sensor.py" "$@"
