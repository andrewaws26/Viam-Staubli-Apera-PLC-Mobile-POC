#!/usr/bin/env python3
"""
IronSight PLC Auto-Discovery -- Automatically find and connect to any Click PLC.

When plugged into a new truck with an unknown PLC IP, this script:
  1. Checks if the configured PLC IP works (fast path)
  2. Scans the eth0 link-local subnet
  3. Temporarily adds IPs on common PLC subnets and scans for Modbus port 502
  4. Validates by doing a test Modbus read (DS1-DS5)
  5. Updates system config: eth0 static IP, viam-server.json, watchdog.sh
  6. Restarts viam-server so the module reconnects

Can be triggered by:
  - NetworkManager dispatcher (eth0 link-up)
  - The watchdog (persistent PLC failure)
  - Manual: python3 scripts/plc-autodiscover.py

Exit codes:
  0 = PLC found and configured
  1 = No PLC found
  2 = PLC already reachable at configured IP (no change needed)
"""

import json
import logging
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional, Tuple

# Add scripts/ to path for lib imports
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.modbus_scanner import (
    probe_modbus_port,
    validate_plc,
    scan_subnet as modbus_scan_subnet,
    arp_scan_for_plc,
)
from lib.network_scanner import (
    check_eth0_carrier,
    get_eth0_ips,
    add_temp_ip,
    remove_temp_ip,
    cleanup_temp_ips,
    set_eth0_permanent_ip,
    find_windows_pcs,
    grab_files_from_pc,
)
from lib.field_logger import (
    field_log,
    log_discovery_result,
    log_eth0_event,
    log_plc_connection,
    FieldTimer,
)

# ─────────────────────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────────────────────

PROJECT_DIR = Path(__file__).resolve().parent.parent
VIAM_CONFIG = PROJECT_DIR / "config" / "viam-server.json"
WATCHDOG_SH = PROJECT_DIR / "scripts" / "watchdog.sh"
DISPATCHER_SCRIPT = Path("/etc/NetworkManager/dispatcher.d/10-plc-eth0-static")
STATUS_FILE = Path("/tmp/ironsight-status.json")
DISCOVERY_LOG = Path("/var/log/ironsight-discovery.log")

# Click PLC common default IPs
CLICK_DEFAULTS = [
    "192.168.1.2",
    "192.168.1.1",
    "192.168.0.2",
    "192.168.0.1",
    "10.0.0.2",
    "10.10.10.2",
]

# Subnets to scan if defaults don't hit (common industrial ranges)
SCAN_SUBNETS = [
    "169.168.10",    # our current config
    "192.168.1",     # Click PLC default
    "192.168.0",     # common
    "192.168.2",     # alternate
    "192.168.3",     # alternate
    "10.0.0",        # industrial
    "10.10.10",      # industrial
    "172.16.0",      # private
]

# ─────────────────────────────────────────────────────────────
#  Logging
# ─────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(str(DISCOVERY_LOG), mode="a"),
    ] if os.access(DISCOVERY_LOG.parent, os.W_OK) else [
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("ironsight-discover")


def _post_to_bus(phase: str, message: str, progress: int = -1,
                 plc_ip: str = None, success: bool = None):
    """Post to the IronSight status bus for the display."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from ironsight_status import post
        level = "success" if success is True else ("error" if success is False else "info")
        extra = {}
        if progress >= 0:
            extra["progress"] = progress
        post("discovery", phase, message, progress=progress,
             plc_ip=plc_ip, success=success, level=level, extra=extra)
    except Exception:
        pass


def write_status(phase: str, message: str, progress: int = 0,
                 plc_ip: Optional[str] = None, success: Optional[bool] = None):
    """Write current status to /tmp for the display script to read."""
    _post_to_bus(phase, message, progress, plc_ip, success)
    status = {
        "ts": time.time(),
        "phase": phase,
        "message": message,
        "progress": progress,
        "plc_ip": plc_ip,
        "success": success,
    }
    try:
        STATUS_FILE.write_text(json.dumps(status))
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────
#  Configuration updates
# ─────────────────────────────────────────────────────────────

def get_configured_plc_ip() -> str:
    """Read the currently configured PLC IP from viam-server.json."""
    try:
        config = json.loads(VIAM_CONFIG.read_text())
        for comp in config.get("components", []):
            if comp.get("name") == "plc-monitor":
                return comp["attributes"]["host"]
    except Exception:
        pass
    try:
        from lib.plc_constants import PLC_HOST
        return PLC_HOST
    except ImportError:
        return "169.168.10.21"


def update_viam_config(new_ip: str) -> bool:
    """Update the PLC host IP in viam-server.json."""
    try:
        config = json.loads(VIAM_CONFIG.read_text())
        for comp in config.get("components", []):
            if comp.get("name") == "plc-monitor":
                old_ip = comp["attributes"]["host"]
                if old_ip == new_ip:
                    log.info("  viam-server.json already has %s", new_ip)
                    return True
                comp["attributes"]["host"] = new_ip
                log.info("  Updated viam-server.json: %s -> %s", old_ip, new_ip)
        VIAM_CONFIG.write_text(json.dumps(config, indent=2) + "\n")
        return True
    except Exception as e:
        log.error("  Failed to update viam-server.json: %s", e)
        return False


def update_watchdog(new_ip: str) -> bool:
    """Update PLC_HOST in watchdog.sh."""
    try:
        content = WATCHDOG_SH.read_text()
        new_content = re.sub(
            r'PLC_HOST="[^"]*"',
            f'PLC_HOST="{new_ip}"',
            content
        )
        if new_content != content:
            WATCHDOG_SH.write_text(new_content)
            log.info("  Updated watchdog.sh PLC_HOST -> %s", new_ip)
        return True
    except Exception as e:
        log.error("  Failed to update watchdog.sh: %s", e)
        return False


def update_eth0_static(new_subnet: str, new_pi_ip: str) -> bool:
    """Update the NetworkManager dispatcher to use the new subnet."""
    try:
        new_content = f"""#!/bin/bash
# Ensure eth0 always has the PLC static IP when it comes up.
# Auto-updated by IronSight PLC auto-discovery.
INTERFACE="$1"
ACTION="$2"

if [ "$INTERFACE" = "eth0" ] && [ "$ACTION" = "up" ]; then
    if ! ip addr show eth0 | grep -q "{new_pi_ip}/24"; then
        logger -t plc-eth0 "eth0 came up without {new_pi_ip}/24 -- adding it"
        ip addr add {new_pi_ip}/24 dev eth0
    fi
    # Trigger PLC auto-discovery in background
    if [ -x "{PROJECT_DIR}/scripts/plc-autodiscover.py" ]; then
        nohup python3 "{PROJECT_DIR}/scripts/plc-autodiscover.py" --on-link-up >/dev/null 2>&1 &
    fi
fi
"""
        DISPATCHER_SCRIPT.write_text(new_content)
        subprocess.run(["chmod", "+x", str(DISPATCHER_SCRIPT)], check=True, timeout=5)
        log.info("  Updated eth0 dispatcher: Pi IP -> %s/24", new_pi_ip)
        return True
    except Exception as e:
        log.error("  Failed to update eth0 dispatcher: %s", e)
        return False


def restart_viam_server():
    """Restart viam-server to pick up new config."""
    log.info("  Restarting viam-server...")
    write_status("restarting", "Restarting viam-server...", 95)
    try:
        subprocess.run(
            ["systemctl", "restart", "viam-server"],
            check=True, capture_output=True, timeout=30
        )
        log.info("  > viam-server restarted")
    except Exception as e:
        log.error("  Failed to restart viam-server: %s", e)


# ─────────────────────────────────────────────────────────────
#  Main discovery logic
# ─────────────────────────────────────────────────────────────

def discover() -> Tuple[Optional[str], bool]:
    """
    Run the full PLC discovery sequence.

    Returns:
        (plc_ip, config_changed) -- the PLC IP if found, and whether config was updated
    """
    log.info("=" * 60)
    log.info("IronSight PLC Auto-Discovery starting")
    log.info("=" * 60)

    # -- Phase 0: Check eth0 carrier --
    if not check_eth0_carrier():
        log.warning("eth0 has no carrier (NO-CARRIER) -- cable not connected")
        write_status("no_link", "No Ethernet cable detected", 0, success=False)
        return None, False

    write_status("starting", "Ethernet link detected, starting discovery...", 5)
    log.info("> eth0 has carrier (physical link up)")

    # -- Phase 1: Fast path -- try configured IP first --
    configured_ip = get_configured_plc_ip()
    log.info("Phase 1: Trying configured IP %s...", configured_ip)
    write_status("configured", f"Trying configured IP {configured_ip}...", 10)

    configured_subnet = ".".join(configured_ip.split(".")[:3])
    add_temp_ip(configured_subnet)

    if probe_modbus_port(configured_ip) and validate_plc(configured_ip):
        log.info("> PLC reachable at configured IP %s -- no changes needed", configured_ip)
        write_status("connected", f"PLC connected at {configured_ip}", 100,
                     plc_ip=configured_ip, success=True)
        cleanup_temp_ips(keep_subnet=configured_subnet)
        return configured_ip, False

    log.info("> Configured IP %s not reachable", configured_ip)

    # -- Phase 2: Try Click PLC default IPs --
    log.info("Phase 2: Trying Click PLC default IPs...")
    write_status("defaults", "Trying known Click PLC default IPs...", 20)

    for i, default_ip in enumerate(CLICK_DEFAULTS):
        default_subnet = ".".join(default_ip.split(".")[:3])
        added_ip = add_temp_ip(default_subnet)
        if added_ip is None:
            continue

        log.info("  Trying %s...", default_ip)
        progress = 20 + (i * 5)
        write_status("defaults", f"Trying {default_ip}...", progress)

        if probe_modbus_port(default_ip) and validate_plc(default_ip):
            log.info("> Found PLC at default IP %s", default_ip)
            cleanup_temp_ips(keep_subnet=default_subnet)
            return default_ip, True

    # -- Phase 3: ARP scan --
    log.info("Phase 3: ARP scan for devices on eth0...")
    write_status("arp_scan", "Scanning for devices via ARP...", 40)

    arp_plc = arp_scan_for_plc(get_eth0_ips)
    if arp_plc:
        plc_subnet = ".".join(arp_plc.split(".")[:3])
        cleanup_temp_ips(keep_subnet=plc_subnet)
        return arp_plc, True

    # -- Phase 4: Full subnet scan --
    log.info("Phase 4: Full subnet scan (this may take a minute)...")
    for i, subnet in enumerate(SCAN_SUBNETS):
        progress = 50 + (i * 5)
        write_status("full_scan", f"Scanning {subnet}.0/24...", progress)

        added_ip = add_temp_ip(subnet)
        if added_ip is None:
            continue

        time.sleep(0.2)

        plc_ip = modbus_scan_subnet(subnet, get_eth0_ips, write_status, progress)
        if plc_ip:
            cleanup_temp_ips(keep_subnet=subnet)
            return plc_ip, True

    # -- Phase 5: No PLC -- check for Windows PCs --
    log.info("Phase 5: No PLC found -- scanning for Windows PCs...")
    write_status("windows", "No PLC found, looking for Windows PCs...", 50)

    pcs = find_windows_pcs(write_status)
    if pcs:
        for pc_ip in pcs:
            grabbed = grab_files_from_pc(pc_ip, write_status)
            if grabbed:
                log.info("> Grabbed files from Windows PC at %s", pc_ip)
                cleanup_temp_ips()
                return None, False

    # -- Nothing found --
    log.warning("> No PLC or Windows PC found on any subnet")
    write_status("not_found", "No PLC or PC found", 100, success=False)
    cleanup_temp_ips()
    return None, False


def save_plc_network_state(plc_ip: str, pi_ip: str, plc_subnet: str):
    """Save discovered PLC network config for fast restore on next boot."""
    state_dir = Path("/home/andrew/.ironsight")
    state_dir.mkdir(parents=True, exist_ok=True)
    state_file = state_dir / "plc-network.conf"
    state_file.write_text(
        f'# Auto-generated by plc-autodiscover.py — do not edit manually\n'
        f'# Last discovery: {time.strftime("%Y-%m-%d %H:%M:%S")}\n'
        f'PLC_IP="{plc_ip}"\n'
        f'PI_IP="{pi_ip}"\n'
        f'PLC_SUBNET="{plc_subnet}"\n'
    )
    log.info("  Saved PLC network state to %s", state_file)


def apply_config(plc_ip: str):
    """Apply the discovered PLC IP to all system configs."""
    plc_subnet = ".".join(plc_ip.split(".")[:3])
    plc_last_octet = int(plc_ip.split(".")[-1])

    pi_host_id = 1 if plc_last_octet != 1 else 250
    pi_ip = f"{plc_subnet}.{pi_host_id}"

    log.info("Applying configuration:")
    log.info("  PLC IP:  %s", plc_ip)
    log.info("  Pi IP:   %s/24", pi_ip)
    write_status("configuring", f"Configuring: PLC={plc_ip}, Pi={pi_ip}", 85)

    update_viam_config(plc_ip)
    update_watchdog(plc_ip)
    update_eth0_static(plc_subnet, pi_ip)
    set_eth0_permanent_ip(pi_ip)
    save_plc_network_state(plc_ip, pi_ip, plc_subnet)

    restart_viam_server()

    time.sleep(3)
    if probe_modbus_port(plc_ip) and validate_plc(plc_ip):
        log.info("=" * 60)
        log.info("> SUCCESS: PLC at %s is connected and responding", plc_ip)
        log.info("=" * 60)
        write_status("connected", f"PLC connected at {plc_ip}", 100,
                     plc_ip=plc_ip, success=True)
        return True
    else:
        log.warning("PLC at %s not responding after config -- module will retry", plc_ip)
        write_status("configured", f"Configured for {plc_ip}, waiting for module...", 100,
                     plc_ip=plc_ip, success=None)
        return True


# ─────────────────────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="IronSight PLC Auto-Discovery")
    parser.add_argument("--on-link-up", action="store_true",
                        help="Called by NetworkManager dispatcher on eth0 link-up")
    parser.add_argument("--watchdog", action="store_true",
                        help="Called by watchdog on persistent PLC failure")
    parser.add_argument("--force", action="store_true",
                        help="Force full scan even if configured IP works")
    args = parser.parse_args()

    trigger = "link_up" if args.on_link_up else ("watchdog" if args.watchdog else "manual")
    field_log("discovery", "started", trigger=trigger)
    log_eth0_event("discovery_triggered", ip_addresses=get_eth0_ips(), trigger=trigger)

    if args.on_link_up:
        log.info("Triggered by eth0 link-up, waiting 1s for link to stabilize...")
        time.sleep(1)

    t0 = time.monotonic()
    plc_ip, config_changed = discover()
    elapsed_ms = (time.monotonic() - t0) * 1000

    if plc_ip is None:
        log.warning("No PLC found. Will retry on next trigger.")
        log_discovery_result(None, method="full_scan", duration_ms=elapsed_ms,
                             subnets_scanned=len(SCAN_SUBNETS))
        sys.exit(1)

    if not config_changed and not args.force:
        log.info("PLC at %s -- already configured, no changes needed.", plc_ip)
        log_discovery_result(plc_ip, method="configured_ip", duration_ms=elapsed_ms,
                             config_changed=False)
        sys.exit(2)

    apply_config(plc_ip)
    total_ms = (time.monotonic() - t0) * 1000
    log_discovery_result(plc_ip, method="auto_discovery", duration_ms=total_ms,
                         subnets_scanned=len(SCAN_SUBNETS), config_changed=True)
    sys.exit(0)


if __name__ == "__main__":
    main()
