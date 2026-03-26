#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
source .env
./setup.sh

# Use exec so SIGTERM from viam-server reaches Python directly
exec $PYTHON -m src.main "$@"
