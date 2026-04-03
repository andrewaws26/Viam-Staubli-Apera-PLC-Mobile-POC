#!/usr/bin/env bash
# ironsight-can-watchdog.sh — CAN bus power-saving watchdog
#
# Problem: The MCP2515 CAN HAT generates continuous error interrupts when no
# CAN nodes are on the bus (vehicle off). Each interrupt triggers SPI register
# reads, burning ~88% of a CPU core via [irq/184-spi0.0].
#
# Solution: Bring can0 down when idle (no rx_packets change for 2 checks).
# Probe every 1 minute by briefly bringing can0 up for 10 seconds. If traffic
# is detected, leave it up; otherwise bring it back down.
#
# State file resets on reboot (/tmp), so can0 always starts UP via can0.service.
# The j1939 sensor module already handles can0 being down — returns vehicle-off payload.

set -o pipefail

STATE_FILE="/tmp/ironsight-can-watchdog.state"
TAG="ironsight-can-watchdog"
CAN_IF="can0"
CAN_BITRATE=250000
PROBE_INTERVAL=2  # probe every Nth check when down (2 checks = 1 min at 30s timer)
PROBE_DURATION=10 # seconds to listen during probe

log() { logger -t "$TAG" "$1"; }

# --- Read state file ---
prev_rx=0
idle_count=0
probe_count=0
can_was_down=false

if [[ -f "$STATE_FILE" ]]; then
    source "$STATE_FILE" 2>/dev/null
fi

# --- Check if can0 interface exists at all ---
if ! ip link show "$CAN_IF" &>/dev/null; then
    log "ERROR: $CAN_IF interface not found — CAN HAT issue?"
    exit 1
fi

# --- Determine if can0 is currently UP ---
can_is_up() {
    ip link show "$CAN_IF" 2>/dev/null | grep -q "UP"
}

# --- Get current rx_packets ---
get_rx() {
    cat "/sys/class/net/${CAN_IF}/statistics/rx_packets" 2>/dev/null || echo 0
}

# --- Bring can0 UP with correct parameters ---
# NOTE: Do NOT use "listen-only on" here — OBD-II requires transmitting request frames.
# listen-only mode is only safe for J1939 (broadcast protocol) and kills OBD-II completely.
can_up() {
    ip link set "$CAN_IF" down 2>/dev/null
    ip link set "$CAN_IF" up type can bitrate "$CAN_BITRATE" 2>/dev/null
    ifconfig "$CAN_IF" txqueuelen 65536 2>/dev/null
}

# --- Bring can0 DOWN ---
can_down() {
    ip link set "$CAN_IF" down 2>/dev/null
}

# --- Save state ---
save_state() {
    cat > "$STATE_FILE" <<EOF
prev_rx=$1
idle_count=$2
probe_count=$3
can_was_down=$4
EOF
}

# ═══════════════════════════════════════════
# Main logic
# ═══════════════════════════════════════════

if can_is_up; then
    current_rx=$(get_rx)

    if [[ "$current_rx" -eq "$prev_rx" ]]; then
        # No new frames since last check
        idle_count=$((idle_count + 1))

        if [[ "$idle_count" -ge 2 ]]; then
            # 2 consecutive idle checks (~1 min) — shut down to save CPU
            can_down
            log "can0 DOWN (no traffic for $((idle_count * 30))s, saving CPU)"
            save_state "$current_rx" 0 0 true
            exit 0
        else
            log "can0 UP, idle check ${idle_count}/2 (rx=$current_rx)"
            save_state "$current_rx" "$idle_count" 0 false
            exit 0
        fi
    else
        # Traffic detected — reset idle counter
        new_frames=$((current_rx - prev_rx))
        if [[ "$idle_count" -gt 0 || "$can_was_down" == "true" ]]; then
            log "can0 UP, traffic resumed ($new_frames new frames, rx=$current_rx)"
        fi
        save_state "$current_rx" 0 0 false
        exit 0
    fi
else
    # can0 is DOWN — check if it's time to probe
    probe_count=$((probe_count + 1))

    if [[ "$probe_count" -ge "$PROBE_INTERVAL" ]]; then
        # Time to probe
        log "Probing for CAN traffic (bringing can0 up for ${PROBE_DURATION}s)..."
        can_up
        sleep "$PROBE_DURATION"

        probe_rx=$(get_rx)
        if [[ "$probe_rx" -gt 0 ]]; then
            # Broadcast traffic found (J1939 truck) — leave can0 up
            log "Vehicle active! can0 staying UP ($probe_rx frames in ${PROBE_DURATION}s)"
            save_state "$probe_rx" 0 0 false
            exit 0
        fi

        # No broadcast traffic — try an OBD-II active probe.
        # OBD-II is request-response: no traffic unless we ask.
        # Send PID 0x00 (supported PIDs) and check for a response.
        if command -v cansend &>/dev/null; then
            pre_rx=$(get_rx)
            cansend "$CAN_IF" "7DF#0201000000000000" 2>/dev/null
            sleep 1
            post_rx=$(get_rx)
            if [[ "$post_rx" -gt "$pre_rx" ]]; then
                log "OBD-II vehicle detected! can0 staying UP (got response to PID probe)"
                save_state "$post_rx" 0 0 false
                exit 0
            fi
        fi

        # No traffic from either protocol — back down
        can_down
        log "can0 DOWN (probe found no traffic)"
        save_state 0 0 0 true
        exit 0
    else
        # Not time to probe yet — stay down
        save_state "$prev_rx" 0 "$probe_count" true
        exit 0
    fi
fi
