#!/bin/bash
# IronSight Fleet Auto-Sync
# Pulls latest code from GitHub and restarts services if code changed.
# Runs on cron every 10 minutes on each Pi.

set -euo pipefail

REPO_DIR=""
MODULE_DIR=""
SERVICE_NAME="viam-server"
HOSTNAME=$(hostname)
LOG="/var/log/ironsight-fleet-sync.log"

# Detect which Pi we're on
if [ "$HOSTNAME" = "viam-pi" ]; then
    REPO_DIR="/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC"
    MODULE_DIR="modules/plc-sensor"
elif [ "$HOSTNAME" = "truck-diagnostics" ]; then
    REPO_DIR="/home/andrew/repo"
    MODULE_DIR="modules/j1939-sensor"
else
    echo "$(date -Iseconds) Unknown host: $HOSTNAME" >> "$LOG"
    exit 1
fi

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

# Check if our module or dashboard changed
MODULE_CHANGED=$(git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" -- "$MODULE_DIR" | wc -l)
DASHBOARD_CHANGED=$(git diff --name-only "$OLD_COMMIT" "$NEW_COMMIT" -- "dashboard/" | wc -l)

if [ "$MODULE_CHANGED" -gt 0 ]; then
    echo "$(date -Iseconds) [$HOSTNAME] Module changed, restarting $SERVICE_NAME" >> "$LOG"
    sudo systemctl restart "$SERVICE_NAME" 2>> "$LOG"

    # If on Pi Zero, reinstall deps in case requirements changed
    if [ "$HOSTNAME" = "truck-diagnostics" ]; then
        cd "$REPO_DIR/$MODULE_DIR"
        if [ -f setup.sh ]; then
            rm -f .install_complete
            ./setup.sh >> "$LOG" 2>&1
            sudo .venv/bin/pip install typing_extensions python-can wrapt packaging --quiet 2>> "$LOG"
        fi
    fi

    echo "$(date -Iseconds) [$HOSTNAME] Service restarted" >> "$LOG"
fi

if [ "$DASHBOARD_CHANGED" -gt 0 ] && [ "$HOSTNAME" = "viam-pi" ]; then
    echo "$(date -Iseconds) [$HOSTNAME] Dashboard changed — Vercel auto-deploys from git push" >> "$LOG"
fi
