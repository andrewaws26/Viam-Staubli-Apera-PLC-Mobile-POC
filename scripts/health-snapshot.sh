#!/bin/bash
# IronSight Health Snapshot — periodic structured logging for field-test analysis.
#
# Captures system health, module status, CAN bus, and PLC connectivity as
# JSON-lines in /var/log/ironsight-field.jsonl. Run via cron every minute
# during field testing for detailed post-test analysis.
#
# Install for field testing:
#   (crontab -l; echo "* * * * * /home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/scripts/health-snapshot.sh") | crontab -
#
# Remove after testing:
#   crontab -l | grep -v health-snapshot | crontab -

set -uo pipefail

PROJECT_DIR="/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC"
LOG_FILE="/var/log/ironsight-field.jsonl"
PLC_CONF="/home/andrew/.ironsight/plc-network.conf"
TS=$(date -Iseconds)
EPOCH=$(date +%s)

# ── Helper: emit one JSON-lines log entry ──
emit() {
    echo "$1" >> "$LOG_FILE"
}

# ── System Health ──
CPU_TEMP=$(vcgencmd measure_temp 2>/dev/null | grep -oP '[0-9.]+' || echo "0")
CPU_PCT=$(top -bn1 | grep "Cpu(s)" | awk '{print $2+$4}' 2>/dev/null || echo "0")
MEM_PCT=$(free | awk '/Mem:/{printf "%.1f", $3/$2*100}' 2>/dev/null || echo "0")
DISK_PCT=$(df / | awk 'NR==2{print $5}' | tr -d '%' 2>/dev/null || echo "0")
THROTTLED=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2 || echo "0x0")
LOAD=$(cat /proc/loadavg | awk '{print $1}' 2>/dev/null || echo "0")

emit "{\"ts\":\"$TS\",\"epoch\":$EPOCH,\"cat\":\"system\",\"event\":\"health_snapshot\",\"cpu_temp_c\":$CPU_TEMP,\"cpu_pct\":$CPU_PCT,\"mem_pct\":$MEM_PCT,\"disk_pct\":$DISK_PCT,\"throttled\":\"$THROTTLED\",\"load_1m\":$LOAD}"

# ── Service Status ──
VIAM=$(systemctl is-active viam-server 2>/dev/null || echo "dead")
CAN=$(systemctl is-active can0 2>/dev/null || echo "dead")
PLC_SVC=$(systemctl is-active plc-subnet 2>/dev/null || echo "dead")
TAILSCALE=$(systemctl is-active tailscaled 2>/dev/null || echo "dead")

emit "{\"ts\":\"$TS\",\"epoch\":$EPOCH,\"cat\":\"system\",\"event\":\"service_status\",\"viam\":\"$VIAM\",\"can0\":\"$CAN\",\"plc_subnet\":\"$PLC_SVC\",\"tailscale\":\"$TAILSCALE\"}"

# ── CAN Bus ──
CAN_UP="false"
CAN_RX="0"
CAN_TX="0"
CAN_ERR="0"
CAN_LISTEN="false"
if ip link show can0 2>/dev/null | grep -q "UP"; then
    CAN_UP="true"
    # Parse CAN statistics
    CAN_STATS=$(ip -s link show can0 2>/dev/null)
    CAN_RX=$(echo "$CAN_STATS" | awk '/RX:/{getline; print $2}' || echo "0")
    CAN_TX=$(echo "$CAN_STATS" | awk '/TX:/{getline; print $2}' || echo "0")
    CAN_ERR=$(echo "$CAN_STATS" | awk '/RX:/{getline; print $4}' || echo "0")
    ip -d link show can0 2>/dev/null | grep -q "listen-only on" && CAN_LISTEN="true"
fi

emit "{\"ts\":\"$TS\",\"epoch\":$EPOCH,\"cat\":\"can\",\"event\":\"status_check\",\"ok\":$CAN_UP,\"rx_frames\":$CAN_RX,\"tx_frames\":$CAN_TX,\"errors\":$CAN_ERR,\"listen_only\":$CAN_LISTEN}"

# ── PLC Connection ──
PLC_IP="unknown"
if [ -f "$PLC_CONF" ]; then
    PLC_IP=$(grep PLC_IP "$PLC_CONF" | cut -d'"' -f2)
fi

PLC_OK="false"
PLC_MS="null"
if [ "$PLC_IP" != "unknown" ] && [ -n "$PLC_IP" ]; then
    START_NS=$(date +%s%N)
    if timeout 2 bash -c "echo >/dev/tcp/$PLC_IP/502" 2>/dev/null; then
        END_NS=$(date +%s%N)
        PLC_MS=$(( (END_NS - START_NS) / 1000000 ))
        PLC_OK="true"
    fi
fi

emit "{\"ts\":\"$TS\",\"epoch\":$EPOCH,\"cat\":\"plc\",\"event\":\"connection_check\",\"ok\":$PLC_OK,\"plc_ip\":\"$PLC_IP\",\"ms\":$PLC_MS}"

# ── Network ──
ETH0_CARRIER=$(cat /sys/class/net/eth0/carrier 2>/dev/null || echo "0")
ETH0_IPS=$(ip -4 addr show eth0 2>/dev/null | grep -oP '(?<=inet )\S+' | tr '\n' ',' | sed 's/,$//')
WIFI_SSID=$(nmcli -t -f NAME,DEVICE connection show --active 2>/dev/null | grep wlan0 | cut -d: -f1)
INTERNET="false"
ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1 && INTERNET="true"

emit "{\"ts\":\"$TS\",\"epoch\":$EPOCH,\"cat\":\"network\",\"event\":\"status_check\",\"eth0_carrier\":$ETH0_CARRIER,\"eth0_ips\":\"$ETH0_IPS\",\"wifi\":\"${WIFI_SSID:-none}\",\"internet\":$INTERNET}"

# ── Module Health (from recent viam-server logs) ──
PLC_MOD=$(sudo journalctl -u viam-server --since "1 min ago" --no-pager 2>/dev/null | grep -c "plc-monitor" || echo "0")
CELL_MOD=$(sudo journalctl -u viam-server --since "1 min ago" --no-pager 2>/dev/null | grep -c "cell-monitor" || echo "0")
TRUCK_MOD=$(sudo journalctl -u viam-server --since "1 min ago" --no-pager 2>/dev/null | grep -c "truck-engine" || echo "0")
ERRORS=$(sudo journalctl -u viam-server --since "1 min ago" --no-pager 2>/dev/null | grep -ci "error\|panic\|fatal" || echo "0")

emit "{\"ts\":\"$TS\",\"epoch\":$EPOCH,\"cat\":\"module\",\"event\":\"log_activity\",\"plc_monitor_lines\":$PLC_MOD,\"cell_monitor_lines\":$CELL_MOD,\"truck_engine_lines\":$TRUCK_MOD,\"error_count\":$ERRORS}"
