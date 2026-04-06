"""
Viam configuration file updater logic for IronSight Discovery Daemon.

Extracted from ironsight-discovery-daemon.py. Contains:
  - Device profile persistence (save/read/list)
  - PLC probing via discovery module
  - Network subnet scanning
  - Utility functions for network interface state
"""

import json
import os
import re
import socket
import subprocess
from datetime import datetime
from typing import Optional

# Try to load the discovery module (has hyphen in filename)
import importlib.util

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DISCOVER_PATH = os.path.join(SCRIPT_DIR, "ironsight-discover.py")

_discover_spec = importlib.util.spec_from_file_location("ironsight_discover", DISCOVER_PATH)
_discover_module = importlib.util.module_from_spec(_discover_spec) if _discover_spec else None

DISCOVERY_AVAILABLE = os.path.exists(DISCOVER_PATH)
if DISCOVERY_AVAILABLE and _discover_module is not None:
    try:
        _discover_spec.loader.exec_module(_discover_module)
    except Exception as e:
        DISCOVERY_AVAILABLE = False
        print(f"Warning: Could not load discovery module: {e}", file=__import__('sys').stderr)


# Known USB device classes we care about
INTERESTING_USB = {
    "ttyUSB": "serial_adapter",
    "ttyACM": "serial_device",
    "video": "camera",
    "input": "input_device",
    "net": "network_adapter",
}


# ─────────────────────────────────────────────────────────────
#  Network utilities
# ─────────────────────────────────────────────────────────────

def get_carrier(iface: str) -> int:
    """Read carrier state: 1=up, 0=down, -1=unknown.

    Args:
        iface: Network interface name (e.g. 'eth0').

    Returns:
        1 if link is up, 0 if down, -1 if unknown.
    """
    try:
        with open(f"/sys/class/net/{iface}/carrier") as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError, OSError):
        return -1


def get_interface_ip(iface: str) -> str:
    """Get the IPv4 address of a network interface.

    Args:
        iface: Network interface name.

    Returns:
        IPv4 address string, or empty string if not found.
    """
    try:
        result = subprocess.run(
            ["ip", "-4", "-o", "addr", "show", iface],
            capture_output=True, text=True, timeout=5,
        )
        match = re.search(r"inet (\d+\.\d+\.\d+\.\d+)", result.stdout)
        return match.group(1) if match else ""
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def get_interface_subnet(iface: str) -> str:
    """Get the subnet (e.g. '169.168.10.0/24') for an interface.

    Args:
        iface: Network interface name.

    Returns:
        CIDR subnet string, or empty string if not found.
    """
    try:
        result = subprocess.run(
            ["ip", "-4", "-o", "addr", "show", iface],
            capture_output=True, text=True, timeout=5,
        )
        match = re.search(r"inet (\d+\.\d+\.\d+\.\d+/\d+)", result.stdout)
        return match.group(1) if match else ""
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def check_tcp(host: str, port: int, timeout: float = 3) -> bool:
    """Check if a TCP port is open.

    Args:
        host: Target hostname or IP.
        port: Target port number.
        timeout: Connection timeout in seconds.

    Returns:
        True if the port is reachable.
    """
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except (socket.error, OSError):
        return False


# ─────────────────────────────────────────────────────────────
#  USB device identification
# ─────────────────────────────────────────────────────────────

def identify_usb_device(raw: str) -> dict:
    """Try to identify what USB device was plugged in from udevadm output.

    Args:
        raw: Raw udevadm monitor output line.

    Returns:
        Dict with keys: raw, type, description, and optionally device/vendor/model.
    """
    info: dict = {"raw": raw[:200], "type": "unknown", "description": "unknown USB device"}

    for pattern, dev_type in INTERESTING_USB.items():
        if pattern in raw:
            info["type"] = dev_type
            info["description"] = f"{dev_type} ({pattern})"
            break

    match = re.search(r"/dev/(\S+)", raw)
    if match:
        info["device"] = f"/dev/{match.group(1)}"

    dev_match = re.search(r"(/devices/\S+)", raw)
    if dev_match:
        try:
            result = subprocess.run(
                ["udevadm", "info", "--path", dev_match.group(1)],
                capture_output=True, text=True, timeout=3,
            )
            for prop_line in result.stdout.split("\n"):
                if "ID_VENDOR=" in prop_line:
                    vendor = prop_line.split("=", 1)[1]
                    info["vendor"] = vendor
                    info["description"] = f"{info['type']} ({vendor})"
                elif "ID_MODEL=" in prop_line:
                    info["model"] = prop_line.split("=", 1)[1]
                elif "DEVNAME=" in prop_line:
                    info["device"] = prop_line.split("=", 1)[1]
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

    return info


# ─────────────────────────────────────────────────────────────
#  PLC probing and network scanning
# ─────────────────────────────────────────────────────────────

def probe_plc(ip: str, port: int, logger: Optional[object] = None) -> dict:
    """Probe a PLC and return a device profile.

    Args:
        ip: PLC IP address.
        port: Modbus TCP port.
        logger: Optional logger for warnings.

    Returns:
        Device profile dict.
    """
    device: dict = {
        "ip": ip,
        "port": port,
        "type": "plc",
        "reachable": True,
        "last_seen": datetime.now().isoformat(),
    }

    if DISCOVERY_AVAILABLE and _discover_module is not None:
        try:
            protocols = _discover_module.probe_ports(ip)
            device["protocols"] = protocols

            modbus_info = _discover_module.try_modbus(ip, port)
            if modbus_info:
                device["modbus"] = modbus_info
                device["vendor"] = modbus_info.get("vendor", "unknown")
        except Exception as e:
            if logger:
                logger.warning(f"Discovery probe failed for {ip}: {e}")
            device["probe_error"] = str(e)
    else:
        device["vendor"] = "unknown"
        device["note"] = "discovery module not available for deep probe"

    return device


def scan_subnet(subnet: str, logger: Optional[object] = None) -> list[dict]:
    """Scan a subnet for devices with industrial ports open.

    Args:
        subnet: Subnet string (e.g. '169.168.10.0/24').
        logger: Optional logger for warnings.

    Returns:
        List of device profile dicts.
    """
    devices: list[dict] = []

    if DISCOVERY_AVAILABLE and _discover_module is not None:
        try:
            found = _discover_module.scan_network(subnet)
            for f in found:
                ip = f.get("ip", "")
                device = {
                    "ip": ip,
                    "type": "plc" if f.get("plc_vendor") else "unknown",
                    "vendor": f.get("plc_vendor", "unknown"),
                    "mac": f.get("mac", ""),
                    "reachable": True,
                    "last_seen": datetime.now().isoformat(),
                    "discovery_method": "network_scan",
                }
                devices.append(device)
        except Exception as e:
            if logger:
                logger.warning(f"Network scan failed: {e}")
    else:
        if logger:
            logger.info("Using basic scan (discovery module not available)")
        base = ".".join(subnet.split(".")[:3])
        for octet in range(1, 255):
            ip = f"{base}.{octet}"
            if check_tcp(ip, 502, timeout=0.5):
                devices.append({
                    "ip": ip,
                    "port": 502,
                    "type": "plc",
                    "reachable": True,
                    "last_seen": datetime.now().isoformat(),
                    "discovery_method": "port_scan",
                })

    return devices
