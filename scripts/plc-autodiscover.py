#!/usr/bin/env python3
"""
IronSight PLC Auto-Discovery — Automatically find and connect to any Click PLC.

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
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional, Tuple

# ─────────────────────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────────────────────

PROJECT_DIR = Path(__file__).resolve().parent.parent
VIAM_CONFIG = PROJECT_DIR / "config" / "viam-server.json"
WATCHDOG_SH = PROJECT_DIR / "scripts" / "watchdog.sh"
DISPATCHER_SCRIPT = Path("/etc/NetworkManager/dispatcher.d/10-plc-eth0-static")
STATUS_FILE = Path("/tmp/ironsight-status.json")
DISCOVERY_LOG = Path("/var/log/ironsight-discovery.log")

MODBUS_PORT = 502
SCAN_TIMEOUT = 0.3       # seconds per port probe
IFACE = "eth0"

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

# IPs to skip (our own IPs, broadcast, etc.)
SKIP_SUFFIX = {0, 255}

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
        # Import the status bus if available
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
#  Network helpers
# ─────────────────────────────────────────────────────────────

def check_eth0_carrier() -> bool:
    """Check if eth0 has physical link (carrier detected)."""
    try:
        carrier = Path(f"/sys/class/net/{IFACE}/carrier").read_text().strip()
        return carrier == "1"
    except Exception:
        return False


def get_eth0_ips() -> list[str]:
    """Get all IPv4 addresses currently assigned to eth0."""
    try:
        out = subprocess.check_output(
            ["ip", "-4", "addr", "show", IFACE],
            text=True, timeout=5
        )
        ips = []
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("inet "):
                # "inet 169.168.10.1/24 ..."
                addr = line.split()[1].split("/")[0]
                ips.append(addr)
        return ips
    except Exception:
        return []


def add_temp_ip(subnet: str, host_id: int = 250) -> Optional[str]:
    """Temporarily add an IP on the given subnet to eth0. Returns the IP added."""
    ip = f"{subnet}.{host_id}"

    # Don't add if we already have an IP on this subnet
    existing = get_eth0_ips()
    for eip in existing:
        if eip.startswith(subnet + "."):
            return eip  # already on this subnet

    try:
        subprocess.run(
            ["ip", "addr", "add", f"{ip}/24", "dev", IFACE],
            check=True, capture_output=True, timeout=5
        )
        log.info("  Added temporary IP %s/24 to %s", ip, IFACE)
        return ip
    except subprocess.CalledProcessError:
        # Might already exist or permission denied
        return None
    except Exception as e:
        log.warning("  Failed to add IP %s: %s", ip, e)
        return None


def remove_temp_ip(ip: str):
    """Remove a temporarily added IP from eth0."""
    try:
        subprocess.run(
            ["ip", "addr", "del", f"{ip}/24", "dev", IFACE],
            capture_output=True, timeout=5
        )
        log.debug("  Removed temporary IP %s from %s", ip, IFACE)
    except Exception:
        pass


def probe_modbus_port(host: str, port: int = MODBUS_PORT,
                      timeout: float = SCAN_TIMEOUT) -> bool:
    """Quick TCP connect to check if Modbus port is open."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception:
        return False


def validate_plc(host: str) -> bool:
    """Do a test Modbus read to confirm this is a real Click PLC."""
    try:
        from pymodbus.client import ModbusTcpClient
        client = ModbusTcpClient(host, port=MODBUS_PORT, timeout=2)
        if not client.connect():
            return False
        # Read DS1-DS5 (holding registers 0-4)
        result = client.read_holding_registers(address=0, count=5)
        client.close()
        if result.isError():
            return False
        # If we got 5 registers back, it's a real PLC
        return len(result.registers) == 5
    except Exception as e:
        log.debug("  Modbus validation failed for %s: %s", host, e)
        return False


def scan_subnet(subnet: str, progress_base: int = 0) -> Optional[str]:
    """Scan a /24 subnet for Modbus devices. Returns first PLC IP found."""
    log.info("  Scanning %s.0/24 for Modbus devices...", subnet)
    write_status("scanning", f"Scanning {subnet}.0/24...", progress_base)

    # First try common PLC addresses (speeds up discovery)
    priority_hosts = [1, 2, 10, 11, 20, 21, 30, 50, 100, 200]
    for host_id in priority_hosts:
        if host_id in SKIP_SUFFIX:
            continue
        ip = f"{subnet}.{host_id}"
        if ip in get_eth0_ips():
            continue  # skip our own IP
        if probe_modbus_port(ip):
            log.info("  ✓ Port 502 open on %s — validating...", ip)
            write_status("validating", f"Found port 502 on {ip}, validating...", progress_base + 5)
            if validate_plc(ip):
                log.info("  ✓ Confirmed Click PLC at %s", ip)
                return ip
            else:
                log.info("  ✗ %s has port 502 but is not a Click PLC", ip)

    # Full sweep of remaining addresses
    for host_id in range(1, 255):
        if host_id in SKIP_SUFFIX or host_id in priority_hosts:
            continue
        ip = f"{subnet}.{host_id}"
        if ip in get_eth0_ips():
            continue
        if probe_modbus_port(ip):
            log.info("  ✓ Port 502 open on %s — validating...", ip)
            if validate_plc(ip):
                log.info("  ✓ Confirmed Click PLC at %s", ip)
                return ip

    return None


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
                log.info("  Updated viam-server.json: %s → %s", old_ip, new_ip)
        VIAM_CONFIG.write_text(json.dumps(config, indent=2) + "\n")
        return True
    except Exception as e:
        log.error("  Failed to update viam-server.json: %s", e)
        return False


def update_watchdog(new_ip: str) -> bool:
    """Update PLC_HOST in watchdog.sh."""
    try:
        content = WATCHDOG_SH.read_text()
        import re
        new_content = re.sub(
            r'PLC_HOST="[^"]*"',
            f'PLC_HOST="{new_ip}"',
            content
        )
        if new_content != content:
            WATCHDOG_SH.write_text(new_content)
            log.info("  Updated watchdog.sh PLC_HOST → %s", new_ip)
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
        logger -t plc-eth0 "eth0 came up without {new_pi_ip}/24 — adding it"
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
        log.info("  Updated eth0 dispatcher: Pi IP → %s/24", new_pi_ip)
        return True
    except Exception as e:
        log.error("  Failed to update eth0 dispatcher: %s", e)
        return False


def set_eth0_permanent_ip(pi_ip: str):
    """Add the permanent static IP to eth0 (remove temps, add final)."""
    # Remove any existing IPs on eth0 that aren't the target
    existing = get_eth0_ips()
    for eip in existing:
        if eip != pi_ip:
            remove_temp_ip(eip)

    # Add the target IP if not already there
    if pi_ip not in get_eth0_ips():
        try:
            subprocess.run(
                ["ip", "addr", "add", f"{pi_ip}/24", "dev", IFACE],
                check=True, capture_output=True, timeout=5
            )
            log.info("  Set permanent eth0 IP: %s/24", pi_ip)
        except Exception as e:
            log.warning("  Could not set eth0 IP %s: %s", pi_ip, e)


def restart_viam_server():
    """Restart viam-server to pick up new config."""
    log.info("  Restarting viam-server...")
    write_status("restarting", "Restarting viam-server...", 95)
    try:
        subprocess.run(
            ["systemctl", "restart", "viam-server"],
            check=True, capture_output=True, timeout=30
        )
        log.info("  ✓ viam-server restarted")
    except Exception as e:
        log.error("  Failed to restart viam-server: %s", e)


def cleanup_temp_ips(keep_subnet: Optional[str] = None):
    """Remove all temporary IPs from eth0 except the one we want to keep."""
    existing = get_eth0_ips()
    for ip in existing:
        subnet = ".".join(ip.split(".")[:3])
        if keep_subnet and subnet == keep_subnet:
            continue
        # Only remove IPs we added (ending in .250)
        if ip.endswith(".250"):
            remove_temp_ip(ip)


# ─────────────────────────────────────────────────────────────
#  Main discovery logic
# ─────────────────────────────────────────────────────────────

def discover() -> Tuple[Optional[str], bool]:
    """
    Run the full PLC discovery sequence.

    Returns:
        (plc_ip, config_changed) — the PLC IP if found, and whether config was updated
    """
    log.info("=" * 60)
    log.info("IronSight PLC Auto-Discovery starting")
    log.info("=" * 60)

    # ── Phase 0: Check eth0 carrier ──
    if not check_eth0_carrier():
        log.warning("eth0 has no carrier (NO-CARRIER) — cable not connected")
        write_status("no_link", "No Ethernet cable detected", 0, success=False)
        return None, False

    write_status("starting", "Ethernet link detected, starting discovery...", 5)
    log.info("✓ eth0 has carrier (physical link up)")

    # ── Phase 1: Fast path — try configured IP first ──
    configured_ip = get_configured_plc_ip()
    log.info("Phase 1: Trying configured IP %s...", configured_ip)
    write_status("configured", f"Trying configured IP {configured_ip}...", 10)

    # Make sure we have an IP on the configured subnet
    configured_subnet = ".".join(configured_ip.split(".")[:3])
    add_temp_ip(configured_subnet)

    if probe_modbus_port(configured_ip) and validate_plc(configured_ip):
        log.info("✓ PLC reachable at configured IP %s — no changes needed", configured_ip)
        write_status("connected", f"PLC connected at {configured_ip}", 100,
                     plc_ip=configured_ip, success=True)
        cleanup_temp_ips(keep_subnet=configured_subnet)
        return configured_ip, False

    log.info("✗ Configured IP %s not reachable", configured_ip)

    # ── Phase 2: Try Click PLC default IPs ──
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
            log.info("✓ Found PLC at default IP %s", default_ip)
            cleanup_temp_ips(keep_subnet=default_subnet)
            return default_ip, True

    # ── Phase 3: ARP scan — look for any device that appeared on eth0 ──
    log.info("Phase 3: ARP scan for devices on eth0...")
    write_status("arp_scan", "Scanning for devices via ARP...", 40)

    arp_plc = arp_scan_for_plc()
    if arp_plc:
        plc_subnet = ".".join(arp_plc.split(".")[:3])
        cleanup_temp_ips(keep_subnet=plc_subnet)
        return arp_plc, True

    # ── Phase 4: Full subnet scan ──
    log.info("Phase 4: Full subnet scan (this may take a minute)...")
    for i, subnet in enumerate(SCAN_SUBNETS):
        progress = 50 + (i * 5)
        write_status("full_scan", f"Scanning {subnet}.0/24...", progress)

        added_ip = add_temp_ip(subnet)
        if added_ip is None:
            continue

        # Brief pause for ARP to populate
        time.sleep(0.2)

        plc_ip = scan_subnet(subnet, progress)
        if plc_ip:
            cleanup_temp_ips(keep_subnet=subnet)
            return plc_ip, True

    # ── Phase 5: No PLC — check for Windows PCs ──
    log.info("Phase 5: No PLC found — scanning for Windows PCs...")
    write_status("windows", "No PLC found, looking for Windows PCs...", 50)

    pcs = find_windows_pcs()
    if pcs:
        for pc_ip in pcs:
            grabbed = grab_files_from_pc(pc_ip)
            if grabbed:
                log.info("✓ Grabbed files from Windows PC at %s", pc_ip)
                # Don't return PLC IP since we didn't find one
                cleanup_temp_ips()
                return None, False

    # ── Nothing found ──
    log.warning("✗ No PLC or Windows PC found on any subnet")
    write_status("not_found", "No PLC or PC found", 100, success=False)
    cleanup_temp_ips()
    return None, False


def arp_scan_for_plc() -> Optional[str]:
    """Use ARP table and arping to find devices on eth0, then check for Modbus."""
    # First check existing ARP entries
    try:
        out = subprocess.check_output(["ip", "neigh", "show", "dev", IFACE],
                                       text=True, timeout=5)
        for line in out.strip().splitlines():
            parts = line.split()
            if len(parts) >= 1:
                ip = parts[0]
                if ip in get_eth0_ips():
                    continue
                log.info("  ARP entry: %s — probing Modbus...", ip)
                if probe_modbus_port(ip) and validate_plc(ip):
                    log.info("  ✓ Found PLC via ARP at %s", ip)
                    return ip
    except Exception:
        pass

    # Try arping on each subnet we have an IP on
    for our_ip in get_eth0_ips():
        subnet = ".".join(our_ip.split(".")[:3])
        try:
            # arping broadcast to find neighbors
            out = subprocess.check_output(
                ["arping", "-c", "2", "-w", "2", "-I", IFACE, f"{subnet}.255"],
                text=True, timeout=10, stderr=subprocess.DEVNULL
            )
        except Exception:
            pass

    # Re-check ARP table after arping
    try:
        out = subprocess.check_output(["ip", "neigh", "show", "dev", IFACE],
                                       text=True, timeout=5)
        for line in out.strip().splitlines():
            parts = line.split()
            if len(parts) >= 1 and "REACHABLE" in line.upper():
                ip = parts[0]
                if ip in get_eth0_ips():
                    continue
                if probe_modbus_port(ip) and validate_plc(ip):
                    log.info("  ✓ Found PLC via ARP at %s", ip)
                    return ip
    except Exception:
        pass

    return None


def apply_config(plc_ip: str):
    """Apply the discovered PLC IP to all system configs."""
    plc_subnet = ".".join(plc_ip.split(".")[:3])
    plc_last_octet = int(plc_ip.split(".")[-1])

    # Pick a Pi IP on the same subnet (avoid the PLC's IP)
    # Use .1 unless the PLC is .1, then use .250
    pi_host_id = 1 if plc_last_octet != 1 else 250
    pi_ip = f"{plc_subnet}.{pi_host_id}"

    log.info("Applying configuration:")
    log.info("  PLC IP:  %s", plc_ip)
    log.info("  Pi IP:   %s/24", pi_ip)
    write_status("configuring", f"Configuring: PLC={plc_ip}, Pi={pi_ip}", 85)

    # Update all config files
    update_viam_config(plc_ip)
    update_watchdog(plc_ip)
    update_eth0_static(plc_subnet, pi_ip)
    set_eth0_permanent_ip(pi_ip)

    # Restart viam-server to connect with new IP
    restart_viam_server()

    # Wait briefly then verify
    time.sleep(3)
    if probe_modbus_port(plc_ip) and validate_plc(plc_ip):
        log.info("=" * 60)
        log.info("✓ SUCCESS: PLC at %s is connected and responding", plc_ip)
        log.info("=" * 60)
        write_status("connected", f"PLC connected at {plc_ip}", 100,
                     plc_ip=plc_ip, success=True)
        return True
    else:
        log.warning("PLC at %s not responding after config — module will retry", plc_ip)
        write_status("configured", f"Configured for {plc_ip}, waiting for module...", 100,
                     plc_ip=plc_ip, success=None)
        return True


# ─────────────────────────────────────────────────────────────
#  Windows PC detection & file grabbing
# ─────────────────────────────────────────────────────────────

# File extensions we care about from Windows PCs
INTERESTING_FILES = {".ckp", ".csv", ".pdf", ".txt", ".xlsx", ".docx", ".dwg"}
GRABBED_DIR = PROJECT_DIR / "uploads" / "grabbed"


def probe_smb_port(host: str, timeout: float = SCAN_TIMEOUT) -> bool:
    """Check if SMB (port 445) is open — indicates a Windows PC."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, 445))
        sock.close()
        return result == 0
    except Exception:
        return False


def find_windows_pcs() -> list:
    """Scan all subnets on eth0 for devices with SMB (port 445) open."""
    pcs = []
    log.info("Scanning for Windows PCs (SMB port 445)...")
    write_status("scanning", "Looking for Windows PCs...", 50)

    # Check ARP table first
    try:
        out = subprocess.check_output(["ip", "neigh", "show", "dev", IFACE],
                                       text=True, timeout=5)
        for line in out.strip().splitlines():
            parts = line.split()
            if parts and parts[0] not in get_eth0_ips():
                ip = parts[0]
                if probe_smb_port(ip, timeout=1):
                    log.info("  ✓ Windows PC found at %s", ip)
                    pcs.append(ip)
    except Exception:
        pass

    # Quick scan common addresses on each subnet we have
    if not pcs:
        for our_ip in get_eth0_ips():
            subnet = ".".join(our_ip.split(".")[:3])
            for host_id in [1, 2, 10, 50, 100, 101, 102, 150, 200]:
                ip = f"{subnet}.{host_id}"
                if ip in get_eth0_ips():
                    continue
                if probe_smb_port(ip, timeout=0.5):
                    log.info("  ✓ Windows PC found at %s", ip)
                    pcs.append(ip)

    return pcs


def grab_files_from_pc(host: str) -> list:
    """Connect to a Windows PC via SMB and grab any interesting files."""
    GRABBED_DIR.mkdir(parents=True, exist_ok=True)
    grabbed = []

    log.info("Connecting to Windows PC at %s via SMB...", host)
    write_status("grabbing", f"Scanning Windows PC at {host} for files...", 60)

    # List shares (try anonymous/guest)
    shares = []
    try:
        out = subprocess.check_output(
            ["smbclient", "-L", f"//{host}", "-N", "--option=client min protocol=SMB2"],
            text=True, timeout=15, stderr=subprocess.STDOUT
        )
        for line in out.splitlines():
            line = line.strip()
            # Share lines look like: "ShareName    Disk    comment"
            if "Disk" in line and not line.startswith("---"):
                share_name = line.split()[0]
                # Skip system shares
                if share_name.upper() not in ("IPC$", "PRINT$", "ADMIN$", "C$", "D$"):
                    shares.append(share_name)
        log.info("  Found shares: %s", shares)
    except subprocess.CalledProcessError as e:
        log.info("  Anonymous share listing failed, trying guest...")
        # Try with guest user
        try:
            out = subprocess.check_output(
                ["smbclient", "-L", f"//{host}", "-U", "guest%",
                 "--option=client min protocol=SMB2"],
                text=True, timeout=15, stderr=subprocess.STDOUT
            )
            for line in out.splitlines():
                line = line.strip()
                if "Disk" in line and not line.startswith("---"):
                    share_name = line.split()[0]
                    if share_name.upper() not in ("IPC$", "PRINT$", "ADMIN$", "C$", "D$"):
                        shares.append(share_name)
            log.info("  Found shares (guest): %s", shares)
        except Exception:
            log.warning("  Could not list shares on %s", host)
    except Exception as e:
        log.warning("  SMB error: %s", e)

    # Search each share for interesting files
    for share in shares:
        log.info("  Searching share: //%s/%s", host, share)
        write_status("grabbing", f"Searching //{host}/{share}...", 70)

        try:
            # List files recursively using smbclient
            out = subprocess.check_output(
                ["smbclient", f"//{host}/{share}", "-N",
                 "--option=client min protocol=SMB2",
                 "-c", "recurse; ls"],
                text=True, timeout=30, stderr=subprocess.STDOUT
            )

            for line in out.splitlines():
                line = line.strip()
                # Find files with interesting extensions
                for ext in INTERESTING_FILES:
                    if ext in line.lower():
                        # Extract filename from smbclient ls output
                        # Format: "  filename    size  date"
                        parts = line.split()
                        if parts:
                            fname = parts[0]
                            if fname.lower().endswith(ext):
                                grabbed_files = _grab_file(host, share, fname)
                                grabbed.extend(grabbed_files)

        except Exception as e:
            log.debug("  Error searching %s: %s", share, e)

    # Also try a targeted search for .ckp files specifically
    if not any(f.endswith(".ckp") for f in grabbed):
        for share in shares:
            try:
                # Search common Click PLC project locations
                for search_dir in ["", "\\\\Click", "\\\\PLC", "\\\\Programs",
                                   "\\\\Documents", "\\\\Desktop"]:
                    cmd = f'cd {search_dir}; ls *.ckp' if search_dir else 'ls *.ckp'
                    out = subprocess.check_output(
                        ["smbclient", f"//{host}/{share}", "-N",
                         "--option=client min protocol=SMB2",
                         "-c", cmd],
                        text=True, timeout=15, stderr=subprocess.STDOUT
                    )
                    for line in out.splitlines():
                        line = line.strip()
                        if ".ckp" in line.lower():
                            parts = line.split()
                            if parts:
                                fname = parts[0]
                                if fname.lower().endswith(".ckp"):
                                    path = f"{search_dir}\\\\{fname}" if search_dir else fname
                                    grabbed_files = _grab_file(host, share, path)
                                    grabbed.extend(grabbed_files)
            except Exception:
                pass

    if grabbed:
        log.info("✓ Grabbed %d files from %s: %s", len(grabbed), host,
                 [os.path.basename(f) for f in grabbed])
        write_status("grabbed", f"Got {len(grabbed)} files from Windows PC", 90,
                     success=True)
    else:
        log.info("  No interesting files found on %s", host)
        write_status("no_files", f"No .ckp or project files found on {host}", 90,
                     success=False)

    return grabbed


def _grab_file(host: str, share: str, remote_path: str) -> list:
    """Download a single file from an SMB share."""
    grabbed = []
    fname = os.path.basename(remote_path.replace("\\\\", "/").replace("\\", "/"))
    local_path = GRABBED_DIR / fname

    # Don't re-download if we already have it
    if local_path.exists():
        log.info("    Already have %s — skipping", fname)
        return [str(local_path)]

    log.info("    Grabbing: %s", fname)
    write_status("grabbing", f"Downloading {fname}...", 75)

    try:
        subprocess.check_output(
            ["smbclient", f"//{host}/{share}", "-N",
             "--option=client min protocol=SMB2",
             "-c", f'get "{remote_path}" "{local_path}"'],
            text=True, timeout=60, stderr=subprocess.STDOUT
        )
        if local_path.exists() and local_path.stat().st_size > 0:
            log.info("    ✓ Saved: %s (%d bytes)", local_path, local_path.stat().st_size)
            grabbed.append(str(local_path))

            # If it's a .ckp file, try to crack it immediately
            if fname.lower().endswith(".ckp"):
                analyze_ckp(str(local_path))
        else:
            log.warning("    ✗ Download produced empty file: %s", fname)
    except Exception as e:
        log.warning("    ✗ Failed to grab %s: %s", fname, e)

    return grabbed


def analyze_ckp(filepath: str):
    """Try to extract useful information from a Click PLC .ckp project file."""
    log.info("=" * 60)
    log.info("Analyzing Click PLC project file: %s", os.path.basename(filepath))
    log.info("=" * 60)

    analysis_path = GRABBED_DIR / (os.path.splitext(os.path.basename(filepath))[0] + "-analysis.md")
    results = []
    results.append(f"# Click PLC Project Analysis: {os.path.basename(filepath)}")
    results.append(f"Analyzed: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    results.append(f"Size: {os.path.getsize(filepath)} bytes")
    results.append("")

    # 1. Check file type
    try:
        out = subprocess.check_output(["file", filepath], text=True, timeout=5)
        results.append(f"## File type\n{out.strip()}\n")
        log.info("  File type: %s", out.strip())
    except Exception:
        pass

    # 2. Try to unzip
    try:
        out = subprocess.check_output(
            ["unzip", "-l", filepath], text=True, timeout=10, stderr=subprocess.STDOUT
        )
        results.append(f"## ZIP contents\n```\n{out}\n```\n")
        log.info("  It's a ZIP file! Extracting...")

        extract_dir = GRABBED_DIR / (os.path.splitext(os.path.basename(filepath))[0])
        extract_dir.mkdir(exist_ok=True)
        subprocess.run(["unzip", "-o", filepath, "-d", str(extract_dir)],
                       capture_output=True, timeout=30)
        results.append(f"Extracted to: {extract_dir}\n")

        # Read any XML, JSON, or text files inside
        for root, dirs, files in os.walk(extract_dir):
            for f in files:
                fpath = os.path.join(root, f)
                try:
                    content = open(fpath, "r", errors="replace").read(5000)
                    results.append(f"### {f}\n```\n{content[:3000]}\n```\n")
                except Exception:
                    pass

    except subprocess.CalledProcessError:
        results.append("## Not a ZIP file\n")

    # 3. Extract strings
    try:
        out = subprocess.check_output(
            ["strings", "-n", "4", filepath], text=True, timeout=15
        )
        lines = out.splitlines()
        results.append(f"## Readable strings ({len(lines)} found)\n")

        # Look for register names, comments, addresses
        interesting = []
        for line in lines:
            line_lower = line.lower().strip()
            if any(kw in line_lower for kw in [
                "ds", "dd", "timer", "counter", "encoder", "plate", "eject",
                "speed", "distance", "travel", "spacing", "count", "pulse",
                "tps", "air", "eagle", "camera", "power", "loop",
                "highspeed", "hsc", "reset", "preset",
                "x001", "x002", "x003", "x004", "y001", "y002",
            ]):
                interesting.append(line.strip())

        if interesting:
            results.append("### Register/PLC-related strings\n```")
            for s in interesting[:100]:
                results.append(s)
            results.append("```\n")

        # Also grab anything that looks like a nickname/label
        nicknames = [l.strip() for l in lines if len(l.strip()) > 3 and len(l.strip()) < 50
                     and not l.strip().startswith("\\") and not l.strip().startswith("/")]
        results.append(f"### All unique labels ({len(set(nicknames))} unique)\n```")
        for s in sorted(set(nicknames))[:200]:
            results.append(s)
        results.append("```\n")

    except Exception as e:
        results.append(f"## String extraction failed: {e}\n")

    # 4. Hex header analysis
    try:
        with open(filepath, "rb") as f:
            header = f.read(256)
        hex_lines = []
        for i in range(0, min(256, len(header)), 16):
            chunk = header[i:i+16]
            hex_part = " ".join(f"{b:02x}" for b in chunk)
            ascii_part = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
            hex_lines.append(f"{i:04x}: {hex_part:<48s} {ascii_part}")
        results.append(f"## File header (hex)\n```\n" + "\n".join(hex_lines) + "\n```\n")
    except Exception:
        pass

    # Save analysis
    analysis_text = "\n".join(results)
    analysis_path.write_text(analysis_text)
    log.info("  Analysis saved to: %s", analysis_path)

    # Also write to latest upload pointer so CLI session can see it
    Path("/tmp/ironsight-latest-upload").write_text(str(filepath))


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

    if args.on_link_up:
        # Brief delay to let the link stabilize
        log.info("Triggered by eth0 link-up, waiting 3s for link to stabilize...")
        time.sleep(3)

    plc_ip, config_changed = discover()

    if plc_ip is None:
        log.warning("No PLC found. Will retry on next trigger.")
        sys.exit(1)

    if not config_changed and not args.force:
        log.info("PLC at %s — already configured, no changes needed.", plc_ip)
        sys.exit(2)

    # Apply the new config
    apply_config(plc_ip)
    sys.exit(0)


if __name__ == "__main__":
    main()
