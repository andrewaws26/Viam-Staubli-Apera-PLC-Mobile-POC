#!/bin/bash
# TPS Watchdog — checks system health, calls Claude to fix issues if needed
# Runs via cron every 5 minutes

MAINTENANCE_FLAG="$HOME/.tps-maintenance"
LOG="/var/log/tps-watchdog.log"
FIX_LOG="/var/log/claude-fixes.log"
PROJECT_DIR="$HOME/Viam-Staubli-Apera-PLC-Mobile-POC"
INCIDENTS_DIR="$PROJECT_DIR/scripts/incidents"
MAX_READING_AGE=300  # seconds — alert if no reading in 5 min
PLC_HOST="169.168.10.21"
PLC_PORT=502

timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

log() { echo "[$(timestamp)] $1" >> "$LOG"; }

# --- Maintenance mode check ---
if [ -f "$MAINTENANCE_FLAG" ]; then
    log "SKIP: Maintenance mode active (flag exists)"
    exit 0
fi

ISSUES=""

# --- Check 1: Is viam-server running? ---
if systemctl is-active --quiet viam-server; then
    log "OK: viam-server running"
else
    ISSUES="${ISSUES}viam-server is not running. "
    log "FAIL: viam-server not running"
fi

# --- Check 2: Is the PLC reachable on Modbus TCP? ---
if timeout 3 bash -c "echo >/dev/tcp/$PLC_HOST/$PLC_PORT" 2>/dev/null; then
    log "OK: PLC reachable at $PLC_HOST:$PLC_PORT"
else
    ISSUES="${ISSUES}PLC not reachable at $PLC_HOST:$PLC_PORT. "
    log "FAIL: PLC not reachable"
fi

# --- Check 3: Is the plc-sensor module process alive? ---
if pgrep -f "plc_sensor.py" >/dev/null; then
    log "OK: plc-sensor module running"
else
    ISSUES="${ISSUES}plc-sensor module process not found. "
    log "FAIL: plc-sensor module not running"
fi

# --- Check 4: Is data flowing? (check capture dir for recent files) ---
CAPTURE_DIR="$HOME/.viam/capture"
if [ -d "$CAPTURE_DIR" ]; then
    NEWEST=$(find "$CAPTURE_DIR" -type f -name "*.capture" -mmin -5 2>/dev/null | head -1)
    if [ -n "$NEWEST" ]; then
        log "OK: Recent capture data found"
    else
        ISSUES="${ISSUES}No capture data in last 5 minutes. "
        log "FAIL: No recent capture data"
    fi
else
    ISSUES="${ISSUES}Capture directory $CAPTURE_DIR does not exist. "
    log "FAIL: Capture directory missing"
fi

# --- Check 5: Are there recent errors in viam-server logs? ---
ERROR_COUNT=$(journalctl -u viam-server --since "5 min ago" --no-pager 2>/dev/null | grep -ci "error\|panic\|fatal" || echo 0)
if [ "$ERROR_COUNT" -gt 10 ]; then
    RECENT_ERRORS=$(journalctl -u viam-server --since "5 min ago" --no-pager 2>/dev/null | grep -i "error\|panic\|fatal" | tail -5)
    ISSUES="${ISSUES}High error rate in viam-server logs (${ERROR_COUNT} errors in 5 min): ${RECENT_ERRORS} "
    log "FAIL: $ERROR_COUNT errors in viam-server logs"
else
    log "OK: Error rate normal ($ERROR_COUNT in 5 min)"
fi

# --- Check 6: Is there internet connectivity? ---
if ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1; then
    log "OK: Internet connected"
else
    ISSUES="${ISSUES}No internet connectivity. "
    log "FAIL: No internet"
    # Can't call Claude without internet, just log and exit
    log "ABORT: Cannot call Claude without internet. Issues: $ISSUES"
    exit 1
fi

# --- If issues found, call Claude ---
if [ -n "$ISSUES" ]; then
    log "ISSUES DETECTED: $ISSUES"
    log "Calling Claude for auto-fix..."

    cd "$PROJECT_DIR" || exit 1

    # Gather past incidents for context
    PAST_INCIDENTS=""
    if [ -d "$INCIDENTS_DIR" ] && ls "$INCIDENTS_DIR"/*.md >/dev/null 2>&1; then
        PAST_INCIDENTS=$(cat "$INCIDENTS_DIR"/*.md 2>/dev/null | tail -200)
    fi

    INCIDENT_ID="$(date '+%Y%m%d-%H%M%S')"

    PROMPT="You are the TPS watchdog auto-fixer running on a Raspberry Pi 5 in a railroad truck.

ISSUES DETECTED:
$ISSUES

RECENT VIAM-SERVER LOGS:
$(journalctl -u viam-server --since '10 min ago' --no-pager 2>/dev/null | tail -30)

PAST INCIDENTS (learn from these — what worked before, what didn't):
$PAST_INCIDENTS

AFTER YOU DIAGNOSE AND ATTEMPT A FIX, you MUST write an incident report to:
$INCIDENTS_DIR/incident-$INCIDENT_ID.md

Use this exact format:
---
date: $(date '+%Y-%m-%d %H:%M:%S')
issues: <one-line summary>
root_cause: <what actually caused it>
fix_applied: <what you did, or 'none' if you couldn't fix it>
fix_worked: <true/false/unknown>
severity: <critical/warning/info>
tags: <comma-separated: e.g. viam-server, plc, network, module, disk>
---
<detailed notes — what you checked, what you saw, what you tried, what you learned>

This incident log is how you get smarter over time. Be specific. Future you will read this.

RULES — WHAT YOU CAN DO (no approval needed):
- Restart viam-server: sudo systemctl restart viam-server
- Restart networking: sudo systemctl restart NetworkManager
- Fix file permissions
- Clean up disk space in /home/andrew/.viam/capture if disk is full
- Restart the plc-sensor module

RULES — CODE CHANGES REQUIRE A PULL REQUEST:
- If the fix requires changing ANY code file (.py, .ts, .tsx, .json, .sh), you MUST:
  1. Create a new branch: git checkout -b watchdog/fix-<short-description>
  2. Make the changes on that branch
  3. Commit with a clear message explaining the problem and fix
  4. Push the branch: git push -u origin watchdog/fix-<short-description>
  5. Create a PR: gh pr create --title 'Watchdog: <description>' --body '<what broke and why this fixes it>'
  6. Do NOT merge the PR. Andrew must review and approve it.
  7. After creating the PR, switch back to main: git checkout main
- Do NOT commit directly to main
- Do NOT run git push on main
- Do NOT merge PRs

RULES — NEVER DO THESE:
- Do NOT change network passwords or WiFi configs
- Do NOT modify PLC register mappings or Modbus addresses
- Do NOT delete data files unless disk is critically full (>95%)

Log every action you take with timestamps.
Diagnose the issues and attempt safe fixes. Be conservative — if unsure, just log the problem and do not act."

    # Run Claude headless with timeout (5 min max)
    timeout 300 /usr/local/bin/claude -p "$PROMPT" --dangerously-skip-permissions --output-format text >> "$FIX_LOG" 2>&1
    RESULT=$?

    if [ $RESULT -eq 0 ]; then
        log "Claude fix attempt completed successfully"
    elif [ $RESULT -eq 124 ]; then
        log "Claude fix attempt timed out (5 min)"
    else
        log "Claude fix attempt exited with code $RESULT"
    fi
else
    log "ALL CHECKS PASSED"
fi
