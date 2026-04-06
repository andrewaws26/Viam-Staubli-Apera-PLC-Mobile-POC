"""
Modbus scanning utilities for IronSight PLC Auto-Discovery.

Extracted from plc-autodiscover.py. Contains:
  - Modbus port probing (TCP connect check)
  - PLC validation via test Modbus read
  - Subnet scanning with priority host ordering
  - ARP-based PLC discovery
"""

import logging
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger("ironsight-discover")

MODBUS_PORT = 502
SCAN_TIMEOUT = 0.3  # seconds per port probe
IFACE = "eth0"


# ─────────────────────────────────────────────────────────────
#  Port probing
# ─────────────────────────────────────────────────────────────

def probe_modbus_port(host: str, port: int = MODBUS_PORT,
                      timeout: float = SCAN_TIMEOUT) -> bool:
    """Quick TCP connect to check if Modbus port is open.

    Args:
        host: Target IP address.
        port: Modbus TCP port (default 502).
        timeout: Connection timeout in seconds.

    Returns:
        True if the port accepted a TCP connection.
    """
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception:
        return False


def validate_plc(host: str) -> bool:
    """Do a test Modbus read to confirm this is a real Click PLC.

    Args:
        host: Target IP address.

    Returns:
        True if the device responds with valid holding register data.
    """
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


# ─────────────────────────────────────────────────────────────
#  Subnet scanning
# ─────────────────────────────────────────────────────────────

# IPs to skip (our own IPs, broadcast, etc.)
SKIP_SUFFIX = {0, 255}


def scan_subnet(subnet: str, get_eth0_ips_fn: callable,
                write_status_fn: callable,
                progress_base: int = 0) -> Optional[str]:
    """Scan a /24 subnet for Modbus devices. Returns first PLC IP found.

    Args:
        subnet: Subnet prefix (e.g. '192.168.1').
        get_eth0_ips_fn: Callable returning list of eth0 IPs.
        write_status_fn: Callable for status updates.
        progress_base: Base progress percentage for status reporting.

    Returns:
        PLC IP address string, or None if not found.
    """
    log.info("  Scanning %s.0/24 for Modbus devices...", subnet)
    write_status_fn("scanning", f"Scanning {subnet}.0/24...", progress_base)

    # First try common PLC addresses (speeds up discovery)
    priority_hosts = [1, 2, 10, 11, 20, 21, 30, 50, 100, 200]
    for host_id in priority_hosts:
        if host_id in SKIP_SUFFIX:
            continue
        ip = f"{subnet}.{host_id}"
        if ip in get_eth0_ips_fn():
            continue  # skip our own IP
        if probe_modbus_port(ip):
            log.info("  > Port 502 open on %s -- validating...", ip)
            write_status_fn("validating", f"Found port 502 on {ip}, validating...", progress_base + 5)
            if validate_plc(ip):
                log.info("  > Confirmed Click PLC at %s", ip)
                return ip
            else:
                log.info("  > %s has port 502 but is not a Click PLC", ip)

    # Full sweep of remaining addresses
    for host_id in range(1, 255):
        if host_id in SKIP_SUFFIX or host_id in priority_hosts:
            continue
        ip = f"{subnet}.{host_id}"
        if ip in get_eth0_ips_fn():
            continue
        if probe_modbus_port(ip):
            log.info("  > Port 502 open on %s -- validating...", ip)
            if validate_plc(ip):
                log.info("  > Confirmed Click PLC at %s", ip)
                return ip

    return None


# ─────────────────────────────────────────────────────────────
#  ARP-based discovery
# ─────────────────────────────────────────────────────────────

def arp_scan_for_plc(get_eth0_ips_fn: callable) -> Optional[str]:
    """Use ARP table and arping to find devices on eth0, then check for Modbus.

    Args:
        get_eth0_ips_fn: Callable returning list of eth0 IPs.

    Returns:
        PLC IP address string, or None if not found.
    """
    # First check existing ARP entries
    try:
        out = subprocess.check_output(["ip", "neigh", "show", "dev", IFACE],
                                       text=True, timeout=5)
        for line in out.strip().splitlines():
            parts = line.split()
            if len(parts) >= 1:
                ip = parts[0]
                if ip in get_eth0_ips_fn():
                    continue
                log.info("  ARP entry: %s -- probing Modbus...", ip)
                if probe_modbus_port(ip) and validate_plc(ip):
                    log.info("  > Found PLC via ARP at %s", ip)
                    return ip
    except Exception:
        pass

    # Try arping on each subnet we have an IP on
    for our_ip in get_eth0_ips_fn():
        subnet = ".".join(our_ip.split(".")[:3])
        try:
            subprocess.check_output(
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
                if ip in get_eth0_ips_fn():
                    continue
                if probe_modbus_port(ip) and validate_plc(ip):
                    log.info("  > Found PLC via ARP at %s", ip)
                    return ip
    except Exception:
        pass

    return None
