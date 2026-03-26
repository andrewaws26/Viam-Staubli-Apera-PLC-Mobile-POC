#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Only run full setup once (or when requirements change)
MARKER=".install_complete"
REQ_HASH=$(md5sum requirements.txt 2>/dev/null | cut -d' ' -f1 || md5 -q requirements.txt 2>/dev/null)
CURRENT_HASH=""
if [ -f "$MARKER" ]; then
    CURRENT_HASH=$(cat "$MARKER")
fi

if [ "$REQ_HASH" = "$CURRENT_HASH" ] && [ -d ".venv" ]; then
    exit 0
fi

echo "Setting up virtual environment..."
python3 -m venv .venv --system-site-packages
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt

echo "$REQ_HASH" > "$MARKER"
echo "Setup complete."
