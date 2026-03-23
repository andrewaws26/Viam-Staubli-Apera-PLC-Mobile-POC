#!/usr/bin/env python3
"""
IronSight Discovery — Find, connect to, and reverse-engineer unknown PLCs.

Plug into any industrial network and IronSight will:
  1. Scan the network for devices
  2. Identify PLCs by MAC vendor + open ports
  3. Try Modbus TCP, MC Protocol (Mitsubishi MELSEC), EtherNet/IP
  4. Sweep all register spaces and map what's populated
  5. Watch registers in real-time to identify counters, timers, setpoints
  6. Generate a register map report

Usage:
    ironsight discover                            # Full auto-discovery
    ironsight discover scan                       # Network scan only
    ironsight discover probe 192.168.3.39         # Probe a known IP
    ironsight discover sweep 192.168.3.39         # Full register sweep
    ironsight discover watch 192.168.3.39         # Live monitor mode

Requires: pip3 install pymodbus>=3.5
Optional: nmap (for network scanning)
"""

import argparse
import json
import os
import socket
import struct
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime
from typing import Optional

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    print("ERROR: pymodbus not installed. Run: pip3 install pymodbus")
    sys.exit(1)

# ─────────────────────────────────────────────────────────────
#  Constants
# ─────────────────────────────────────────────────────────────

# Industrial protocol ports
INDUSTRIAL_PORTS = {
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
PLC_MAC_PREFIXES = {
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
MC_CMD_BATCH_READ = 0x0401
MC_CMD_BATCH_WRITE = 0x1401

# Mitsubishi device codes (for MC Protocol)
MITSUB_DEVICES = {
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

BOLD = "\033[1m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
DIM = "\033[2m"
RESET = "\033[0m"


def banner():
    print(f"""
{CYAN}╔══════════════════════════════════════════════════════════════╗
║  {BOLD}🔍 IronSight Discovery{RESET}{CYAN}                                     ║
║  Find, connect, and reverse-engineer unknown PLCs            ║
╚══════════════════════════════════════════════════════════════╝{RESET}
""")


def timestamp():
    return datetime.now().strftime("%H:%M:%S")


def log(msg, level="info"):
    colors = {"info": CYAN, "ok": GREEN, "warn": YELLOW, "error": RED, "dim": DIM}
    c = colors.get(level, "")
    print(f"  {DIM}[{timestamp()}]{RESET} {c}{msg}{RESET}")


# ─────────────────────────────────────────────────────────────
#  Phase 1: Network Scanning
# ─────────────────────────────────────────────────────────────

def get_local_subnets():
    """Get all local subnets from active interfaces."""
    subnets = []
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


def scan_network(subnet: str = None) -> list:
    """Scan network for devices, identify potential PLCs."""
    devices = []

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

    plc_candidates = []
    for d in devices:
        vendor = d.get("vendor_oui") or d.get("vendor_nmap") or "Unknown"
        is_plc = d.get("vendor_oui") is not None
        marker = f"{GREEN}◀ YES{RESET}" if is_plc else ""
        print(f"  {d['ip']:<18} {(d.get('mac') or 'N/A'):<20} {vendor:<30} {marker}")
        if is_plc:
            plc_candidates.append(d)

    return devices


def _arp_fallback_scan(subnet: str) -> list:
    """Fallback: use ARP scan if nmap is unavailable."""
    devices = []
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


# ─────────────────────────────────────────────────────────────
#  Phase 2: Protocol Probing
# ─────────────────────────────────────────────────────────────

def probe_ports(ip: str) -> dict:
    """Probe industrial protocol ports on a target IP."""
    print(f"\n{BOLD}═══ Phase 2: Protocol Probing — {ip} ═══{RESET}\n")
    log(f"Scanning industrial protocol ports on {ip}...")

    results = {}
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


def _broad_port_scan(ip: str) -> dict:
    """Broader nmap scan for non-standard ports."""
    results = {}
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


def try_modbus(ip: str, port: int = 502) -> dict:
    """Try Modbus TCP communication and read identity."""
    print(f"\n  {BOLD}── Modbus TCP ({ip}:{port}) ──{RESET}")
    result = {"protocol": "Modbus TCP", "success": False, "data": {}}

    try:
        client = ModbusTcpClient(ip, port=port, timeout=3)
        if not client.connect():
            log(f"Could not establish TCP connection", "error")
            return result

        log("TCP connected", "ok")
        result["success"] = True

        # Try reading device identification (FC43/14)
        try:
            from pymodbus.mei_message import ReadDeviceInformationRequest
            rq = ReadDeviceInformationRequest(read_code=0x01, object_id=0x00)
            rr = client.execute(rq)
            if not rr.isError() and hasattr(rr, 'information'):
                info = {}
                field_names = {0: "VendorName", 1: "ProductCode", 2: "MajorMinorRevision",
                               3: "VendorUrl", 4: "ProductName", 5: "ModelName", 6: "UserAppName"}
                for k, v in rr.information.items():
                    name = field_names.get(k, f"field_{k}")
                    info[name] = v.decode() if isinstance(v, bytes) else str(v)
                result["data"]["device_id"] = info
                log(f"Device ID: {info}", "ok")
        except Exception:
            log("Device identification not supported (normal for many PLCs)", "dim")

        # Quick test: read first few holding registers
        try:
            r = client.read_holding_registers(address=0, count=10)
            if not r.isError():
                vals = [r.registers[i] for i in range(len(r.registers))]
                result["data"]["holding_0_9"] = vals
                log(f"Holding regs 0-9: {vals}", "ok")
            else:
                log(f"Holding register read error: {r}", "warn")
        except Exception as e:
            log(f"Holding register read failed: {e}", "warn")

        # Quick test: read discrete inputs
        try:
            r = client.read_discrete_inputs(address=0, count=16)
            if not r.isError():
                bits = [r.bits[i] for i in range(min(16, len(r.bits)))]
                result["data"]["discrete_0_15"] = bits
                log(f"Discrete inputs 0-15: {bits}", "ok")
        except Exception:
            pass

        # Quick test: read input registers
        try:
            r = client.read_input_registers(address=0, count=10)
            if not r.isError():
                vals = [r.registers[i] for i in range(len(r.registers))]
                result["data"]["input_0_9"] = vals
                log(f"Input regs 0-9: {vals}", "ok")
        except Exception:
            pass

        client.close()

    except Exception as e:
        log(f"Modbus error: {e}", "error")

    return result


def try_mc_protocol(ip: str, port: int = 5000) -> dict:
    """Try Mitsubishi MC Protocol (MELSEC binary) communication."""
    print(f"\n  {BOLD}── MC Protocol / MELSEC ({ip}:{port}) ──{RESET}")
    result = {"protocol": "MC Protocol (MELSEC)", "success": False, "data": {}}

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        sock.connect((ip, port))
        log("TCP connected", "ok")

        # Build MC Protocol binary frame: Read D0-D9 (10 words)
        # Subheader (fixed for binary 3E frame)
        subheader = struct.pack("<H", 0x0050)  # 3E frame subheader
        # Network, PC, Dest I/O, Dest Station
        route = struct.pack("<BBHB", 0x00, 0xFF, 0x03FF, 0x00)
        # Monitoring timer (10 = 10 x 250ms = 2.5s)
        timer = struct.pack("<H", 0x000A)
        # Command: batch read (0x0401), subcommand: word (0x0000)
        command = struct.pack("<HH", MC_CMD_BATCH_READ, 0x0000)
        # Device: D registers, start address 0, count 10
        # Start device (3 bytes LE) + device code (1 byte)
        device_start = struct.pack("<I", 0)[0:3]  # D0
        device_code = struct.pack("<B", 0xA8)      # D register
        count = struct.pack("<H", 10)               # 10 points

        data_part = timer + command + device_start + device_code + count
        data_len = struct.pack("<H", len(data_part))

        frame = subheader + route + data_len + data_part

        sock.sendall(frame)
        log(f"Sent MC Protocol read request ({len(frame)} bytes)", "ok")

        # Read response
        resp = sock.recv(4096)
        if resp and len(resp) >= 11:
            # Parse response: subheader(2) + route(5) + length(2) + end_code(2) + data
            end_code = struct.unpack("<H", resp[9:11])[0]
            if end_code == 0:
                log(f"MC Protocol response OK (end code: 0x0000)", "ok")
                result["success"] = True
                # Parse data words
                data_bytes = resp[11:]
                words = []
                for i in range(0, len(data_bytes) - 1, 2):
                    words.append(struct.unpack("<H", data_bytes[i:i+2])[0])
                result["data"]["D0_D9"] = words
                log(f"D0-D9: {words}", "ok")
            else:
                log(f"MC Protocol error code: 0x{end_code:04X}", "warn")
                # Still counts as successful communication
                result["success"] = True
                result["data"]["error_code"] = f"0x{end_code:04X}"
        else:
            log(f"No valid response (got {len(resp) if resp else 0} bytes)", "warn")
            if resp:
                log(f"Raw: {resp.hex()}", "dim")

        sock.close()

    except ConnectionRefusedError:
        log(f"Connection refused on port {port}", "dim")
    except socket.timeout:
        log(f"Connection timed out", "dim")
    except Exception as e:
        log(f"MC Protocol error: {e}", "error")

    return result


def mc_read_device(sock, device_code_byte: int, start: int, count: int) -> list:
    """Read registers via MC Protocol. Returns list of values or empty list."""
    subheader = struct.pack("<H", 0x0050)
    route = struct.pack("<BBHB", 0x00, 0xFF, 0x03FF, 0x00)
    timer = struct.pack("<H", 0x000A)
    command = struct.pack("<HH", MC_CMD_BATCH_READ, 0x0000)
    device_start = struct.pack("<I", start)[0:3]
    device_code = struct.pack("<B", device_code_byte)
    cnt = struct.pack("<H", count)

    data_part = timer + command + device_start + device_code + cnt
    data_len = struct.pack("<H", len(data_part))
    frame = subheader + route + data_len + data_part

    sock.sendall(frame)
    resp = sock.recv(4096)

    if resp and len(resp) >= 11:
        end_code = struct.unpack("<H", resp[9:11])[0]
        if end_code == 0:
            data_bytes = resp[11:]
            words = []
            for i in range(0, len(data_bytes) - 1, 2):
                words.append(struct.unpack("<H", data_bytes[i:i+2])[0])
            return words
    return []


# ─────────────────────────────────────────────────────────────
#  Phase 3: Register Sweep
# ─────────────────────────────────────────────────────────────

def sweep_modbus(ip: str, port: int = 502) -> dict:
    """Sweep all Modbus register ranges to find populated addresses."""
    print(f"\n{BOLD}═══ Phase 3: Register Sweep (Modbus) — {ip}:{port} ═══{RESET}\n")

    client = ModbusTcpClient(ip, port=port, timeout=3)
    if not client.connect():
        log("Cannot connect", "error")
        return {}

    register_map = {
        "holding_registers": {},
        "input_registers": {},
        "coils": {},
        "discrete_inputs": {},
    }

    # Sweep holding registers in blocks
    log("Sweeping holding registers (FC03)...")
    ranges = [
        (0, 100, "Standard range"),
        (100, 100, "Extended range 100-199"),
        (200, 100, "Extended range 200-299"),
        (500, 100, "Extended range 500-599"),
        (1000, 100, "Range 1000-1099"),
        (4000, 100, "Range 4000-4099"),
        (4096, 100, "Range 4096-4195"),
        (8192, 100, "Range 8192-8291"),
        (16384, 10, "32-bit register range"),
        (40000, 100, "Range 40000-40099"),
    ]

    for start, count, label in ranges:
        try:
            r = client.read_holding_registers(address=start, count=count)
            if not r.isError():
                for i, val in enumerate(r.registers):
                    if val != 0:
                        register_map["holding_registers"][start + i] = val
        except Exception:
            pass
        time.sleep(0.05)  # Don't flood the PLC

    populated = len(register_map["holding_registers"])
    log(f"Found {GREEN}{populated}{RESET} non-zero holding registers", "ok" if populated else "warn")

    # Sweep input registers in blocks
    log("Sweeping input registers (FC04)...")
    for start in [0, 100, 200, 1000, 4096, 8192]:
        try:
            r = client.read_input_registers(address=start, count=100)
            if not r.isError():
                for i, val in enumerate(r.registers):
                    if val != 0:
                        register_map["input_registers"][start + i] = val
        except Exception:
            pass
        time.sleep(0.05)

    populated = len(register_map["input_registers"])
    log(f"Found {GREEN}{populated}{RESET} non-zero input registers", "ok" if populated else "dim")

    # Sweep coils
    log("Sweeping coils (FC01)...")
    for start in [0, 100, 500, 1000, 1998, 2000, 4096, 8192]:
        try:
            r = client.read_coils(address=start, count=100)
            if not r.isError():
                for i in range(min(100, len(r.bits))):
                    if r.bits[i]:
                        register_map["coils"][start + i] = True
        except Exception:
            pass
        time.sleep(0.05)

    populated = len(register_map["coils"])
    log(f"Found {GREEN}{populated}{RESET} active coils", "ok" if populated else "dim")

    # Sweep discrete inputs
    log("Sweeping discrete inputs (FC02)...")
    for start in [0, 100, 500, 1000, 4096, 8192]:
        try:
            r = client.read_discrete_inputs(address=start, count=100)
            if not r.isError():
                for i in range(min(100, len(r.bits))):
                    if r.bits[i]:
                        register_map["discrete_inputs"][start + i] = True
        except Exception:
            pass
        time.sleep(0.05)

    populated = len(register_map["discrete_inputs"])
    log(f"Found {GREEN}{populated}{RESET} active discrete inputs", "ok" if populated else "dim")

    client.close()
    _print_register_map(register_map)
    return register_map


def sweep_mc_protocol(ip: str, port: int = 5000) -> dict:
    """Sweep Mitsubishi MC Protocol device memory."""
    print(f"\n{BOLD}═══ Phase 3: Register Sweep (MC Protocol) — {ip}:{port} ═══{RESET}\n")

    register_map = {}

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        sock.connect((ip, port))
    except Exception as e:
        log(f"Cannot connect: {e}", "error")
        return {}

    for dev_name, (dev_code, dev_size) in MITSUB_DEVICES.items():
        if dev_size == 1:
            # Bit device — skip for now, focus on word devices
            continue

        log(f"Sweeping {dev_name} registers (device code 0x{dev_code:02X})...")
        device_regs = {}

        # Sweep in blocks of 100
        for start in range(0, 1000, 100):
            try:
                values = mc_read_device(sock, dev_code, start, 100)
                for i, val in enumerate(values):
                    if val != 0:
                        device_regs[start + i] = val
                time.sleep(0.05)
            except Exception:
                break  # Likely end of valid range

        if device_regs:
            register_map[dev_name] = device_regs
            log(f"Found {GREEN}{len(device_regs)}{RESET} non-zero {dev_name} registers", "ok")
        else:
            log(f"No populated {dev_name} registers found", "dim")

    # Now sweep bit devices
    for dev_name, (dev_code, dev_size) in MITSUB_DEVICES.items():
        if dev_size != 1:
            continue

        log(f"Sweeping {dev_name} bits (device code 0x{dev_code:02X})...")
        device_bits = {}

        for start in range(0, 256, 64):
            try:
                # For bit reads, use subcommand 0x0001
                subheader = struct.pack("<H", 0x0050)
                route = struct.pack("<BBHB", 0x00, 0xFF, 0x03FF, 0x00)
                timer = struct.pack("<H", 0x000A)
                command = struct.pack("<HH", MC_CMD_BATCH_READ, 0x0001)  # bit subcommand
                device_start = struct.pack("<I", start)[0:3]
                device_code_b = struct.pack("<B", dev_code)
                cnt = struct.pack("<H", 64)

                data_part = timer + command + device_start + device_code_b + cnt
                data_len = struct.pack("<H", len(data_part))
                frame = subheader + route + data_len + data_part

                sock.sendall(frame)
                resp = sock.recv(4096)
                if resp and len(resp) >= 11:
                    end_code = struct.unpack("<H", resp[9:11])[0]
                    if end_code == 0:
                        data_bytes = resp[11:]
                        for i, b in enumerate(data_bytes):
                            if b:
                                device_bits[start + i] = bool(b)
                time.sleep(0.05)
            except Exception:
                break

        if device_bits:
            register_map[dev_name] = device_bits
            log(f"Found {GREEN}{len(device_bits)}{RESET} active {dev_name} bits", "ok")

    sock.close()
    _print_mc_register_map(register_map)
    return register_map


def _print_register_map(reg_map: dict):
    """Pretty-print a Modbus register map."""
    print(f"\n{BOLD}  ── Register Map Summary ──{RESET}\n")

    for space, regs in reg_map.items():
        if not regs:
            continue
        label = space.replace("_", " ").title()
        print(f"  {BOLD}{label}{RESET} ({len(regs)} populated):")
        # Sort and group into contiguous ranges
        addrs = sorted(regs.keys()) if isinstance(regs, dict) else []
        for addr in addrs:
            val = regs[addr]
            if isinstance(val, bool):
                print(f"    [{addr:>6}] = {'ON' if val else 'OFF'}")
            else:
                # Show decimal + hex + possible signed interpretation
                signed = val - 65536 if val > 32767 else val
                extra = f" (signed: {signed})" if val > 32767 else ""
                print(f"    [{addr:>6}] = {val:<8} (0x{val:04X}){extra}")
        print()


def _print_mc_register_map(reg_map: dict):
    """Pretty-print a Mitsubishi MC Protocol register map."""
    print(f"\n{BOLD}  ── MC Protocol Register Map ──{RESET}\n")

    for dev_name, regs in reg_map.items():
        if not regs:
            continue
        print(f"  {BOLD}{dev_name} Registers{RESET} ({len(regs)} populated):")
        for addr in sorted(regs.keys()):
            val = regs[addr]
            if isinstance(val, bool):
                print(f"    {dev_name}{addr:<6} = {'ON' if val else 'OFF'}")
            else:
                signed = val - 65536 if val > 32767 else val
                extra = f" (signed: {signed})" if val > 32767 else ""
                print(f"    {dev_name}{addr:<6} = {val:<8} (0x{val:04X}){extra}")
        print()


# ─────────────────────────────────────────────────────────────
#  Phase 4: Live Watch Mode (Reverse Engineering)
# ─────────────────────────────────────────────────────────────

def watch_registers(ip: str, port: int = 502, protocol: str = "modbus",
                    duration: int = 60, interval: float = 0.5) -> dict:
    """Watch registers in real-time to identify dynamic behavior. Returns analysis dict."""
    print(f"\n{BOLD}═══ Phase 4: Live Register Watch — {ip} ({protocol}) ═══{RESET}")
    print(f"  Watching for {duration}s at {interval}s intervals. Press Ctrl+C to stop.\n")

    snapshots = []
    change_counts = defaultdict(int)
    min_vals = {}
    max_vals = {}
    first_vals = {}

    if protocol == "modbus":
        client = ModbusTcpClient(ip, port=port, timeout=3)
        if not client.connect():
            log("Cannot connect", "error")
            return {}
        read_fn = lambda: _read_all_modbus(client)
    elif protocol == "mc":
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        sock.connect((ip, port))
        read_fn = lambda: _read_all_mc(sock)
    else:
        log(f"Unknown protocol: {protocol}", "error")
        return {}

    prev_snap = None
    start_time = time.time()

    try:
        while (time.time() - start_time) < duration:
            snap = read_fn()
            if not snap:
                log("Read failed, retrying...", "warn")
                time.sleep(interval)
                continue

            # Track first values
            if not first_vals:
                first_vals = dict(snap)

            # Track min/max
            for k, v in snap.items():
                if isinstance(v, (int, float)):
                    if k not in min_vals:
                        min_vals[k] = v
                        max_vals[k] = v
                    else:
                        min_vals[k] = min(min_vals[k], v)
                        max_vals[k] = max(max_vals[k], v)

            # Detect changes
            if prev_snap:
                changes = {}
                for k, v in snap.items():
                    if k in prev_snap and prev_snap[k] != v:
                        changes[k] = (prev_snap[k], v)
                        change_counts[k] += 1

                if changes:
                    elapsed = time.time() - start_time
                    print(f"\n  {YELLOW}[{elapsed:6.1f}s] Changes detected:{RESET}")
                    for k, (old, new) in changes.items():
                        delta = ""
                        if isinstance(new, (int, float)) and isinstance(old, (int, float)):
                            d = new - old
                            delta = f"  (Δ {'+' if d >= 0 else ''}{d})"
                        print(f"    {k:<24} {old} → {new}{delta}")

            prev_snap = dict(snap)
            snapshots.append(snap)
            time.sleep(interval)

    except KeyboardInterrupt:
        print(f"\n\n  {DIM}Stopped by user.{RESET}")

    # Analysis
    elapsed_total = time.time() - start_time
    print(f"\n{BOLD}═══ Register Analysis ({elapsed_total:.0f}s, {len(snapshots)} samples) ═══{RESET}\n")

    if not change_counts:
        log("No register changes detected during observation period", "warn")
        log("The PLC may be idle. Try again while the machine is running.", "warn")
        return {"counters": [], "oscillators": [], "setpoints": [],
                "unknown_dynamic": [], "static_count": len(first_vals)}

    # Classify registers
    counters = []
    oscillators = []
    setpoints = []
    unknown_dynamic = []

    for reg, count in sorted(change_counts.items(), key=lambda x: -x[1]):
        if reg not in first_vals or not isinstance(first_vals[reg], (int, float)):
            continue

        change_rate = count / elapsed_total
        val_range = max_vals.get(reg, 0) - min_vals.get(reg, 0)
        first = first_vals[reg]
        last = prev_snap.get(reg, first)

        info = {
            "register": reg,
            "changes": count,
            "rate_hz": round(change_rate, 2),
            "min": min_vals.get(reg),
            "max": max_vals.get(reg),
            "range": val_range,
            "first": first,
            "last": last,
            "net_delta": last - first if isinstance(last, (int, float)) else None,
        }

        # Heuristic classification
        if isinstance(last, (int, float)) and isinstance(first, (int, float)):
            net = last - first
            if net > 0 and abs(net) > count * 0.3:
                counters.append(info)
            elif val_range <= 1:
                oscillators.append(info)
            elif count <= 3 and val_range < 100:
                setpoints.append(info)
            else:
                unknown_dynamic.append(info)
        else:
            unknown_dynamic.append(info)

    if counters:
        print(f"  {GREEN}{BOLD}Likely COUNTERS / ACCUMULATORS:{RESET}")
        print(f"  (Values that consistently increase — encoders, counters, timers)\n")
        for c in counters:
            print(f"    {c['register']:<24} {c['first']} → {c['last']}  "
                  f"(Δ{c['net_delta']:+}, {c['rate_hz']} changes/sec)")
        print()

    if oscillators:
        print(f"  {YELLOW}{BOLD}Likely BINARY / STATUS flags:{RESET}")
        print(f"  (Values toggling between states — sensors, switches, status bits)\n")
        for o in oscillators:
            print(f"    {o['register']:<24} range: {o['min']}-{o['max']}  "
                  f"({o['changes']} toggles)")
        print()

    if setpoints:
        print(f"  {CYAN}{BOLD}Likely SETPOINTS / PARAMETERS:{RESET}")
        print(f"  (Values that changed rarely — operator adjustments)\n")
        for s in setpoints:
            print(f"    {s['register']:<24} {s['first']} → {s['last']}  "
                  f"({s['changes']} changes)")
        print()

    if unknown_dynamic:
        print(f"  {BOLD}OTHER DYNAMIC REGISTERS:{RESET}")
        print(f"  (Need more observation to classify)\n")
        for u in unknown_dynamic:
            print(f"    {u['register']:<24} range: {u['min']}-{u['max']}  "
                  f"({u['changes']} changes, {u['rate_hz']}/sec)")
        print()

    # Static registers summary
    static_count = len(first_vals) - len(change_counts)
    if static_count > 0:
        print(f"  {DIM}+ {static_count} static registers (unchanged during observation){RESET}\n")

    return {
        "counters": counters,
        "oscillators": oscillators,
        "setpoints": setpoints,
        "unknown_dynamic": unknown_dynamic,
        "static_count": static_count,
    }


def _read_all_modbus(client: ModbusTcpClient) -> dict:
    """Read all Modbus register spaces."""
    snap = {}
    try:
        # Holding registers 0-99
        r = client.read_holding_registers(address=0, count=100)
        if not r.isError():
            for i, val in enumerate(r.registers):
                snap[f"HR_{i}"] = val & 0xFFFF

        # Input registers 0-99
        try:
            r = client.read_input_registers(address=0, count=100)
            if not r.isError():
                for i, val in enumerate(r.registers):
                    snap[f"IR_{i}"] = val & 0xFFFF
        except Exception:
            pass

        # Discrete inputs 0-31
        try:
            r = client.read_discrete_inputs(address=0, count=32)
            if not r.isError():
                for i in range(min(32, len(r.bits))):
                    snap[f"DI_{i}"] = int(r.bits[i])
        except Exception:
            pass

        # Coils 0-31
        try:
            r = client.read_coils(address=0, count=32)
            if not r.isError():
                for i in range(min(32, len(r.bits))):
                    snap[f"COIL_{i}"] = int(r.bits[i])
        except Exception:
            pass

        # High-range holding registers (encoder area)
        try:
            r = client.read_holding_registers(address=16384, count=10)
            if not r.isError():
                for i, val in enumerate(r.registers):
                    snap[f"HR_{16384+i}"] = val & 0xFFFF
        except Exception:
            pass

    except Exception:
        pass

    return snap


def _read_all_mc(sock) -> dict:
    """Read all Mitsubishi device memory via MC Protocol."""
    snap = {}
    for dev_name in ["D", "W", "T", "C", "SD"]:
        dev_code = MITSUB_DEVICES[dev_name][0]
        try:
            values = mc_read_device(sock, dev_code, 0, 100)
            for i, val in enumerate(values):
                snap[f"{dev_name}{i}"] = val
        except Exception:
            pass
    return snap


# ─────────────────────────────────────────────────────────────
#  Phase 5: Report Generation
# ─────────────────────────────────────────────────────────────

def generate_report(ip: str, vendor: str, protocols: dict, register_map: dict,
                    watch_analysis: dict = None, output_dir: str = None):
    """Generate a JSON report and a plain-English briefing for Claude handoff."""
    if output_dir is None:
        output_dir = os.path.dirname(os.path.abspath(__file__))

    report = {
        "generated": datetime.now().isoformat(),
        "target_ip": ip,
        "vendor": vendor,
        "protocols_detected": protocols,
        "register_map": {},
        "watch_analysis": watch_analysis,
    }

    # Convert register map keys to strings for JSON
    for space, regs in register_map.items():
        report["register_map"][space] = {str(k): v for k, v in regs.items()}

    filename = f"ironsight-discovery-{ip.replace('.', '_')}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    filepath = os.path.join(output_dir, filename)

    with open(filepath, "w") as f:
        json.dump(report, f, indent=2)

    # Also write a plain-text briefing for the Claude handoff
    briefing = _build_briefing(ip, vendor, protocols, register_map, watch_analysis)
    briefing_path = filepath.replace(".json", "-briefing.txt")
    with open(briefing_path, "w") as f:
        f.write(briefing)

    log(f"Report saved to {filepath}", "ok")
    log(f"Briefing saved to {briefing_path}", "ok")
    return filepath, briefing_path


def _build_briefing(ip: str, vendor: str, protocols: dict, register_map: dict,
                    watch_analysis: dict = None) -> str:
    """Build a plain-text briefing of everything discovery found."""
    lines = []
    lines.append(f"DISCOVERY REPORT — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"{'=' * 60}")
    lines.append(f"")
    lines.append(f"TARGET: {ip}")
    lines.append(f"VENDOR: {vendor}")
    lines.append(f"PROTOCOLS: {', '.join(f'{name} (port {port})' for port, name in protocols.items())}")
    lines.append(f"")

    # Register summary by space
    for space, regs in register_map.items():
        if not regs:
            continue
        label = space.replace("_", " ").title()
        lines.append(f"--- {label} ({len(regs)} populated) ---")
        addrs = sorted(regs.keys()) if isinstance(regs, dict) else []
        for addr in addrs:
            val = regs[addr]
            if isinstance(val, bool):
                lines.append(f"  [{addr:>6}] = {'ON' if val else 'OFF'}")
            else:
                signed = val - 65536 if val > 32767 else val
                extra = f" (signed: {signed})" if val > 32767 else ""
                lines.append(f"  [{addr:>6}] = {val}{extra}")
        lines.append("")

    # Watch analysis if available
    if watch_analysis:
        if watch_analysis.get("counters"):
            lines.append("--- Likely COUNTERS (values that keep going up) ---")
            for c in watch_analysis["counters"]:
                lines.append(f"  {c['register']}: went from {c['first']} to {c['last']} (changed {c['changes']} times)")
            lines.append("")

        if watch_analysis.get("oscillators"):
            lines.append("--- Likely STATUS FLAGS (values toggling on/off) ---")
            for o in watch_analysis["oscillators"]:
                lines.append(f"  {o['register']}: toggled {o['changes']} times between {o['min']} and {o['max']}")
            lines.append("")

        if watch_analysis.get("setpoints"):
            lines.append("--- Likely SETPOINTS (values that rarely change) ---")
            for s in watch_analysis["setpoints"]:
                lines.append(f"  {s['register']}: was {s['first']}, changed to {s['last']}")
            lines.append("")

        if watch_analysis.get("unknown_dynamic"):
            lines.append("--- UNCLASSIFIED (need more observation) ---")
            for u in watch_analysis["unknown_dynamic"]:
                lines.append(f"  {u['register']}: range {u['min']}-{u['max']}, changed {u['changes']} times")
            lines.append("")

        static = watch_analysis.get("static_count", 0)
        if static:
            lines.append(f"--- {static} registers did not change during observation ---")
            lines.append("")

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────
#  Main Pipeline
# ─────────────────────────────────────────────────────────────

def full_discovery(subnet: str = None):
    """Run the full discovery pipeline: scan → probe → sweep → watch → report."""
    banner()
    print(f"  Scanning network, looking for PLCs...\n")

    # Phase 1: Find devices
    devices = scan_network(subnet)
    if not devices:
        print(f"\n  {RED}{BOLD}No devices found on the network.{RESET}")
        print(f"  Check that the Ethernet cable is plugged in.\n")
        return

    # Pick the best PLC candidate
    plc_candidates = [d for d in devices if d.get("vendor_oui")]
    if plc_candidates:
        target = plc_candidates[0]
        vendor = target['vendor_oui']
        print(f"\n  {GREEN}{BOLD}Found it: {target['ip']} — {vendor}{RESET}")
        print(f"  Now figuring out how to talk to it...\n")
    else:
        target = devices[0]
        vendor = target.get('vendor_nmap') or 'Unknown'
        print(f"\n  {YELLOW}No known PLC vendor in MAC table. Trying {target['ip']} ({vendor})...{RESET}\n")

    target_ip = target["ip"]

    # Phase 2: Probe protocols
    open_ports = probe_ports(target_ip)

    if not open_ports:
        print(f"\n  {RED}{BOLD}No industrial protocol ports open on {target_ip}.{RESET}")
        print(f"  This device may not be a PLC, or it uses a protocol I don't know yet.\n")
        return

    # Phase 3: Try each detected protocol
    protocol_results = {}
    register_map = {}
    watch_protocol = None
    watch_port = None

    if 502 in open_ports:
        print(f"\n  {BOLD}Trying Modbus TCP...{RESET}")
        modbus_result = try_modbus(target_ip, 502)
        protocol_results["modbus"] = modbus_result
        if modbus_result["success"]:
            print(f"\n  {GREEN}Modbus TCP is working. Reading every register...{RESET}\n")
            register_map = sweep_modbus(target_ip, 502)
            watch_protocol = "modbus"
            watch_port = 502

    for port in [5000, 5001, 5002]:
        if port in open_ports:
            print(f"\n  {BOLD}Trying Mitsubishi MC Protocol on port {port}...{RESET}")
            mc_result = try_mc_protocol(target_ip, port)
            protocol_results[f"mc_{port}"] = mc_result
            if mc_result["success"]:
                if not register_map:
                    print(f"\n  {GREEN}MC Protocol is working. Reading every register...{RESET}\n")
                    register_map = sweep_mc_protocol(target_ip, port)
                watch_protocol = "mc"
                watch_port = port
            break

    if not protocol_results or not any(r["success"] for r in protocol_results.values()):
        print(f"\n  {RED}{BOLD}Could not communicate with {target_ip}.{RESET}")
        print(f"  Ports are open but no protocol responded. May need a different approach.\n")
        return

    # Phase 4: Live watch — show them the machine talking
    total_regs = sum(len(v) for v in register_map.values())
    print(f"\n  {GREEN}{BOLD}Connected. Found {total_regs} active registers.{RESET}")
    print(f"\n  {BOLD}Now watching the PLC live — every register change shows up here.{RESET}")
    print(f"  {BOLD}Run the machine to see what each register does.{RESET}")
    print(f"  {DIM}Press Ctrl+C when you've seen enough.{RESET}\n")

    watch_analysis = watch_registers(target_ip, port=watch_port, protocol=watch_protocol,
                                     duration=300, interval=0.5)

    # Phase 5: Report
    report_path, briefing_path = generate_report(
        target_ip, vendor, open_ports, register_map, watch_analysis
    )

    print(f"\n{BOLD}{'═' * 60}{RESET}")
    print(f"{BOLD}  DISCOVERY COMPLETE{RESET}")
    print(f"{'═' * 60}\n")
    print(f"  PLC:        {target_ip}")
    print(f"  Vendor:     {vendor}")
    print(f"  Protocol:   {', '.join(open_ports.values())}")
    print(f"  Registers:  {total_regs} found")
    print(f"  Report:     {report_path}")
    print()
    print(f"  {BOLD}Handing off to IronSight for analysis...{RESET}")
    print()

    # Write the briefing path to a known location so the shell can pick it up
    handoff_file = "/tmp/ironsight-discovery-briefing"
    with open(handoff_file, "w") as f:
        f.write(briefing_path)

    return briefing_path


def probe_single(ip: str):
    """Probe a single known IP."""
    banner()
    print(f"  Target: {ip}\n")
    open_ports = probe_ports(ip)

    if 502 in open_ports:
        try_modbus(ip, 502)

    for port in [5000, 5001, 5002]:
        if port in open_ports:
            try_mc_protocol(ip, port)
            break
    else:
        # Try MC protocol anyway even if port wasn't in scan
        try_mc_protocol(ip, 5000)

    print()


def sweep_single(ip: str):
    """Full register sweep on a known IP."""
    banner()

    # Determine protocol
    open_ports = probe_ports(ip)
    register_map = {}

    if 502 in open_ports:
        register_map = sweep_modbus(ip, 502)

    for port in [5000, 5001, 5002]:
        if port in open_ports:
            mc_map = sweep_mc_protocol(ip, port)
            if mc_map:
                register_map.update(mc_map)
            break

    if register_map:
        generate_report(ip, open_ports, register_map)


# ─────────────────────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="IronSight Discovery — Find and reverse-engineer unknown PLCs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  scan               Scan the local network for devices
  probe <ip>         Probe industrial protocol ports on a target
  sweep <ip>         Full register sweep (find all populated addresses)
  watch <ip>         Live register monitoring (identifies counters, flags, etc.)

Examples:
  ironsight discover                            # Auto-discover everything
  ironsight discover scan                       # Just find devices
  ironsight discover probe 192.168.3.39         # Probe a specific IP
  ironsight discover sweep 192.168.3.39         # Map all registers
  ironsight discover watch 192.168.3.39         # Monitor live changes
  ironsight discover watch 192.168.3.39 --protocol mc --port 5000
        """,
    )
    parser.add_argument("command", nargs="?", default="auto",
                        choices=["auto", "scan", "probe", "sweep", "watch"],
                        help="Command to run (default: auto)")
    parser.add_argument("target", nargs="?", help="Target IP address")
    parser.add_argument("--subnet", help="Subnet to scan (e.g., 192.168.3.0/24)")
    parser.add_argument("--port", type=int, default=502, help="Port (default: 502)")
    parser.add_argument("--protocol", default="modbus", choices=["modbus", "mc"],
                        help="Protocol for watch mode (default: modbus)")
    parser.add_argument("--duration", type=int, default=60,
                        help="Watch duration in seconds (default: 60)")
    parser.add_argument("--interval", type=float, default=0.5,
                        help="Watch interval in seconds (default: 0.5)")

    args = parser.parse_args()

    if args.command == "scan":
        banner()
        scan_network(args.subnet)

    elif args.command == "probe":
        if not args.target:
            print("ERROR: probe requires a target IP. Usage: ironsight-discover.py probe <ip>")
            sys.exit(1)
        probe_single(args.target)

    elif args.command == "sweep":
        if not args.target:
            print("ERROR: sweep requires a target IP. Usage: ironsight-discover.py sweep <ip>")
            sys.exit(1)
        sweep_single(args.target)

    elif args.command == "watch":
        if not args.target:
            print("ERROR: watch requires a target IP. Usage: ironsight-discover.py watch <ip>")
            sys.exit(1)
        banner()
        watch_registers(args.target, port=args.port, protocol=args.protocol,
                        duration=args.duration, interval=args.interval)

    elif args.command == "auto":
        full_discovery(args.subnet)


if __name__ == "__main__":
    main()
