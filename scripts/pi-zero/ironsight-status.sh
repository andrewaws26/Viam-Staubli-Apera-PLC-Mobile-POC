#!/usr/bin/env bash
# ironsight-status.sh — IronSight Pi Zero diagnostic dashboard
# Shows color-coded status of CAN bus, sensor, capture/sync, network, and system resources.
# Usage: ironsight-status.sh [-q] (quiet mode: only print verdict line)

set -o pipefail

QUIET=false
[[ "${1:-}" == "-q" ]] && QUIET=true

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

ok()   { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
fail() { printf "${RED}✗${NC} %s\n" "$1"; }
hdr()  { printf "\n${BOLD}${CYAN}═══ %s ═══${NC}\n" "$1"; }

ISSUES=()

add_issue() { ISSUES+=("$1"); }

# ╔═══════════════════════════════════════════════════════╗
# ║  CAN Bus Layer                                        ║
# ╚═══════════════════════════════════════════════════════╝
can_status() {
    hdr "CAN BUS"

    # Interface up?
    local link_info
    link_info=$(ip link show can0 2>&1)
    if [[ $? -ne 0 ]]; then
        fail "can0 interface NOT FOUND"
        add_issue "can0 missing"
        return
    fi

    if echo "$link_info" | grep -q "UP"; then
        local state
        state=$(echo "$link_info" | grep -oP 'state \K\S+')
        ok "can0 UP (state: ${state})"
    else
        # Check if watchdog intentionally brought can0 down
        if [[ -f /tmp/ironsight-can-watchdog.state ]] && \
           grep -q 'can_was_down=true' /tmp/ironsight-can-watchdog.state 2>/dev/null; then
            warn "can0 DOWN (watchdog: vehicle off, saving CPU)"
        else
            fail "can0 interface DOWN"
            add_issue "can0 down"
        fi
    fi

    # CAN stats
    local stats
    stats=$(ip -s link show can0 2>/dev/null)
    if [[ -n "$stats" ]]; then
        local rx_frames tx_frames rx_errors tx_errors
        # Parse RX line (3rd line after "RX: bytes packets...")
        rx_frames=$(echo "$stats" | awk '/RX:/{getline; print $2}' | head -1)
        tx_frames=$(echo "$stats" | awk '/TX:/{getline; print $2}' | head -1)
        rx_errors=$(echo "$stats" | awk '/RX:/{getline; print $3}' | head -1)
        tx_errors=$(echo "$stats" | awk '/TX:/{getline; print $3}' | head -1)

        printf "  RX frames: ${BOLD}%s${NC}  errors: %s\n" "${rx_frames:-0}" "${rx_errors:-0}"
        printf "  TX frames: ${BOLD}%s${NC}  errors: %s\n" "${tx_frames:-0}" "${tx_errors:-0}"

        if [[ "${rx_errors:-0}" -gt 100 ]]; then
            warn "High CAN RX error count: ${rx_errors}"
            add_issue "CAN RX errors: ${rx_errors}"
        fi
    fi

    # CAN bus-off / error counters from /sys
    if [[ -f /sys/class/net/can0/statistics/rx_compressed ]]; then
        local busoff
        busoff=$(cat /sys/class/net/can0/statistics/rx_compressed 2>/dev/null || echo "0")
        [[ "$busoff" -gt 0 ]] && warn "Bus-off events: $busoff"
    fi

    # Last CAN activity from journal (look for sensor readings)
    local last_can
    last_can=$(sudo journalctl -u viam-server --no-pager -n 200 2>/dev/null | \
        grep -iE '(can|frame|pgn|reading|sensor)' | tail -1)
    if [[ -n "$last_can" ]]; then
        printf "  Last CAN activity: ${DIM}%s${NC}\n" "$(echo "$last_can" | cut -c1-120)"
    fi
}

# ╔═══════════════════════════════════════════════════════╗
# ║  Sensor Module Layer                                   ║
# ╚═══════════════════════════════════════════════════════╝
sensor_status() {
    hdr "SENSOR MODULE"

    # viam-server running?
    local pid uptime_s mem_rss
    pid=$(pgrep -f "viam-server.*--config" | head -1)
    if [[ -z "$pid" ]]; then
        fail "viam-server NOT RUNNING"
        add_issue "viam-server not running"
        return
    fi

    # Uptime
    local start_time
    start_time=$(ps -o lstart= -p "$pid" 2>/dev/null | xargs)
    uptime_s=$(ps -o etimes= -p "$pid" 2>/dev/null | xargs)
    if [[ -n "$uptime_s" ]]; then
        local h=$((uptime_s / 3600)) m=$(( (uptime_s % 3600) / 60 )) s=$((uptime_s % 60))
        ok "viam-server running (PID $pid, uptime ${h}h${m}m${s}s)"
    else
        ok "viam-server running (PID $pid)"
    fi

    # Memory
    mem_rss=$(ps -o rss= -p "$pid" 2>/dev/null | xargs)
    if [[ -n "$mem_rss" ]]; then
        local mem_mb=$((mem_rss / 1024))
        if [[ $mem_mb -gt 300 ]]; then
            warn "viam-server RSS: ${mem_mb}MB (HIGH for Pi Zero)"
            add_issue "viam-server high memory: ${mem_mb}MB"
        elif [[ $mem_mb -gt 200 ]]; then
            warn "viam-server RSS: ${mem_mb}MB"
        else
            printf "  Memory (RSS): ${BOLD}%sMB${NC}\n" "$mem_mb"
        fi
    fi

    # Python module process
    local py_pid
    py_pid=$(pgrep -f "src.main" 2>/dev/null | head -1)
    if [[ -n "$py_pid" ]]; then
        local py_rss
        py_rss=$(ps -o rss= -p "$py_pid" 2>/dev/null | xargs)
        local py_mb=$(( (py_rss + 0) / 1024 ))
        ok "j1939-sensor module running (PID $py_pid, ${py_mb}MB)"
    else
        # Check if still starting up
        local starting
        starting=$(sudo journalctl -u viam-server --no-pager -n 20 2>/dev/null | \
            grep -c "Waiting for module to complete startup")
        if [[ "$starting" -gt 0 ]]; then
            warn "j1939-sensor module STARTING UP (venv bootstrap)"
        else
            fail "j1939-sensor module NOT RUNNING"
            add_issue "sensor module not running"
        fi
    fi

    # Protocol detection
    local protocol
    protocol=$(sudo journalctl -u viam-server --no-pager -n 500 2>/dev/null | \
        grep -ioE '(j1939|obd2|obd-ii|protocol).{0,40}' | tail -1)
    if [[ -n "$protocol" ]]; then
        printf "  Protocol: ${BOLD}%s${NC}\n" "$protocol"
    fi

    # Last 5 journal lines (sensor-related)
    printf "\n  ${DIM}--- Recent journal (sensor) ---${NC}\n"
    sudo journalctl -u viam-server --no-pager -n 100 2>/dev/null | \
        grep -ivE '(webrtc|wrtc|candidate|networking.*rpc)' | tail -5 | \
        while IFS= read -r line; do
            printf "  ${DIM}%s${NC}\n" "$(echo "$line" | cut -c1-120)"
        done
}

# ╔═══════════════════════════════════════════════════════╗
# ║  Viam Capture/Sync Layer                               ║
# ╚═══════════════════════════════════════════════════════╝
capture_status() {
    hdr "VIAM CAPTURE/SYNC"

    local capture_dir="/home/andrew/.viam/capture"
    # viam-server runs as root, so capture might be root-owned
    local actual_dir
    for d in "$capture_dir" "/root/.viam/capture"; do
        if sudo test -d "$d" 2>/dev/null; then
            actual_dir="$d"
            break
        fi
    done

    if [[ -z "${actual_dir:-}" ]]; then
        fail "Capture directory not found"
        add_issue "no capture directory"
        return
    fi

    # Directory size
    local dir_size
    dir_size=$(sudo du -sh "$actual_dir" 2>/dev/null | cut -f1)
    printf "  Capture dir: ${BOLD}%s${NC} (%s)\n" "$actual_dir" "${dir_size:-unknown}"

    # Count pending sync files (.capture = finalized, .prog = active)
    local pending_count failed_count prog_count
    pending_count=$(sudo find "$actual_dir" -not -path "*/failed/*" -name "*.capture" 2>/dev/null | wc -l | xargs)
    failed_count=$(sudo find "$actual_dir/failed" -name "*.capture" 2>/dev/null | wc -l | xargs)
    prog_count=$(sudo find "$actual_dir" -not -path "*/failed/*" -name "*.prog" 2>/dev/null | wc -l | xargs)
    local total_pending=$(( pending_count + failed_count ))

    printf "  Active .prog files: ${BOLD}%s${NC}  Pending sync: ${BOLD}%s${NC}  Failed: ${BOLD}%s${NC}\n" \
        "${prog_count}" "${pending_count}" "${failed_count}"
    if [[ "${total_pending}" -gt 50 ]]; then
        warn "Sync backlog: ${total_pending} files waiting"
        add_issue "sync backlog: ${total_pending} files"
    elif [[ "${failed_count}" -gt 10 ]]; then
        warn "Failed sync files: ${failed_count}"
        add_issue "sync failures: ${failed_count}"
    fi

    # Most recent .prog file (actively being written = live capture)
    local newest
    newest=$(sudo find "$actual_dir" -not -path "*/failed/*" -name "*.prog" -printf '%T@ %p\n' 2>/dev/null | \
        sort -rn | head -1 | cut -d' ' -f2-)
    if [[ -z "$newest" ]]; then
        newest=$(sudo find "$actual_dir" -type f -printf '%T@ %p\n' 2>/dev/null | \
            sort -rn | head -1 | cut -d' ' -f2-)
    fi
    if [[ -n "$newest" ]]; then
        local mod_time now age
        mod_time=$(sudo stat -c '%Y' "$newest" 2>/dev/null)
        now=$(date +%s)
        age=$(( now - mod_time ))
        if [[ $age -gt 120 ]]; then
            warn "Latest capture file is ${age}s old ($(basename "$newest"))"
            add_issue "capture stale: ${age}s old"
        elif [[ $age -gt 30 ]]; then
            printf "  Latest capture: ${BOLD}%ss ago${NC} ($(basename "$newest"))\n" "$age"
        else
            ok "Data being captured (latest: ${age}s ago)"
        fi
    else
        warn "No capture files found"
    fi

    # Cloud reachability
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 https://app.viam.com 2>/dev/null)
    if [[ "$http_code" -ge 200 && "$http_code" -lt 400 ]]; then
        ok "Viam Cloud reachable (HTTP $http_code)"
    elif [[ "$http_code" == "000" ]]; then
        fail "Viam Cloud UNREACHABLE (no response)"
        add_issue "Viam Cloud unreachable"
    else
        warn "Viam Cloud returned HTTP $http_code"
    fi

    # Check journal for sync errors
    local sync_errors
    sync_errors=$(sudo journalctl -u viam-server --no-pager -n 200 --since "5 min ago" 2>/dev/null | \
        grep -ciE '(sync.*error|sync.*fail|upload.*fail)' || true)
    if [[ "${sync_errors:-0}" -gt 0 ]]; then
        warn "Sync errors in last 5 min: ${sync_errors}"
        add_issue "sync errors: ${sync_errors}"
    fi
}

# ╔═══════════════════════════════════════════════════════╗
# ║  Network Layer                                         ║
# ╚═══════════════════════════════════════════════════════╝
network_status() {
    hdr "NETWORK"

    # WiFi
    local wifi_info
    wifi_info=$(nmcli -t -f active,ssid,signal dev wifi 2>/dev/null | grep '^yes:')
    if [[ -n "$wifi_info" ]]; then
        local ssid signal
        ssid=$(echo "$wifi_info" | cut -d: -f2)
        signal=$(echo "$wifi_info" | cut -d: -f3)
        if [[ "${signal:-0}" -lt 30 ]]; then
            warn "WiFi: ${ssid} (signal: ${signal}% — WEAK)"
            add_issue "weak WiFi: ${signal}%"
        elif [[ "${signal:-0}" -lt 50 ]]; then
            warn "WiFi: ${ssid} (signal: ${signal}%)"
        else
            ok "WiFi: ${ssid} (signal: ${signal}%)"
        fi
    else
        # Try iw if nmcli unavailable
        local iw_info
        iw_info=$(iw dev wlan0 link 2>/dev/null | grep -i ssid | awk '{print $2}')
        if [[ -n "$iw_info" ]]; then
            ok "WiFi: ${iw_info}"
        else
            fail "WiFi: NOT CONNECTED"
            add_issue "WiFi disconnected"
        fi
    fi

    # Tailscale
    local ts_status
    ts_status=$(tailscale status --self --json 2>/dev/null)
    if [[ -n "$ts_status" ]]; then
        local ts_online
        ts_online=$(echo "$ts_status" | grep -o '"Online":true' 2>/dev/null)
        local ts_ip
        ts_ip=$(echo "$ts_status" | grep -oP '"TailscaleIPs":\["\K[^"]+' 2>/dev/null | head -1)
        if [[ -n "$ts_online" ]]; then
            ok "Tailscale: online (${ts_ip:-?})"
        else
            warn "Tailscale: connected but may be offline"
        fi
    else
        local ts_simple
        ts_simple=$(tailscale status --self 2>&1 | head -1)
        if echo "$ts_simple" | grep -q "100\."; then
            ok "Tailscale: ${ts_simple}"
        else
            fail "Tailscale: NOT CONNECTED"
            add_issue "Tailscale down"
        fi
    fi

    # Internet
    if ping -c1 -W3 8.8.8.8 >/dev/null 2>&1; then
        ok "Internet: reachable"
    else
        fail "Internet: UNREACHABLE"
        add_issue "no internet"
    fi

    # Viam Cloud ping
    if ping -c1 -W3 app.viam.com >/dev/null 2>&1; then
        ok "app.viam.com: reachable"
    else
        warn "app.viam.com: not pingable (may block ICMP)"
    fi
}

# ╔═══════════════════════════════════════════════════════╗
# ║  System Resources                                      ║
# ╚═══════════════════════════════════════════════════════╝
system_status() {
    hdr "SYSTEM RESOURCES"

    # CPU load
    local load1 load5 load15
    read -r load1 load5 load15 _ < /proc/loadavg
    local ncpu
    ncpu=$(nproc 2>/dev/null || echo 4)
    # Compare load1 to ncpu (integer comparison)
    local load1_int=${load1%%.*}
    if [[ "${load1_int:-0}" -ge $((ncpu * 2)) ]]; then
        fail "Load: ${load1} ${load5} ${load15} (${ncpu} cores) — OVERLOADED"
        add_issue "CPU overloaded: load ${load1}"
    elif [[ "${load1_int:-0}" -ge "$ncpu" ]]; then
        warn "Load: ${load1} ${load5} ${load15} (${ncpu} cores)"
    else
        ok "Load: ${load1} ${load5} ${load15} (${ncpu} cores)"
    fi

    # Memory
    local mem_info
    mem_info=$(free -m | awk '/Mem:/{printf "Used: %dMB / %dMB (%.0f%%) — Free: %dMB, Available: %dMB", $3, $2, $3/$2*100, $4, $7}')
    local mem_avail
    mem_avail=$(free -m | awk '/Mem:/{print $7}')
    if [[ "${mem_avail:-0}" -lt 50 ]]; then
        fail "Memory: ${mem_info} — CRITICAL"
        add_issue "memory critical: ${mem_avail}MB available"
    elif [[ "${mem_avail:-0}" -lt 100 ]]; then
        warn "Memory: ${mem_info}"
    else
        ok "Memory: ${mem_info}"
    fi

    # Temperature
    local temp
    temp=$(vcgencmd measure_temp 2>/dev/null | grep -oP '[\d.]+')
    if [[ -n "$temp" ]]; then
        local temp_int=${temp%%.*}
        if [[ "${temp_int:-0}" -ge 80 ]]; then
            fail "Temperature: ${temp}°C — THROTTLING LIKELY"
            add_issue "temperature: ${temp}°C"
        elif [[ "${temp_int:-0}" -ge 70 ]]; then
            warn "Temperature: ${temp}°C"
        else
            ok "Temperature: ${temp}°C"
        fi
    else
        printf "  Temperature: ${DIM}unavailable${NC}\n"
    fi

    # Disk
    local disk_use
    disk_use=$(df -h / | awk 'NR==2{printf "%s used of %s (%s)", $3, $2, $5}')
    local disk_pct
    disk_pct=$(df / | awk 'NR==2{gsub(/%/,""); print $5}')
    local disk_avail
    disk_avail=$(df -m / | awk 'NR==2{print $4}')
    if [[ "${disk_avail:-999999}" -lt 500 ]]; then
        fail "Disk: ${disk_use} — LOW SPACE (${disk_avail}MB free)"
        add_issue "disk low: ${disk_avail}MB free"
    elif [[ "${disk_pct:-0}" -ge 85 ]]; then
        warn "Disk: ${disk_use}"
    else
        ok "Disk: ${disk_use}"
    fi

    # Top 5 by CPU
    printf "\n  ${DIM}--- Top 5 by CPU ---${NC}\n"
    ps aux --sort=-%cpu | head -6 | tail -5 | \
        awk '{printf "  %5s%% CPU  %5sMB  %s\n", $3, int($6/1024), $11}' 2>/dev/null || true

    # Top 5 by Memory
    printf "\n  ${DIM}--- Top 5 by Memory ---${NC}\n"
    ps aux --sort=-%mem | head -6 | tail -5 | \
        awk '{printf "  %5s%% MEM  %5sMB  %s\n", $4, int($6/1024), $11}' 2>/dev/null || true
}

# ╔═══════════════════════════════════════════════════════╗
# ║  Verdict                                               ║
# ╚═══════════════════════════════════════════════════════╝
verdict() {
    printf "\n${BOLD}═══════════════════════════════════════════${NC}\n"
    if [[ ${#ISSUES[@]} -eq 0 ]]; then
        printf "${GREEN}${BOLD}✅ DATA FLOWING — all systems nominal${NC}\n"
    else
        # Classify severity
        local critical=false
        local reasons=""
        for issue in "${ISSUES[@]}"; do
            reasons="${reasons}, ${issue}"
            case "$issue" in
                *"not running"*|*"can0 down"*|*"can0 missing"*|*"no internet"*)
                    critical=true ;;
            esac
        done
        reasons="${reasons:2}" # strip leading ", "

        if $critical; then
            printf "${RED}${BOLD}❌ DATA STOPPED: %s${NC}\n" "$reasons"
        else
            printf "${YELLOW}${BOLD}⚠️  DEGRADED: %s${NC}\n" "$reasons"
        fi
    fi
    printf "${BOLD}═══════════════════════════════════════════${NC}\n"
}

# ═══ Main ═══
main() {
    printf "${BOLD}${CYAN}"
    printf "╔═══════════════════════════════════════════════╗\n"
    printf "║       IronSight Pi Zero Status Dashboard      ║\n"
    printf "║       %s                       ║\n" "$(date '+%Y-%m-%d %H:%M:%S')"
    printf "╚═══════════════════════════════════════════════╝\n"
    printf "${NC}"

    can_status
    sensor_status
    capture_status
    network_status
    system_status
    verdict
}

if $QUIET; then
    # Suppress all output, only run verdict
    ISSUES=()
    can_status  >/dev/null 2>&1
    sensor_status >/dev/null 2>&1
    capture_status >/dev/null 2>&1
    network_status >/dev/null 2>&1
    system_status >/dev/null 2>&1
    verdict
else
    main
fi
