#!/bin/bash
# IronSight Fleet Auto-Sync
# Pulls latest code from GitHub and restarts services if code changed.
# Runs on cron every 10 minutes on the Pi 5.

set -euo pipefail

REPO_DIR="/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC"
SERVICE_NAME="viam-server"
HOSTNAME=$(hostname)
LOG="/var/log/ironsight-fleet-sync.log"

cd "$REPO_DIR"

# Get current commit
OLD_COMMIT=$(git rev-parse HEAD)

# Pull latest
git fetch origin main --quiet 2>/dev/null
BEHIND=$(git rev-list HEAD..origin/main --count 2>/dev/null || echo "0")

if [ "$BEHIND" -eq 0 ]; then
    # Already up to date
    exit 0
fi

# Pull changes
git pull origin main --quiet 2>> "$LOG"
NEW_COMMIT=$(git rev-parse HEAD)

echo "$(date -Iseconds) [$HOSTNAME] Synced $OLD_COMMIT -> $NEW_COMMIT ($BEHIND commits)" >> "$LOG"

# Check if any module changed (all three run on Pi 5 now)
PLC_CHANGED=$(git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" -- "modules/plc-sensor" | wc -l)
CELL_CHANGED=$(git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" -- "modules/cell-sensor" | wc -l)
J1939_CHANGED=$(git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" -- "modules/j1939-sensor" | wc -l)
DASHBOARD_CHANGED=$(git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" -- "dashboard/" | wc -l)

MODULE_CHANGED=$((PLC_CHANGED + CELL_CHANGED + J1939_CHANGED))

if [ "$MODULE_CHANGED" -gt 0 ]; then
    echo "$(date -Iseconds) [$HOSTNAME] Module(s) changed (plc=$PLC_CHANGED cell=$CELL_CHANGED j1939=$J1939_CHANGED), restarting $SERVICE_NAME" >> "$LOG"
    sudo systemctl restart "$SERVICE_NAME" 2>> "$LOG"

    # Reinstall j1939-sensor deps if its requirements changed
    if [ "$J1939_CHANGED" -gt 0 ]; then
        J1939_DIR="$REPO_DIR/modules/j1939-sensor"
        if [ -f "$J1939_DIR/setup.sh" ]; then
            cd "$J1939_DIR"
            rm -f .install_complete
            ./setup.sh >> "$LOG" 2>&1
            cd "$REPO_DIR"
        fi
    fi

    echo "$(date -Iseconds) [$HOSTNAME] Service restarted" >> "$LOG"
fi

if [ "$DASHBOARD_CHANGED" -gt 0 ]; then
    echo "$(date -Iseconds) [$HOSTNAME] Dashboard changed — Vercel auto-deploys from git push" >> "$LOG"
fi
