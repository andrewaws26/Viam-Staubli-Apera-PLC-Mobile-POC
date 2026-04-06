"""
Network scanning — IP discovery, port scanning, ARP fallback, vendor identification.
"""

import socket
import subprocess
import time
from datetime import datetime
from typing import Dict, List, Optional

# ─────────────────────────────────────────────────────────────
#  Constants shared across the package
# ─────────────────────────────────────────────────────────────

# Industrial protocol ports
INDUSTRIAL_PORTS: Dict[int, str] = {
    502:   "Modbus TCP",
    5000:  "Mitsubishi MC Protocol (Binary)",
    5001:  "Mitsubishi MC Protocol (ASCII)",
    5002:  "Mitsubishi MC Protocol (Alt)",
    4840:  "OPC-UA",
    44818: "EtherNet/IP (Allen-Bradley)",
    2222:  "EtherNet/IP (explicit)",
    102:   "Siemens S7 (ISO-TSAP)",
    9600:  "Omron FINS",
    20256: "ABB Robot",
    1217:  "GE SRTP",
}

# Known PLC manufacturer MAC prefixes (OUI)
PLC_MAC_PREFIXES: Dict[str, str] = {
    "00:0C:E6": "Mitsubishi Electric",
    "00:01:C0": "Mitsubishi Electric",
    "00:80:E1": "Mitsubishi Electric",
    "00:A0:DE": "Mitsubishi Electric (MELSEC)",
    "00:50:C2": "Click/Koyo (AutomationDirect)",
    "00:0B:AB": "AutomationDirect",
    "00:1D:9C": "Rockwell/Allen-Bradley",
    "00:00:BC": "Rockwell/Allen-Bradley",
    "00:30:11": "Siemens",
    "00:0E:8C": "Siemens",
    "00:1A:2B": "Omron",
    "00:00:7C": "Omron",
    "00:07:7D": "ABB",
    "00:30:DE": "Wago",
}

# Mitsubishi MC Protocol (Binary) command codes
MC_CMD_BATCH_READ: int = 0x0401
MC_CMD_BATCH_WRITE: int = 0x1401

# Mitsubishi device codes (for MC Protocol)
MITSUB_DEVICES: Dict[str, tuple] = {
    "D":   (0xA8, 2),    # Data registers (16-bit)
    "W":   (0xB4, 2),    # Link registers (16-bit)
    "R":   (0xAF, 2),    # File registers (16-bit)
    "ZR":  (0xB0, 2),    # File registers (extended)
    "M":   (0x90, 1),    # Internal relays (bit)
    "X":   (0x9C, 1),    # Inputs (bit)
    "Y":   (0x9D, 1),    # Outputs (bit)
    "B":   (0xA0, 1),    # Link relays (bit)
    "L":   (0x92, 1),    # Latch relays (bit)
    "T":   (0xC1, 2),    # Timer current values
    "TN":  (0xC2, 1),    # Timer contacts
    "C":   (0xC4, 2),    # Counter current values
    "CN":  (0xC5, 1),    # Counter contacts
    "SD":  (0xA9, 2),    # Special registers
    "SM":  (0x91, 1),    # Special relays
}

# Terminal colors
BOLD = "\033[1m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
DIM = "\033[2m"
RESET = "\033[0m"


# ─────────────────────────────────────────────────────────────
#  Utility functions
# ─────────────────────────────────────────────────────────────

def banner() -> None:
    """Print the IronSight Discovery banner."""
    print(f"""
{CYAN}╔══════════════════════════════════════════════════════════════╗
║  {BOLD}🔍 IronSight Discovery{RESET}{CYAN}                                     ║
║  Find, connect, and reverse-engineer unknown PLCs            ║
╚══════════════════════════════════════════════════════════════╝{RESET}
""")


def timestamp() -> str:
    """Return current time as HH:MM:SS string."""
    return datetime.now().strftime("%H:%M:%S")


def log(msg: str, level: str = "info") -> None:
    """Print a timestamped, color-coded log message."""
    colors = {"info": CYAN, "ok": GREEN, "warn": YELLOW, "error": RED, "dim": DIM}
    c = colors.get(level, "")
    print(f"  {DIM}[{timestamp()}]{RESET} {c}{msg}{RESET}")


# ─────────────────────────────────────────────────────────────
#  Network scanning
# ─────────────────────────────────────────────────────────────

def get_local_subnets() -> List[str]:
    """Get all local subnets from active interfaces."""
    subnets: List[str] = []
    try:
        result = subprocess.run(
            ["ip", "-4", "addr", "show"],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.split("\n"):
            line = line.strip()
            if line.startswith("inet "):
                parts = line.split()
                addr_cidr = parts[1]  # e.g. "192.168.1.100/24"
                if not addr_cidr.startswith("127."):
                    subnets.append(addr_cidr)
    except Exception as e:
        log(f"Could not enumerate subnets: {e}", "warn")
    return subnets


def identify_vendor(mac: str) -> Optional[str]:
    """Identify device vendor from MAC address OUI."""
    mac_upper = mac.upper().replace("-", ":")
    prefix = mac_upper[:8]
    return PLC_MAC_PREFIXES.get(prefix)


def scan_network(subnet: Optional[str] = None) -> List[dict]:
    """Scan network for devices, identify potential PLCs.

    Args:
        subnet: Optional CIDR subnet (e.g. "192.168.3.0/24").
                If None, all local subnets are scanned.

    Returns:
        List of device dicts with ip, mac, vendor_nmap, vendor_oui, subnet keys.
    """
    devices: List[dict] = []

    if subnet:
        subnets = [subnet]
    else:
        subnets = get_local_subnets()
        if not subnets:
            log("No active network interfaces found", "error")
            return []

    print(f"\n{BOLD}═══ Phase 1: Network Discovery ═══{RESET}\n")

    for net in subnets:
        log(f"Scanning {net}...")

        # Use nmap for host discovery + MAC detection
        try:
            result = subprocess.run(
                ["sudo", "nmap", "-sn", "-n", net, "--host-timeout", "3s"],
                capture_output=True, text=True, timeout=30
            )

            current_host = None
            current_mac = None
            current_vendor_nmap = None

            for line in result.stdout.split("\n"):
                if "Nmap scan report for" in line:
                    if current_host:
                        devices.append({
                            "ip": current_host,
                            "mac": current_mac,
                            "vendor_nmap": current_vendor_nmap,
                            "vendor_oui": identify_vendor(current_mac) if current_mac else None,
                            "subnet": net,
                        })
                    current_host = line.split()[-1].strip("()")
                    current_mac = None
                    current_vendor_nmap = None
                elif "MAC Address:" in line:
                    parts = line.split("MAC Address: ")[1]
                    current_mac = parts.split()[0]
                    if "(" in parts:
                        current_vendor_nmap = parts.split("(")[1].rstrip(")")

            # Don't forget the last host
            if current_host:
                devices.append({
                    "ip": current_host,
                    "mac": current_mac,
                    "vendor_nmap": current_vendor_nmap,
                    "vendor_oui": identify_vendor(current_mac) if current_mac else None,
                    "subnet": net,
                })

        except FileNotFoundError:
            log("nmap not found — falling back to ARP ping scan", "warn")
            devices.extend(_arp_fallback_scan(net))
        except subprocess.TimeoutExpired:
            log(f"Scan of {net} timed out", "warn")

    # Print results
    if not devices:
        log("No devices found on network", "warn")
        return []

    print(f"\n  Found {BOLD}{len(devices)}{RESET} device(s):\n")
    print(f"  {'IP':<18} {'MAC':<20} {'Vendor':<30} {'PLC?'}")
    print(f"  {'─'*18} {'─'*20} {'─'*30} {'─'*5}")

    for d in devices:
        vendor = d.get("vendor_oui") or d.get("vendor_nmap") or "Unknown"
        is_plc = d.get("vendor_oui") is not None
        marker = f"{GREEN}◀ YES{RESET}" if is_plc else ""
        print(f"  {d['ip']:<18} {(d.get('mac') or 'N/A'):<20} {vendor:<30} {marker}")

    return devices


def _arp_fallback_scan(subnet: str) -> List[dict]:
    """Fallback: use ARP scan if nmap is unavailable."""
    devices: List[dict] = []
    try:
        result = subprocess.run(
            ["sudo", "arp-scan", subnet],
            capture_output=True, text=True, timeout=15
        )
        for line in result.stdout.split("\n"):
            parts = line.split("\t")
            if len(parts) >= 2 and parts[0].count(".") == 3:
                devices.append({
                    "ip": parts[0],
                    "mac": parts[1] if len(parts) > 1 else None,
                    "vendor_nmap": parts[2] if len(parts) > 2 else None,
                    "vendor_oui": identify_vendor(parts[1]) if len(parts) > 1 else None,
                    "subnet": subnet,
                })
    except Exception:
        pass
    return devices


def probe_ports(ip: str) -> Dict[int, str]:
    """Probe industrial protocol ports on a target IP.

    Args:
        ip: Target IP address.

    Returns:
        Dict mapping open port numbers to protocol names.
    """
    print(f"\n{BOLD}═══ Phase 2: Protocol Probing — {ip} ═══{RESET}\n")
    log(f"Scanning industrial protocol ports on {ip}...")

    results: Dict[int, str] = {}
    for port, protocol in sorted(INDUSTRIAL_PORTS.items()):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex((ip, port))
            if result == 0:
                results[port] = protocol
                log(f"Port {port:<6} {GREEN}OPEN{RESET}  — {protocol}", "ok")
            else:
                log(f"Port {port:<6} closed — {protocol}", "dim")
            sock.close()
        except Exception:
            log(f"Port {port:<6} error  — {protocol}", "dim")

    if not results:
        log("No industrial protocol ports open!", "warn")
        log("Trying broader port scan...", "warn")
        results = _broad_port_scan(ip)

    return results


def _broad_port_scan(ip: str) -> Dict[int, str]:
    """Broader nmap scan for non-standard ports."""
    results: Dict[int, str] = {}
    try:
        r = subprocess.run(
            ["nmap", "-sT", "-p", "1-10000", "--open", "-T4", "--host-timeout", "30s", ip],
            capture_output=True, text=True, timeout=60
        )
        for line in r.stdout.split("\n"):
            if "/tcp" in line and "open" in line:
                port = int(line.split("/")[0])
                service = line.split()[-1] if len(line.split()) > 2 else "unknown"
                results[port] = f"Unknown service ({service})"
                log(f"Port {port:<6} {GREEN}OPEN{RESET}  — {service}", "ok")
    except Exception as e:
        log(f"Broad scan failed: {e}", "error")
    return results
