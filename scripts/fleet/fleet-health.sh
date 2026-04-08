#!/bin/bash
# IronSight Fleet Health Check
# Runs on the Pi 5 (single consolidated Pi per truck).
# Outputs JSON status for consumption by watchdog/Claude.

set -uo pipefail

LOG="/var/log/ironsight-fleet-health.log"
STATUS_FILE="/home/andrew/.ironsight/fleet-status.json"
REPO_DIR="/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC"

mkdir -p "$(dirname "$STATUS_FILE")"

# ---- Pi 5 checks (all modules run here) ----
PI5_GIT=$(cd "$REPO_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
PI5_VIAM=$(systemctl is-active viam-server 2>/dev/null || echo "dead")
PI5_DISK=$(df -h / | awk 'NR==2{print $5}' | tr -d '%')
PI5_UPTIME=$(uptime -p 2>/dev/null || uptime | awk '{print $3,$4}')
PI5_WIFI=$(nmcli -t -f NAME,DEVICE connection show --active 2>/dev/null | grep wlan0 | cut -d: -f1)
PI5_TAILSCALE=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('Self',{}).get('Online',False))" 2>/dev/null || echo "false")
PI5_SERVICES_DOWN=""
for svc in viam-server ironsight-server ironsight-discovery-daemon tailscaled can0; do
    if ! systemctl is-active --quiet "$svc" 2>/dev/null; then
        PI5_SERVICES_DOWN="$PI5_SERVICES_DOWN $svc"
    fi
done

# ---- CAN bus health (j1939-sensor now runs on Pi 5) ----
CAN_UP="false"
CAN_RX_FRAMES="0"
if ip link show can0 2>/dev/null | grep -q "UP"; then
    CAN_UP="true"
    CAN_RX_FRAMES=$(ip -s link show can0 2>/dev/null | awk '/RX:/{getline; print $2}' || echo "0")
fi

# ---- Module construction check ----
PLC_MODULE=$(sudo journalctl -u viam-server --no-pager --since "5 min ago" 2>/dev/null | grep -c "Successfully constructed.*plc-monitor" || echo "0")
CELL_MODULE=$(sudo journalctl -u viam-server --no-pager --since "5 min ago" 2>/dev/null | grep -c "Successfully constructed.*cell-monitor" || echo "0")
TRUCK_MODULE=$(sudo journalctl -u viam-server --no-pager --since "5 min ago" 2>/dev/null | grep -c "Successfully constructed.*truck-engine" || echo "0")

# ---- Git sync check ----
GITHUB_COMMIT=$(cd "$REPO_DIR" && git fetch origin main --quiet 2>/dev/null; git rev-parse --short origin/main 2>/dev/null || echo "unknown")
PI5_SYNCED="true"
[ "$PI5_GIT" != "$GITHUB_COMMIT" ] && PI5_SYNCED="false"

# ---- Build status JSON ----
TIMESTAMP=$(date -Iseconds)
ISSUES=""

[ "$PI5_VIAM" != "active" ] && ISSUES="$ISSUES viam-down"
[ -n "$PI5_SERVICES_DOWN" ] && ISSUES="$ISSUES services:$PI5_SERVICES_DOWN"
[ "$PI5_SYNCED" = "false" ] && ISSUES="$ISSUES behind-git"
[ "$PI5_DISK" -gt 90 ] 2>/dev/null && ISSUES="$ISSUES disk-${PI5_DISK}pct"
[ "$CAN_UP" = "false" ] && ISSUES="$ISSUES can0-down"

HEALTHY="true"
[ -n "$ISSUES" ] && HEALTHY="false"

cat > "$STATUS_FILE" << EOJSON
{
  "timestamp": "$TIMESTAMP",
  "healthy": $HEALTHY,
  "issues": "$(echo $ISSUES | xargs)",
  "architecture": "single-pi",
  "github_commit": "$GITHUB_COMMIT",
  "pi5": {
    "commit": "$PI5_GIT",
    "synced": $PI5_SYNCED,
    "viam": "$PI5_VIAM",
    "disk_pct": $PI5_DISK,
    "wifi": "$PI5_WIFI",
    "tailscale": $PI5_TAILSCALE,
    "services_down": "$(echo $PI5_SERVICES_DOWN | xargs)",
    "uptime": "$PI5_UPTIME",
    "can_up": $CAN_UP,
    "can_rx_frames": $CAN_RX_FRAMES,
    "modules": {
      "plc_monitor": $PLC_MODULE,
      "cell_monitor": $CELL_MODULE,
      "truck_engine": $TRUCK_MODULE
    }
  }
}
EOJSON

# Log if unhealthy
if [ "$HEALTHY" = "false" ]; then
    echo "$TIMESTAMP UNHEALTHY: $ISSUES" >> "$LOG"
fi

# Output for cron/caller
cat "$STATUS_FILE"
