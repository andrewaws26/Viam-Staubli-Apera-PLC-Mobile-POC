#!/bin/bash
# IronSight — AI-powered TPS monitoring and self-healing
# Usage: ironsight [on|off|status|chat]

MAINTENANCE_FLAG="$HOME/.tps-maintenance"
PROJECT_DIR="$HOME/Viam-Staubli-Apera-PLC-Mobile-POC"
WATCHDOG_LOG="/var/log/tps-watchdog.log"
FIX_LOG="/var/log/claude-fixes.log"
PLC_HOST="169.168.10.21"
PLC_PORT=502

case "${1:-status}" in
    on)
        rm -f "$MAINTENANCE_FLAG"
        echo ""
        echo "  ╔══════════════════════════════════════════╗"
        echo "  ║         IRONSIGHT — ACTIVATED            ║"
        echo "  ╚══════════════════════════════════════════╝"
        echo ""
        echo "  AI watchdog is monitoring the system."
        echo "  Run 'ironsight off' to take manual control."
        echo ""
        ;;
    off)
        touch "$MAINTENANCE_FLAG"
        echo ""
        echo "  ╔══════════════════════════════════════════╗"
        echo "  ║         IRONSIGHT — DEACTIVATED          ║"
        echo "  ╚══════════════════════════════════════════╝"
        echo ""

        echo "── System Report ──"
        echo ""

        # viam-server
        if systemctl is-active --quiet viam-server; then
            echo "  [OK] viam-server running"
        else
            echo "  [!!] viam-server NOT running"
        fi

        # PLC
        if timeout 3 bash -c "echo >/dev/tcp/$PLC_HOST/$PLC_PORT" 2>/dev/null; then
            echo "  [OK] PLC reachable ($PLC_HOST)"
        else
            echo "  [!!] PLC not reachable ($PLC_HOST)"
        fi

        # plc-sensor module
        if pgrep -f "plc_sensor.py" >/dev/null; then
            echo "  [OK] plc-sensor module running"
        else
            echo "  [!!] plc-sensor module NOT running"
        fi

        # Internet
        if ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1; then
            echo "  [OK] Internet connected"
        else
            echo "  [!!] No internet"
        fi

        # WiFi
        SSID=$(nmcli -t -f active,ssid dev wifi | grep '^yes' | cut -d: -f2)
        echo "  [--] WiFi: ${SSID:-not connected}"

        # Disk
        DISK_USE=$(df -h /home/andrew | awk 'NR==2{print $5}')
        echo "  [--] Disk usage: $DISK_USE"

        # Recent watchdog activity
        echo ""
        echo "── Recent IronSight activity ──"
        if [ -f "$WATCHDOG_LOG" ]; then
            tail -10 "$WATCHDOG_LOG" | sed 's/^/  /'
        else
            echo "  No activity yet."
        fi

        # Recent Claude fixes
        if [ -f "$FIX_LOG" ] && [ -s "$FIX_LOG" ]; then
            echo ""
            echo "── Recent fixes ──"
            tail -15 "$FIX_LOG" | sed 's/^/  /'
        fi

        echo ""
        echo "================================================"
        echo ""
        echo "  AI watchdog paused. You're in control."
        echo "  Run 'ironsight on' when you're done."
        echo ""
        read -p "  Launch interactive session? (y/n): " ANSWER

        if [[ "$ANSWER" =~ ^[Yy] ]]; then
            echo ""
            echo "  Starting IronSight interactive mode..."
            echo "  Type /exit when done."
            echo ""

            cd "$PROJECT_DIR" || exit 1

            REPORT=$(cat <<ENDREPORT
You are IronSight, an AI-powered monitoring and self-healing system for TPS (Tie Plate System) equipment on railroad trucks.
You are running on a Raspberry Pi 5 connected to a Click PLC C0-10DD2E-D via Modbus TCP.
Andrew has taken manual control and wants to talk to you.

CURRENT SYSTEM STATE:
- viam-server: $(systemctl is-active viam-server)
- PLC ($PLC_HOST): $(timeout 3 bash -c "echo >/dev/tcp/$PLC_HOST/$PLC_PORT" 2>/dev/null && echo "reachable" || echo "unreachable")
- plc-sensor: $(pgrep -f plc_sensor.py >/dev/null && echo "running" || echo "not running")
- Internet: $(ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1 && echo "connected" || echo "disconnected")
- WiFi: ${SSID:-not connected}
- Disk: $DISK_USE

RECENT WATCHDOG LOG (last 10 entries):
$(tail -10 "$WATCHDOG_LOG" 2>/dev/null || echo "No logs")

RECENT FIXES:
$(tail -20 "$FIX_LOG" 2>/dev/null || echo "No fixes recorded")

INCIDENT HISTORY (past problems and what worked):
$(cat "$PROJECT_DIR"/scripts/incidents/*.md 2>/dev/null | tail -100 || echo "No incidents recorded yet")

You learn from past incidents. If you see a pattern (same issue recurring), proactively suggest a permanent fix.

Andrew may ask you questions about the system, request changes, or ask you to investigate something.
If he asks for code changes, make them properly — commit to a branch, create a PR. Never push directly to main.
You have full access to the project, logs, PLC test scripts, and system services.
When you identify something new worth remembering, write it to scripts/incidents/ so future runs can learn from it.
ENDREPORT
)
            /usr/local/bin/claude --system-prompt "$REPORT"
        fi
        ;;
    chat)
        echo ""
        echo "  ╔══════════════════════════════════════════╗"
        echo "  ║       IRONSIGHT — INTERACTIVE MODE       ║"
        echo "  ╚══════════════════════════════════════════╝"
        echo ""
        if [ -f "$MAINTENANCE_FLAG" ]; then
            echo "  Watchdog: OFF (manual control)"
        else
            echo "  Watchdog: ON (still monitoring)"
        fi
        echo "  Type /exit when done."
        echo ""

        SSID=$(nmcli -t -f active,ssid dev wifi | grep '^yes' | cut -d: -f2)
        DISK_USE=$(df -h /home/andrew | awk 'NR==2{print $5}')

        cd "$PROJECT_DIR" || exit 1

        REPORT=$(cat <<ENDREPORT
You are IronSight, an AI-powered monitoring and self-healing system for TPS (Tie Plate System) equipment on railroad trucks.
You are running on a Raspberry Pi 5 connected to a Click PLC C0-10DD2E-D via Modbus TCP.
The watchdog is $([ -f "$MAINTENANCE_FLAG" ] && echo "PAUSED (maintenance mode)" || echo "ACTIVE (still monitoring in the background)").

CURRENT SYSTEM STATE:
- viam-server: $(systemctl is-active viam-server)
- PLC ($PLC_HOST): $(timeout 3 bash -c "echo >/dev/tcp/$PLC_HOST/$PLC_PORT" 2>/dev/null && echo "reachable" || echo "unreachable")
- plc-sensor: $(pgrep -f plc_sensor.py >/dev/null && echo "running" || echo "not running")
- Internet: $(ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1 && echo "connected" || echo "disconnected")
- WiFi: ${SSID:-not connected}
- Disk: $DISK_USE

RECENT WATCHDOG LOG (last 10 entries):
$(tail -10 "$WATCHDOG_LOG" 2>/dev/null || echo "No logs")

RECENT FIXES:
$(tail -20 "$FIX_LOG" 2>/dev/null || echo "No fixes recorded")

INCIDENT HISTORY (past problems and what worked):
$(cat "$PROJECT_DIR"/scripts/incidents/*.md 2>/dev/null | tail -100 || echo "No incidents recorded yet")

You learn from past incidents. If you see a pattern (same issue recurring), proactively suggest a permanent fix.

Andrew may ask you questions about the system, request changes, or ask you to investigate something.
If he asks for code changes, make them properly — commit to a branch, create a PR. Never push directly to main.
You have full access to the project, logs, PLC test scripts, and system services.
When you identify something new worth remembering, write it to scripts/incidents/ so future runs can learn from it.
ENDREPORT
)
        /usr/local/bin/claude --system-prompt "$REPORT"
        ;;
    status)
        if [ -f "$MAINTENANCE_FLAG" ]; then
            echo ""
            echo "  IRONSIGHT: OFF (manual control)"
        else
            echo ""
            echo "  IRONSIGHT: ON (AI monitoring active)"
        fi
        echo ""
        ;;
    *)
        echo "Usage: ironsight [on|off|status|chat]"
        ;;
esac
