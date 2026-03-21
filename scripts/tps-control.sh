#!/bin/bash
# IronSight — AI-powered TPS monitoring and self-healing
# Usage: ironsight [on|off|status|chat|dev|discover]

MAINTENANCE_FLAG="$HOME/.tps-maintenance"
PROJECT_DIR="$HOME/Viam-Staubli-Apera-PLC-Mobile-POC"
WATCHDOG_LOG="/var/log/tps-watchdog.log"
FIX_LOG="/var/log/claude-fixes.log"
PLC_HOST="169.168.10.21"
PLC_PORT=502
MEMORY_DIR="$HOME/.ironsight/memory"

# ── Load persistent memory for Claude context ──
load_memory() {
    local ctx=""
    if [ -d "$MEMORY_DIR" ]; then
        for f in "$MEMORY_DIR"/*.md; do
            [ -f "$f" ] || continue
            local label
            label=$(basename "$f" .md | tr '-' ' ' | sed 's/\b\(.\)/\u\1/g')
            ctx="${ctx}
## ${label}
$(cat "$f")

---
"
        done
    fi

    # Recent discovery events
    local events_file="$HOME/.ironsight/logs/events.jsonl"
    if [ -f "$events_file" ]; then
        local recent
        recent=$(tail -20 "$events_file" 2>/dev/null)
        if [ -n "$recent" ]; then
            ctx="${ctx}
## Recent Events (last 20)
${recent}
"
        fi
    fi

    # Known devices
    local devices_dir="$HOME/.ironsight/devices"
    if [ -d "$devices_dir" ] && ls "$devices_dir"/*.json >/dev/null 2>&1; then
        ctx="${ctx}
## Known Devices
"
        for f in "$devices_dir"/*.json; do
            [ -f "$f" ] || continue
            local name
            name=$(basename "$f" .json)
            ctx="${ctx}### ${name}
$(cat "$f")
"
        done
    fi

    if [ -n "$ctx" ]; then
        echo "
# IronSight Memory (persistent across sessions — you can update these)
# Memory dir: $MEMORY_DIR
# To remember something new: append to the appropriate .md file
# To update a device: write JSON to ~/.ironsight/devices/
$ctx"
    fi
}

MEMORY_CONTEXT=$(load_memory)

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
When you learn something worth remembering across sessions, append it to the appropriate file in $MEMORY_DIR/.

$MEMORY_CONTEXT
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
When you learn something worth remembering across sessions, append it to the appropriate file in $MEMORY_DIR/.

$MEMORY_CONTEXT
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
    discover)
        echo ""
        echo "  ╔══════════════════════════════════════════════════════════════╗"
        echo "  ║  🔍 IRONSIGHT — DISCOVERY MODE                              ║"
        echo "  ║  Find, connect, and reverse-engineer unknown PLCs           ║"
        echo "  ╚══════════════════════════════════════════════════════════════╝"
        echo ""

        DISCOVER_SCRIPT="$PROJECT_DIR/scripts/ironsight-discover.py"
        HANDOFF_FILE="/tmp/ironsight-discovery-briefing"

        # Clean up any previous handoff
        rm -f "$HANDOFF_FILE"

        # Pass through any additional arguments
        shift
        sudo python3 "$DISCOVER_SCRIPT" "$@"

        # If discovery completed and wrote a briefing, hand off to Claude
        if [ -f "$HANDOFF_FILE" ]; then
            BRIEFING_PATH=$(cat "$HANDOFF_FILE")
            rm -f "$HANDOFF_FILE"

            if [ -f "$BRIEFING_PATH" ]; then
                BRIEFING=$(cat "$BRIEFING_PATH")

                cd "$PROJECT_DIR" || exit 1

                REPORT=$(cat <<ENDREPORT
You are IronSight. You just finished scanning an unknown PLC and now you're reporting back to Andrew and his team.

Talk like their IT guy who just got back from inspecting the equipment. Be direct, plain English, no jargon unless you explain it. They're smart — they understand machines, wiring, things they can see and touch. Translate register numbers into what they probably do on the machine.

If you're not sure what a register does, say so honestly, and then search the internet for documentation — look up the PLC model, Mitsubishi register maps, MC Protocol device memory layouts, whatever helps. Tell them what you found and what you're still figuring out.

You have full internet access. Use it. Look things up. Come back with answers.

HERE IS WHAT YOU FOUND:

$BRIEFING

YOUR JOB NOW:
1. Start by giving them the plain-English summary — what you found, what it is, what it's doing, what you don't know yet.
2. If there are registers you couldn't classify, search the internet for the PLC model's documentation and try to identify them.
3. Answer their questions. They'll want to know things like "what does that counter track?" or "is that the same as what the Click PLC does?"
4. If they want you to start monitoring this PLC, you can help build the sensor module for it.

Keep it conversational. You're their guy on the ground who just plugged in and figured it out.
ENDREPORT
)
                echo ""
                echo "  ╔══════════════════════════════════════════════════════════════╗"
                echo "  ║  IRONSIGHT — DISCOVERY REPORT                               ║"
                echo "  ║  Ask me anything about what I found.                        ║"
                echo "  ╚══════════════════════════════════════════════════════════════╝"
                echo ""

                /usr/local/bin/claude --system-prompt "$REPORT"
            fi
        fi
        ;;
    dev)
        echo ""
        echo "  ╔══════════════════════════════════════════╗"
        echo "  ║       IRONSIGHT — DEVELOPER MODE         ║"
        echo "  ╚══════════════════════════════════════════╝"
        echo ""

        SSID=$(nmcli -t -f active,ssid dev wifi | grep '^yes' | cut -d: -f2)
        DISK_USE=$(df -h /home/andrew | awk 'NR==2{print $5}')

        cd "$PROJECT_DIR" || exit 1

        # Gather git state
        GIT_BRANCH=$(git branch --show-current 2>/dev/null)
        GIT_STATUS=$(git status --short 2>/dev/null)
        GIT_LOG=$(git log --oneline -10 2>/dev/null)
        OPEN_BRANCHES=$(git branch -a --no-merged main 2>/dev/null | head -10)
        OPEN_PRS=$(gh pr list --state open 2>/dev/null || echo "Could not fetch PRs (no internet or gh not authed)")

        # Gather system state
        VIAM_STATUS=$(systemctl is-active viam-server 2>/dev/null)
        PLC_STATUS=$(timeout 3 bash -c "echo >/dev/tcp/$PLC_HOST/$PLC_PORT" 2>/dev/null && echo "reachable" || echo "unreachable")
        MODULE_STATUS=$(pgrep -f plc_sensor.py >/dev/null && echo "running" || echo "not running")
        INET_STATUS=$(ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1 && echo "connected" || echo "disconnected")
        ETH0_STATUS=$(cat /sys/class/net/eth0/carrier 2>/dev/null || echo "unknown")

        # Gather recent errors if any
        RECENT_ERRORS=$(journalctl -u viam-server --since "30 min ago" --no-pager 2>/dev/null | grep -ci "error" || echo 0)

        # Gather viam-server module list
        MODULE_LIST=$(journalctl -u viam-server --since "1 hour ago" --no-pager 2>/dev/null | grep -i "module" | tail -5)

        # Show quick status before dropping into session
        echo "  Branch:   $GIT_BRANCH"
        echo "  PLC:      $PLC_STATUS"
        echo "  viam:     $VIAM_STATUS"
        echo "  Internet: $INET_STATUS"
        echo "  WiFi:     ${SSID:-not connected}"
        echo ""
        if [ -n "$OPEN_BRANCHES" ]; then
            echo "  Open branches:"
            echo "$OPEN_BRANCHES" | sed 's/^/    /'
            echo ""
        fi
        echo "  Say what you need. Type /exit when done."
        echo ""

        REPORT=$(cat <<ENDREPORT
You are IronSight in developer mode. You are Andrew's development partner for the TPS monitoring system.

Andrew describes what he wants in plain English. You handle the implementation — writing code, creating branches, making PRs, debugging, testing, researching, looking things up online. You have full access to the codebase, the Pi, system services, and the internet.

RULES:
- Never push directly to main. Always branch and PR.
- When Andrew says "do it" or "go ahead" — that means implement it, don't just describe it.
- When something needs research, use the internet. Look up docs, APIs, forum posts, whatever.
- Be direct. Skip the preamble. Andrew knows the system.
- If you need to know something about the machine that the code can't tell you, ask.
- When you finish a task, say what you did and what's next. Don't wait to be asked.

PROJECT STATE:
- Branch: $GIT_BRANCH
- Recent commits:
$GIT_LOG

- Uncommitted changes:
${GIT_STATUS:-clean}

- Unmerged branches:
${OPEN_BRANCHES:-none}

- Open PRs:
$OPEN_PRS

SYSTEM STATE:
- viam-server: $VIAM_STATUS
- PLC ($PLC_HOST): $PLC_STATUS
- eth0 carrier: $ETH0_STATUS
- plc-sensor module: $MODULE_STATUS
- Internet: $INET_STATUS
- WiFi: ${SSID:-not connected}
- Disk: $DISK_USE
- Errors (last 30min): $RECENT_ERRORS

RECENT WATCHDOG LOG:
$(tail -10 "$WATCHDOG_LOG" 2>/dev/null || echo "No logs")

RECENT FIXES:
$(tail -10 "$FIX_LOG" 2>/dev/null || echo "No fixes")

KEY FILES:
- modules/plc-sensor/src/plc_sensor.py — Core sensor module
- dashboard/components/Dashboard.tsx — Main dashboard
- dashboard/components/PlcDetailPanel.tsx — Detail panel
- dashboard/components/DiagnosticsPanel.tsx — Diagnostics
- dashboard/lib/sensors.ts — Sensor field definitions
- dashboard/app/api/sensor-readings/route.ts — API proxy
- scripts/watchdog.sh — Watchdog cron job
- scripts/tps-control.sh — IronSight CLI (this file)
- scripts/ironsight-discover.py — PLC discovery tool (local only, not committed)
- config/viam-server.json — Local viam config
- config/fragment-tps-truck.json — Fleet template

DEPLOYED:
- Dashboard: viam-staubli-apera-plc-mobile-poc.vercel.app (auto-deploys on push)
- Module: /opt/viam-modules/plc-sensor/ (symlinked to repo, restart viam-server after changes)
- Watchdog: cron every 5 min (scripts/watchdog.sh)

Andrew is the system architect. He thinks about what the railroad needs. You think about how to make the computer do it. Don't make him context-switch into implementation details unless he asks.

When you learn something worth remembering across sessions, append it to the appropriate file in $MEMORY_DIR/.

$MEMORY_CONTEXT
ENDREPORT
)
        /usr/local/bin/claude --system-prompt "$REPORT"
        ;;
    daemon)
        case "${2:-status}" in
            start)
                echo "  Starting IronSight Discovery Daemon..."
                sudo systemctl start ironsight-discovery-daemon
                sudo systemctl status ironsight-discovery-daemon --no-pager
                ;;
            stop)
                echo "  Stopping IronSight Discovery Daemon..."
                sudo systemctl stop ironsight-discovery-daemon
                ;;
            restart)
                echo "  Restarting IronSight Discovery Daemon..."
                sudo systemctl restart ironsight-discovery-daemon
                sudo systemctl status ironsight-discovery-daemon --no-pager
                ;;
            install)
                echo "  Installing IronSight Discovery Daemon..."
                sudo cp "$PROJECT_DIR/config/ironsight-discovery-daemon.service" /etc/systemd/system/
                sudo systemctl daemon-reload
                sudo systemctl enable ironsight-discovery-daemon
                echo "  Installed. Run 'ironsight daemon start' to start."
                ;;
            log)
                journalctl -u ironsight-discovery-daemon -f --no-pager
                ;;
            events)
                echo "  Recent discovery events:"
                echo ""
                python3 "$PROJECT_DIR/scripts/lib/ironsight_memory.py" events
                ;;
            devices)
                echo "  Known devices:"
                echo ""
                python3 "$PROJECT_DIR/scripts/lib/ironsight_memory.py" devices
                ;;
            status|*)
                if systemctl is-active --quiet ironsight-discovery-daemon 2>/dev/null; then
                    echo "  Discovery Daemon: RUNNING"
                else
                    echo "  Discovery Daemon: STOPPED"
                fi
                echo ""
                echo "  Usage: ironsight daemon [start|stop|restart|install|log|events|devices]"
                ;;
        esac
        ;;
    memory)
        case "${2:-show}" in
            show|context)
                python3 "$PROJECT_DIR/scripts/lib/ironsight_memory.py" context
                ;;
            seed)
                python3 "$PROJECT_DIR/scripts/lib/ironsight_memory.py" seed
                echo "  Memory seed files created at $MEMORY_DIR/"
                ;;
            *)
                echo "  Usage: ironsight memory [show|seed]"
                ;;
        esac
        ;;
    *)
        echo "Usage: ironsight [on|off|status|chat|dev|discover|daemon|memory]"
        ;;
esac
