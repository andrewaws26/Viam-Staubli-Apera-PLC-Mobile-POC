#!/usr/bin/env bash
# ironsight-resource-logger.sh — Lightweight resource logger for cron (every 60s)
# Appends one JSON line per invocation to /var/log/ironsight/resources.jsonl
# Designed for Pi Zero 2 W (512MB RAM) — uses only /proc and standard tools.

set -o pipefail

LOG_DIR="/var/log/ironsight"
LOG_FILE="${LOG_DIR}/resources.jsonl"
MAX_SIZE=10485760  # 10MB

# Ensure log dir exists
mkdir -p "$LOG_DIR" 2>/dev/null

# --- Log rotation ---
if [[ -f "$LOG_FILE" ]]; then
    file_size=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
    if [[ "$file_size" -ge "$MAX_SIZE" ]]; then
        mv -f "$LOG_FILE" "${LOG_FILE}.1"
    fi
fi

# --- Timestamp ---
ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# --- CPU % (from /proc/stat, single sample via top) ---
cpu_pct=$(top -bn1 -d0.1 2>/dev/null | awk '/^%?Cpu/{gsub(/[^0-9.]/," ",$0); split($0,a," "); idle=a[4]; printf "%.1f", 100-idle; exit}')
[[ -z "$cpu_pct" ]] && cpu_pct="null"

# --- Memory ---
mem_used_mb=$(free -m 2>/dev/null | awk '/Mem:/{print $3}')
mem_total_mb=$(free -m 2>/dev/null | awk '/Mem:/{print $2}')
mem_avail_mb=$(free -m 2>/dev/null | awk '/Mem:/{print $7}')
[[ -z "$mem_used_mb" ]] && mem_used_mb="null"
[[ -z "$mem_total_mb" ]] && mem_total_mb="null"
[[ -z "$mem_avail_mb" ]] && mem_avail_mb="null"

# --- CPU temperature ---
cpu_temp_c=$(vcgencmd measure_temp 2>/dev/null | grep -oP '[\d.]+')
[[ -z "$cpu_temp_c" ]] && cpu_temp_c="null"

# --- Load averages ---
read -r load_1m load_5m load_15m _ < /proc/loadavg 2>/dev/null
[[ -z "$load_1m" ]] && load_1m="null"
[[ -z "$load_5m" ]] && load_5m="null"
[[ -z "$load_15m" ]] && load_15m="null"

# --- Disk usage % ---
disk_used_pct=$(df / 2>/dev/null | awk 'NR==2{gsub(/%/,""); print $5}')
[[ -z "$disk_used_pct" ]] && disk_used_pct="null"

# --- Top process by CPU ---
top_proc=$(ps aux --sort=-%cpu 2>/dev/null | awk 'NR==2{print $11}' | sed 's/.*\///' | head -c 50)
top_proc_cpu=$(ps aux --sort=-%cpu 2>/dev/null | awk 'NR==2{print $3}')
[[ -z "$top_proc" ]] && top_proc="null"
[[ -z "$top_proc_cpu" ]] && top_proc_cpu="null"

# --- CAN0 RX frames (cumulative) ---
can0_rx_frames="null"
if [[ -f /sys/class/net/can0/statistics/rx_packets ]]; then
    can0_rx_frames=$(cat /sys/class/net/can0/statistics/rx_packets 2>/dev/null)
fi
[[ -z "$can0_rx_frames" ]] && can0_rx_frames="null"

# --- CAN0 RX errors ---
can0_rx_errors="null"
if [[ -f /sys/class/net/can0/statistics/rx_errors ]]; then
    can0_rx_errors=$(cat /sys/class/net/can0/statistics/rx_errors 2>/dev/null)
fi
[[ -z "$can0_rx_errors" ]] && can0_rx_errors="null"

# --- viam-server RSS ---
viam_rss_mb="null"
viam_pid=$(pgrep -f "viam-server.*--config" 2>/dev/null | head -1)
if [[ -n "$viam_pid" ]]; then
    viam_rss_kb=$(ps -o rss= -p "$viam_pid" 2>/dev/null | xargs)
    [[ -n "$viam_rss_kb" ]] && viam_rss_mb=$((viam_rss_kb / 1024))
fi

# --- Sensor module RSS ---
sensor_rss_mb="null"
sensor_pid=$(pgrep -f "src.main" 2>/dev/null | head -1)
if [[ -n "$sensor_pid" ]]; then
    sensor_rss_kb=$(ps -o rss= -p "$sensor_pid" 2>/dev/null | xargs)
    [[ -n "$sensor_rss_kb" ]] && sensor_rss_mb=$((sensor_rss_kb / 1024))
fi

# --- Capture directory metrics ---
capture_dir_mb="null"
unsync_files_count="null"
for d in /home/andrew/.viam/capture /root/.viam/capture; do
    if sudo test -d "$d" 2>/dev/null; then
        capture_dir_mb=$(sudo du -sm "$d" 2>/dev/null | cut -f1)
        unsync_files_count=$(sudo find "$d" -name "*.capture" 2>/dev/null | wc -l | xargs)
        break
    fi
done
[[ -z "$capture_dir_mb" ]] && capture_dir_mb="null"
[[ -z "$unsync_files_count" ]] && unsync_files_count="null"

# --- WiFi signal strength ---
wifi_signal="null"
wifi_ssid="null"
wifi_info=$(nmcli -t -f active,ssid,signal dev wifi 2>/dev/null | grep '^yes:')
if [[ -n "$wifi_info" ]]; then
    wifi_ssid=$(echo "$wifi_info" | cut -d: -f2)
    wifi_signal=$(echo "$wifi_info" | cut -d: -f3)
fi

# --- Quote strings, leave numbers/null unquoted ---
quote() {
    local v="$1"
    if [[ "$v" == "null" || "$v" =~ ^-?[0-9]+\.?[0-9]*$ ]]; then
        echo "$v"
    else
        echo "\"$v\""
    fi
}

# --- Write JSON line ---
cat >> "$LOG_FILE" <<JSONEOF
{"ts":"${ts}","cpu_pct":${cpu_pct},"mem_used_mb":${mem_used_mb},"mem_total_mb":${mem_total_mb},"mem_avail_mb":${mem_avail_mb},"cpu_temp_c":${cpu_temp_c},"load_1m":${load_1m},"load_5m":${load_5m},"load_15m":${load_15m},"disk_used_pct":${disk_used_pct},"top_process":$(quote "$top_proc"),"top_process_cpu_pct":${top_proc_cpu},"can0_rx_frames":${can0_rx_frames},"can0_rx_errors":${can0_rx_errors},"viam_server_rss_mb":${viam_rss_mb},"sensor_rss_mb":${sensor_rss_mb},"capture_dir_mb":${capture_dir_mb},"unsync_files_count":${unsync_files_count},"wifi_ssid":$(quote "$wifi_ssid"),"wifi_signal":${wifi_signal}}
JSONEOF
