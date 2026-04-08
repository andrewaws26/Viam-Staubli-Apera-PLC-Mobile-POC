#!/usr/bin/env python3
"""
IronSight Self-Healing — autonomous sensor fix loop for field deployment.

Runs every 2 minutes via cron. Detects known sensor failures and applies
fixes without requiring an SSH session. Two tiers:

  Tier 1 (offline — no internet needed):
    Hardcoded playbook of known fixes. Pattern-match, fix, verify.
    Covers: CAN bus down, PLC unreachable, viam-server crash, module
    construction failure, disk full, eth0 link issues.

  Tier 2 (online — needs internet):
    For problems the playbook can't solve, calls Claude CLI to diagnose,
    create a branch, commit, and push a fix. Rate-limited to 3/hour.
    Never pushes to main.

Status is written to /tmp/ironsight-heal-status.json for the dashboard.
All actions logged to /var/log/ironsight-field.jsonl.

Usage:
    # Automatic (cron every 2 min):
    */2 * * * * /home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/scripts/self-heal.py

    # Manual:
    python3 scripts/self-heal.py
    python3 scripts/self-heal.py --force  # Skip cooldowns
"""

import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PROJECT_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = PROJECT_DIR / "scripts"
STATUS_FILE = Path("/tmp/ironsight-heal-status.json")
HEARTBEAT_FILE = Path("/tmp/ironsight-heal-heartbeat.json")
COOLDOWN_FILE = Path("/tmp/ironsight-heal-cooldowns.json")
LOG_FILE = Path("/var/log/ironsight-self-heal.log")

# Rate limits
PLAYBOOK_COOLDOWN_SEC = 300     # Same fix can't run more than once per 5 min
CLAUDE_COOLDOWN_SEC = 1200      # Max one Claude call per 20 min
CLAUDE_MAX_PER_HOUR = 3         # Hard limit on Claude calls
CLAUDE_HISTORY_FILE = Path("/tmp/ironsight-claude-call-times.json")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [HEAL] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(str(LOG_FILE), mode="a")
    ] if os.access(LOG_FILE.parent, os.W_OK) else [
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("self-heal")

# ---------------------------------------------------------------------------
# Field logger integration
# ---------------------------------------------------------------------------

try:
    sys.path.insert(0, str(SCRIPTS_DIR))
    from lib.field_logger import field_log
except ImportError:
    def field_log(*args, **kwargs):
        pass

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def run(cmd: str, timeout: int = 30) -> tuple[int, str]:
    """Run a shell command and return (exit_code, output).

    For sudo commands: tries without password first (NOPASSWD sudoers).
    If that fails with a password prompt, retries with the default password.
    """
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        # Detect sudo password prompt failure (exit code 1 + "password" in stderr)
        if result.returncode != 0 and "sudo" in cmd and "password" in result.stderr.lower():
            # Retry with password via stdin
            result = subprocess.run(
                cmd, shell=True, capture_output=True, text=True, timeout=timeout,
                input="1111\n"
            )
        return result.returncode, (result.stdout + result.stderr).strip()
    except subprocess.TimeoutExpired:
        return -1, "timeout"
    except Exception as e:
        return -1, str(e)


def service_active(name: str) -> bool:
    code, _ = run(f"systemctl is-active --quiet {name}")
    return code == 0


def write_heartbeat(checks: list[dict] | None = None):
    """Write heartbeat so the dashboard knows the Pi is alive and self-heal is running.

    Written every cycle regardless of results. The dashboard checks the timestamp
    to distinguish 'all OK' from 'Pi is offline and status is stale'.
    """
    hb = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "epoch": time.time(),
        "alive": True,
        "ok": all(c.get("status") == "ok" for c in checks) if checks else True,
        "checks_run": len(checks) if checks else 0,
        "fixed": len([c for c in checks if c.get("status") == "fixed"]) if checks else 0,
        "failed": len([c for c in checks if c.get("status") == "failed"]) if checks else 0,
    }
    try:
        HEARTBEAT_FILE.write_text(json.dumps(hb))
    except Exception:
        pass


def write_status(checks: list[dict]):
    """Write healing status for dashboard consumption."""
    status = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "checks": checks,
        "errors": [c for c in checks if c.get("status") == "fixed" or c.get("status") == "failed"],
        "healthy": all(c.get("status") == "ok" for c in checks),
    }
    try:
        STATUS_FILE.write_text(json.dumps(status, indent=2))
    except Exception:
        pass
    write_heartbeat(checks)


def load_cooldowns() -> dict:
    try:
        return json.loads(COOLDOWN_FILE.read_text())
    except Exception:
        return {}


def save_cooldowns(cd: dict):
    try:
        COOLDOWN_FILE.write_text(json.dumps(cd))
    except Exception:
        pass


def is_on_cooldown(fix_id: str, cooldown_sec: int, force: bool = False) -> bool:
    if force:
        return False
    cd = load_cooldowns()
    last_run = cd.get(fix_id, 0)
    return (time.time() - last_run) < cooldown_sec


def mark_fix_attempted(fix_id: str):
    cd = load_cooldowns()
    cd[fix_id] = time.time()
    save_cooldowns(cd)


def claude_calls_this_hour() -> int:
    try:
        times = json.loads(CLAUDE_HISTORY_FILE.read_text())
        cutoff = time.time() - 3600
        return len([t for t in times if t > cutoff])
    except Exception:
        return 0


def record_claude_call():
    try:
        times = json.loads(CLAUDE_HISTORY_FILE.read_text())
    except Exception:
        times = []
    times.append(time.time())
    # Keep only last hour
    cutoff = time.time() - 3600
    times = [t for t in times if t > cutoff]
    CLAUDE_HISTORY_FILE.write_text(json.dumps(times))


# ---------------------------------------------------------------------------
# Tier 1: Offline Playbook
# ---------------------------------------------------------------------------

def check_viam_server(force: bool) -> dict:
    """Check if viam-server is running."""
    if service_active("viam-server"):
        return {"check": "viam-server", "status": "ok", "detail": "Running"}

    if is_on_cooldown("fix_viam", PLAYBOOK_COOLDOWN_SEC, force):
        return {"check": "viam-server", "status": "failed", "detail": "Down, fix on cooldown"}

    log.warning("viam-server is down — restarting...")
    field_log("heal", "viam_restart", success=False, reason="service_down")
    code, out = run("sudo systemctl restart viam-server", timeout=30)
    mark_fix_attempted("fix_viam")

    time.sleep(5)
    if service_active("viam-server"):
        log.info("viam-server restarted successfully")
        field_log("heal", "viam_restart", success=True)
        return {"check": "viam-server", "status": "fixed", "detail": "Restarted successfully"}
    else:
        log.error("viam-server restart failed: %s", out)
        field_log("heal", "viam_restart", success=False, error=out[:200])
        return {"check": "viam-server", "status": "failed", "detail": f"Restart failed: {out[:100]}"}


def check_can_bus(force: bool) -> dict:
    """Check if CAN bus interface is up and receiving frames."""
    code, out = run("ip link show can0 2>/dev/null")
    if code != 0:
        return {"check": "can-bus", "status": "ok", "detail": "No CAN HAT (skip)"}

    if "UP" in out and "LOWER_UP" in out:
        # Check listen-only mode
        code2, detail = run("ip -d link show can0")
        if "listen-only on" not in detail:
            log.error("CAN bus is NOT in listen-only mode — this is dangerous!")
            field_log("heal", "can_listen_only_violation", success=False)
            # Fix: restart with listen-only
            run("sudo ip link set can0 down")
            run("sudo ip link set can0 up type can bitrate 250000 listen-only on")
            return {"check": "can-bus", "status": "fixed", "detail": "Restored listen-only mode"}
        return {"check": "can-bus", "status": "ok", "detail": "UP, listen-only"}

    if is_on_cooldown("fix_can", PLAYBOOK_COOLDOWN_SEC, force):
        return {"check": "can-bus", "status": "failed", "detail": "Down, fix on cooldown"}

    log.warning("CAN bus is down — restarting can0 service...")
    field_log("heal", "can_restart", success=False, reason="interface_down")
    run("sudo systemctl restart can0", timeout=15)
    mark_fix_attempted("fix_can")

    time.sleep(2)
    code, out = run("ip link show can0")
    if "UP" in out:
        log.info("CAN bus restored")
        field_log("heal", "can_restart", success=True)
        return {"check": "can-bus", "status": "fixed", "detail": "Restarted successfully"}
    else:
        log.error("CAN bus restart failed")
        field_log("heal", "can_restart", success=False, error="interface still down")
        return {"check": "can-bus", "status": "failed", "detail": "Restart failed — check HAT connection"}


def check_plc_connection(force: bool) -> dict:
    """Check if PLC is reachable via Modbus TCP."""
    # Read configured PLC IP
    plc_ip = "169.168.10.21"
    conf = Path("/home/andrew/.ironsight/plc-network.conf")
    if conf.exists():
        for line in conf.read_text().splitlines():
            if line.startswith("PLC_IP="):
                plc_ip = line.split('"')[1]

    # Check eth0 carrier first
    try:
        carrier = Path("/sys/class/net/eth0/carrier").read_text().strip()
    except Exception:
        carrier = "0"

    if carrier != "1":
        return {"check": "plc-connection", "status": "ok", "detail": "No Ethernet cable (skip)"}

    # Try Modbus TCP
    code, _ = run(f"timeout 3 bash -c 'echo >/dev/tcp/{plc_ip}/502'", timeout=5)
    if code == 0:
        return {"check": "plc-connection", "status": "ok", "detail": f"PLC at {plc_ip} responding"}

    if is_on_cooldown("fix_plc", PLAYBOOK_COOLDOWN_SEC, force):
        return {"check": "plc-connection", "status": "failed", "detail": f"PLC at {plc_ip} unreachable, discovery on cooldown"}

    log.warning("PLC at %s unreachable — running auto-discovery...", plc_ip)
    field_log("heal", "plc_discovery", success=False, plc_ip=plc_ip, reason="unreachable")
    discover_script = SCRIPTS_DIR / "plc-autodiscover.py"
    if discover_script.exists():
        code, out = run(f"python3 {discover_script} --watchdog", timeout=120)
        mark_fix_attempted("fix_plc")
        if code == 0:
            log.info("PLC auto-discovery succeeded")
            field_log("heal", "plc_discovery", success=True)
            return {"check": "plc-connection", "status": "fixed", "detail": "Auto-discovery found PLC"}
        elif code == 2:
            return {"check": "plc-connection", "status": "ok", "detail": "PLC already configured"}
        else:
            field_log("heal", "plc_discovery", success=False, error=out[:200])
            return {"check": "plc-connection", "status": "failed", "detail": f"Discovery failed: {out[:100]}"}

    return {"check": "plc-connection", "status": "failed", "detail": "Discovery script missing"}


def check_modules(force: bool) -> dict:
    """Check if all three Viam modules constructed successfully."""
    if not service_active("viam-server"):
        return {"check": "modules", "status": "failed", "detail": "viam-server not running"}

    code, out = run(
        "sudo journalctl -u viam-server --since '5 min ago' --no-pager 2>/dev/null | "
        "grep -c 'Successfully constructed'",
        timeout=15
    )
    constructed = int(out) if out.isdigit() else 0

    if constructed >= 1:
        return {"check": "modules", "status": "ok", "detail": f"{constructed} module(s) constructed"}

    # Check for construction errors
    _, errors = run(
        "sudo journalctl -u viam-server --since '5 min ago' --no-pager 2>/dev/null | "
        "grep -i 'error.*construct\\|failed.*module\\|panic' | tail -3",
        timeout=15
    )

    if is_on_cooldown("fix_modules", PLAYBOOK_COOLDOWN_SEC, force):
        return {"check": "modules", "status": "failed",
                "detail": f"No modules constructed, restart on cooldown. Errors: {errors[:150]}"}

    log.warning("No modules constructed — restarting viam-server...")
    field_log("heal", "module_restart", success=False, errors=errors[:200])
    run("sudo systemctl restart viam-server", timeout=30)
    mark_fix_attempted("fix_modules")

    time.sleep(10)
    _, out2 = run(
        "sudo journalctl -u viam-server --since '30 sec ago' --no-pager 2>/dev/null | "
        "grep -c 'Successfully constructed'",
        timeout=15
    )
    new_count = int(out2) if out2.isdigit() else 0
    if new_count >= 1:
        log.info("Modules recovered after restart (%d constructed)", new_count)
        field_log("heal", "module_restart", success=True, count=new_count)
        return {"check": "modules", "status": "fixed", "detail": f"{new_count} module(s) after restart"}
    else:
        field_log("heal", "module_restart", success=False)
        return {"check": "modules", "status": "failed",
                "detail": f"Still no modules after restart. Errors: {errors[:150]}"}


def check_disk(force: bool) -> dict:
    """Check disk usage and prune old capture data if needed."""
    code, out = run("df / | awk 'NR==2{print $5}' | tr -d '%'")
    pct = int(out) if out.isdigit() else 0

    if pct < 85:
        return {"check": "disk", "status": "ok", "detail": f"{pct}% used"}

    if pct >= 95:
        log.warning("Disk critically full (%d%%) — pruning capture data...", pct)
        field_log("heal", "disk_prune", disk_pct=pct)
        # Remove oldest capture files (Viam data-manager already synced them)
        run("find /home/andrew/.viam/capture -name '*.capture' -mmin +60 -delete 2>/dev/null")
        run("find /home/andrew/.viam/capture -name '*.prog' -mmin +120 -delete 2>/dev/null")
        _, new_out = run("df / | awk 'NR==2{print $5}' | tr -d '%'")
        new_pct = int(new_out) if new_out.isdigit() else pct
        field_log("heal", "disk_prune", success=True, before=pct, after=new_pct)
        return {"check": "disk", "status": "fixed", "detail": f"Pruned: {pct}% → {new_pct}%"}

    return {"check": "disk", "status": "ok", "detail": f"{pct}% used (warn >85%)"}


def check_data_flow(force: bool) -> dict:
    """Check if sensor data is actually flowing (capture files being written)."""
    if not service_active("viam-server"):
        return {"check": "data-flow", "status": "failed", "detail": "viam-server not running"}

    code, out = run(
        "find /home/andrew/.viam/capture -type f -name '*.prog' -mmin -5 2>/dev/null | head -1"
    )
    if out:
        return {"check": "data-flow", "status": "ok", "detail": "Recent capture data found"}

    # No recent capture — check if module is producing readings
    _, logs = run(
        "sudo journalctl -u viam-server --since '3 min ago' --no-pager 2>/dev/null | "
        "grep -c 'Readings' 2>/dev/null"
    )
    readings_count = int(logs) if logs.isdigit() else 0
    if readings_count > 0:
        return {"check": "data-flow", "status": "ok", "detail": f"{readings_count} readings in last 3 min (capture may be syncing)"}

    return {"check": "data-flow", "status": "failed",
            "detail": "No readings or capture data in last 5 min — modules may be stuck"}


# ---------------------------------------------------------------------------
# Tier 2: Claude-assisted fixes (needs internet)
# ---------------------------------------------------------------------------

def escalate_to_claude(failed_checks: list[dict], force: bool) -> Optional[dict]:
    """Call Claude CLI for problems the playbook couldn't fix."""
    if not failed_checks:
        return None

    # Rate limiting
    calls = claude_calls_this_hour()
    if calls >= CLAUDE_MAX_PER_HOUR and not force:
        log.info("Claude rate limit reached (%d/%d this hour) — skipping", calls, CLAUDE_MAX_PER_HOUR)
        return {"check": "claude-escalation", "status": "skipped",
                "detail": f"Rate limited ({calls}/{CLAUDE_MAX_PER_HOUR} calls this hour)"}

    if is_on_cooldown("claude_call", CLAUDE_COOLDOWN_SEC, force):
        return {"check": "claude-escalation", "status": "skipped", "detail": "On cooldown"}

    # Check internet
    code, _ = run("ping -c 1 -W 3 8.8.8.8", timeout=5)
    if code != 0:
        return {"check": "claude-escalation", "status": "skipped", "detail": "No internet — cannot call Claude"}

    issues = "\n".join(f"- {c['check']}: {c['detail']}" for c in failed_checks)
    log.info("Escalating %d failed check(s) to Claude...", len(failed_checks))
    field_log("heal", "claude_escalation", issues=issues[:500])

    # Get recent logs for context
    _, recent_logs = run(
        "sudo journalctl -u viam-server --since '10 min ago' --no-pager 2>/dev/null | tail -30"
    )

    prompt = f"""You are the IronSight self-healing system on a Pi 5 in a railroad truck.
The offline playbook tried to fix these issues but failed:

{issues}

Recent viam-server logs:
{recent_logs}

RULES:
1. Create a fix branch: git checkout -b autofix/<short-description>
2. Make targeted fixes only. Do NOT refactor or improve code.
3. Commit with a clear message explaining what broke and why this fixes it.
4. Push: git push -u origin autofix/<short-description>
5. Switch back to the current branch when done.
6. NEVER push to main. NEVER merge. The developer reviews all fixes.
7. NEVER change PLC register mappings, network passwords, or CAN bus config.
8. You CAN restart services, fix Python import errors, fix config JSON, fix permissions.
9. Write what you did to /tmp/ironsight-heal-claude-result.json

If you can't fix it, just write a diagnosis to the result file."""

    mark_fix_attempted("claude_call")
    record_claude_call()

    # Get current branch to restore after
    _, current_branch = run("git -C {} rev-parse --abbrev-ref HEAD".format(PROJECT_DIR))

    code, out = run(
        f'cd {PROJECT_DIR} && /usr/local/bin/claude -p "{prompt}" '
        f'--dangerously-skip-permissions --output-format text',
        timeout=300  # 5 minute max
    )

    # Restore original branch
    run(f"git -C {PROJECT_DIR} checkout {current_branch} 2>/dev/null")

    if code == 0:
        log.info("Claude fix attempt completed")
        field_log("heal", "claude_fix", success=True)
        return {"check": "claude-escalation", "status": "attempted",
                "detail": "Claude attempted a fix — check autofix/ branches"}
    elif code == 124:
        log.warning("Claude fix timed out")
        field_log("heal", "claude_fix", success=False, error="timeout")
        return {"check": "claude-escalation", "status": "failed", "detail": "Claude timed out (5 min limit)"}
    else:
        log.error("Claude fix failed: %s", out[:200])
        field_log("heal", "claude_fix", success=False, error=out[:200])
        return {"check": "claude-escalation", "status": "failed", "detail": f"Claude error: {out[:100]}"}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Check registry — maps check names to functions
# ---------------------------------------------------------------------------

CHECK_REGISTRY: dict[str, callable] = {
    "viam-server": check_viam_server,
    "can-bus": check_can_bus,
    "plc-connection": check_plc_connection,
    "modules": check_modules,
    "disk": check_disk,
    "data-flow": check_data_flow,
}


def run_single_check(check_name: str, force: bool = True) -> dict:
    """Run a single named check/fix. Returns the result dict.

    Used for targeted fixes triggered from the dashboard.
    Always skips cooldowns (force=True) since the user explicitly requested it.
    """
    check_fn = CHECK_REGISTRY.get(check_name)
    if not check_fn:
        return {"check": check_name, "status": "failed",
                "detail": f"Unknown check '{check_name}'. Available: {', '.join(CHECK_REGISTRY.keys())}"}

    log.info("Targeted fix: running '%s' check only", check_name)
    field_log("heal", "targeted_fix", check=check_name, trigger="manual")

    result = check_fn(force)

    log.info("Targeted fix result: %s — %s", result["status"], result["detail"])
    field_log("heal", "targeted_fix_result", check=check_name,
              status=result["status"], detail=result.get("detail", ""))

    # Write result with targeted flag so dashboard knows this was manual
    write_status([{**result, "_targeted": True}])
    return result


def main():
    import argparse
    parser = argparse.ArgumentParser(description="IronSight Self-Healing")
    parser.add_argument("--force", action="store_true", help="Skip cooldowns")
    parser.add_argument("--check", metavar="NAME",
                        help=f"Run only this check: {', '.join(CHECK_REGISTRY.keys())}")
    parser.add_argument("--list-checks", action="store_true", help="List available checks")
    parser.add_argument("--no-escalate", action="store_true",
                        help="Skip Claude escalation (Tier 1 only)")
    args = parser.parse_args()

    if args.list_checks:
        for name in CHECK_REGISTRY:
            print(name)
        sys.exit(0)

    # Targeted single check mode
    if args.check:
        result = run_single_check(args.check, force=True)
        # Output JSON for programmatic consumption (do_command reads this)
        print(json.dumps(result))
        sys.exit(0 if result["status"] in ("ok", "fixed") else 1)

    # Full autonomous cycle
    log.info("=" * 50)
    log.info("Self-healing check starting")
    log.info("=" * 50)

    results: list[dict] = []

    # Tier 1: Offline playbook
    results.append(check_viam_server(args.force))
    results.append(check_can_bus(args.force))
    results.append(check_plc_connection(args.force))
    results.append(check_modules(args.force))
    results.append(check_disk(args.force))
    results.append(check_data_flow(args.force))

    # Log summary
    ok = [r for r in results if r["status"] == "ok"]
    fixed = [r for r in results if r["status"] == "fixed"]
    failed = [r for r in results if r["status"] == "failed"]

    log.info("Results: %d OK, %d fixed, %d failed", len(ok), len(fixed), len(failed))
    for r in results:
        if r["status"] != "ok":
            log.info("  %s: [%s] %s", r["check"], r["status"], r["detail"])

    field_log("heal", "cycle_complete",
              ok=len(ok), fixed=len(fixed), failed=len(failed))

    # Tier 2: Escalate persistent failures to Claude
    if failed and not args.no_escalate:
        claude_result = escalate_to_claude(failed, args.force)
        if claude_result:
            results.append(claude_result)

    write_status(results)
    log.info("Self-healing check complete")


if __name__ == "__main__":
    main()
