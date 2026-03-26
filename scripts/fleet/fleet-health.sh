#!/bin/bash
# IronSight Fleet Health Check
# Runs on the Pi 5 (central hub) and checks both Pis.
# Outputs JSON status for consumption by watchdog/Claude.

set -uo pipefail

LOG="/var/log/ironsight-fleet-health.log"
STATUS_FILE="/home/andrew/.ironsight/fleet-status.json"
REPO_DIR="/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC"
TRUCK_PI="100.113.196.68"

mkdir -p "$(dirname "$STATUS_FILE")"

# ---- Local Pi 5 checks ----
PI5_GIT=$(cd "$REPO_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
PI5_VIAM=$(systemctl is-active viam-server 2>/dev/null || echo "dead")
PI5_DISK=$(df -h / | awk 'NR==2{print $5}' | tr -d '%')
PI5_UPTIME=$(uptime -p 2>/dev/null || uptime | awk '{print $3,$4}')
PI5_WIFI=$(nmcli -t -f NAME,DEVICE connection show --active 2>/dev/null | grep wlan0 | cut -d: -f1)
PI5_TAILSCALE=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('Self',{}).get('Online',False))" 2>/dev/null || echo "false")
PI5_SERVICES_DOWN=""
for svc in viam-server ironsight-server ironsight-discovery-daemon tailscaled; do
    if ! systemctl is-active --quiet "$svc" 2>/dev/null; then
        PI5_SERVICES_DOWN="$PI5_SERVICES_DOWN $svc"
    fi
done

# ---- Remote Pi Zero checks ----
PI0_REACHABLE="false"
PI0_GIT="unknown"
PI0_VIAM="unknown"
PI0_DISK="unknown"
PI0_MODULE="unknown"
PI0_UPTIME="unknown"

if sshpass -p '1111' ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no andrew@"$TRUCK_PI" 'true' 2>/dev/null; then
    PI0_REACHABLE="true"
    PI0_DATA=$(sshpass -p '1111' ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no andrew@"$TRUCK_PI" '
        echo "GIT=$(cd /home/andrew/repo && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
        echo "VIAM=$(systemctl is-active viam-server 2>/dev/null || echo dead)"
        echo "DISK=$(df -h / | awk "NR==2{print \$5}" | tr -d "%")"
        echo "MODULE=$(sudo journalctl -u viam-server --no-pager --since "5 min ago" 2>/dev/null | grep -c "Successfully constructed.*truck-engine")"
        echo "UPTIME=$(uptime -p 2>/dev/null || echo unknown)"
    ' 2>/dev/null)

    PI0_GIT=$(echo "$PI0_DATA" | grep "^GIT=" | cut -d= -f2)
    PI0_VIAM=$(echo "$PI0_DATA" | grep "^VIAM=" | cut -d= -f2)
    PI0_DISK=$(echo "$PI0_DATA" | grep "^DISK=" | cut -d= -f2)
    PI0_MODULE=$(echo "$PI0_DATA" | grep "^MODULE=" | cut -d= -f2)
    PI0_UPTIME=$(echo "$PI0_DATA" | grep "^UPTIME=" | cut -d= -f2-)
fi

# ---- Git sync check ----
GITHUB_COMMIT=$(cd "$REPO_DIR" && git fetch origin main --quiet 2>/dev/null; git rev-parse --short origin/main 2>/dev/null || echo "unknown")
PI5_SYNCED="true"
PI0_SYNCED="true"
[ "$PI5_GIT" != "$GITHUB_COMMIT" ] && PI5_SYNCED="false"
[ "$PI0_GIT" != "$GITHUB_COMMIT" ] && PI0_SYNCED="false"

# ---- Build status JSON ----
TIMESTAMP=$(date -Iseconds)
ISSUES=""

[ "$PI5_VIAM" != "active" ] && ISSUES="$ISSUES pi5-viam-down"
[ -n "$PI5_SERVICES_DOWN" ] && ISSUES="$ISSUES pi5-services:$PI5_SERVICES_DOWN"
[ "$PI5_SYNCED" = "false" ] && ISSUES="$ISSUES pi5-behind-git"
[ "$PI5_DISK" -gt 90 ] 2>/dev/null && ISSUES="$ISSUES pi5-disk-${PI5_DISK}pct"
[ "$PI0_REACHABLE" = "false" ] && ISSUES="$ISSUES pi0-unreachable"
[ "$PI0_VIAM" != "active" ] && [ "$PI0_REACHABLE" = "true" ] && ISSUES="$ISSUES pi0-viam-down"
[ "$PI0_SYNCED" = "false" ] && [ "$PI0_REACHABLE" = "true" ] && ISSUES="$ISSUES pi0-behind-git"

HEALTHY="true"
[ -n "$ISSUES" ] && HEALTHY="false"

cat > "$STATUS_FILE" << EOJSON
{
  "timestamp": "$TIMESTAMP",
  "healthy": $HEALTHY,
  "issues": "$(echo $ISSUES | xargs)",
  "github_commit": "$GITHUB_COMMIT",
  "pi5": {
    "commit": "$PI5_GIT",
    "synced": $PI5_SYNCED,
    "viam": "$PI5_VIAM",
    "disk_pct": $PI5_DISK,
    "wifi": "$PI5_WIFI",
    "tailscale": $PI5_TAILSCALE,
    "services_down": "$(echo $PI5_SERVICES_DOWN | xargs)",
    "uptime": "$PI5_UPTIME"
  },
  "pi0": {
    "reachable": $PI0_REACHABLE,
    "commit": "$PI0_GIT",
    "synced": $PI0_SYNCED,
    "viam": "$PI0_VIAM",
    "disk_pct": "${PI0_DISK:-0}",
    "module_constructed": ${PI0_MODULE:-0},
    "uptime": "$PI0_UPTIME"
  }
}
EOJSON

# Log if unhealthy
if [ "$HEALTHY" = "false" ]; then
    echo "$TIMESTAMP UNHEALTHY: $ISSUES" >> "$LOG"
fi

# Output for cron/caller
cat "$STATUS_FILE"
