"""
Modbus and MC Protocol (Mitsubishi MELSEC) device discovery and register probing.
"""

import socket
import struct
import sys
import time
from typing import Dict, List

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    print("ERROR: pymodbus not installed. Run: pip3 install pymodbus")
    sys.exit(1)

from discovery.network import (
    BOLD, GREEN, YELLOW, CYAN, DIM, RED, RESET,
    MC_CMD_BATCH_READ, MITSUB_DEVICES,
    log,
)


def try_modbus(ip: str, port: int = 502) -> dict:
    """Try Modbus TCP communication and read device identity."""
    print(f"\n  {BOLD}── Modbus TCP ({ip}:{port}) ──{RESET}")
    result: dict = {"protocol": "Modbus TCP", "success": False, "data": {}}

    try:
        client = ModbusTcpClient(ip, port=port, timeout=3)
        if not client.connect():
            log("Could not establish TCP connection", "error")
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
                field_names = {
                    0: "VendorName", 1: "ProductCode", 2: "MajorMinorRevision",
                    3: "VendorUrl", 4: "ProductName", 5: "ModelName", 6: "UserAppName",
                }
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


# ── Modbus Register Sweep ──

def sweep_modbus(ip: str, port: int = 502) -> Dict[str, dict]:
    """Sweep all Modbus register ranges to find populated addresses."""
    print(f"\n{BOLD}═══ Phase 3: Register Sweep (Modbus) — {ip}:{port} ═══{RESET}\n")

    client = ModbusTcpClient(ip, port=port, timeout=3)
    if not client.connect():
        log("Cannot connect", "error")
        return {}

    register_map: Dict[str, dict] = {
        "holding_registers": {},
        "input_registers": {},
        "coils": {},
        "discrete_inputs": {},
    }

    # Sweep holding registers in blocks
    log("Sweeping holding registers (FC03)...")
    hr_ranges = [
        (0, 100), (100, 100), (200, 100), (500, 100), (1000, 100),
        (4000, 100), (4096, 100), (8192, 100), (16384, 10), (40000, 100),
    ]

    for start, count in hr_ranges:
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
    log(f"Found {GREEN}{populated}{RESET} non-zero holding registers",
        "ok" if populated else "warn")

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
    log(f"Found {GREEN}{populated}{RESET} non-zero input registers",
        "ok" if populated else "dim")

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
    log(f"Found {GREEN}{populated}{RESET} active coils",
        "ok" if populated else "dim")

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
    log(f"Found {GREEN}{populated}{RESET} active discrete inputs",
        "ok" if populated else "dim")

    client.close()
    print_register_map(register_map)
    return register_map


def read_all_modbus(client: ModbusTcpClient) -> dict:
    """Read all Modbus register spaces for a single snapshot."""
    snap: dict = {}
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


# ── Mitsubishi MC Protocol (MELSEC Binary) ──

def try_mc_protocol(ip: str, port: int = 5000) -> dict:
    """Try Mitsubishi MC Protocol (MELSEC binary) communication."""
    print(f"\n  {BOLD}── MC Protocol / MELSEC ({ip}:{port}) ──{RESET}")
    result: dict = {"protocol": "MC Protocol (MELSEC)", "success": False, "data": {}}

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
                log("MC Protocol response OK (end code: 0x0000)", "ok")
                result["success"] = True
                # Parse data words
                data_bytes = resp[11:]
                words: List[int] = []
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
        log("Connection timed out", "dim")
    except Exception as e:
        log(f"MC Protocol error: {e}", "error")

    return result


def mc_read_device(sock: socket.socket, device_code_byte: int,
                   start: int, count: int) -> List[int]:
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
            words: List[int] = []
            for i in range(0, len(data_bytes) - 1, 2):
                words.append(struct.unpack("<H", data_bytes[i:i+2])[0])
            return words
    return []


def sweep_mc_protocol(ip: str, port: int = 5000) -> Dict[str, dict]:
    """Sweep Mitsubishi MC Protocol device memory."""
    print(f"\n{BOLD}═══ Phase 3: Register Sweep (MC Protocol) — {ip}:{port} ═══{RESET}\n")

    register_map: Dict[str, dict] = {}

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        sock.connect((ip, port))
    except Exception as e:
        log(f"Cannot connect: {e}", "error")
        return {}

    for dev_name, (dev_code, dev_size) in MITSUB_DEVICES.items():
        if dev_size == 1:
            # Bit device — handled below
            continue

        log(f"Sweeping {dev_name} registers (device code 0x{dev_code:02X})...")
        device_regs: dict = {}

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
        device_bits: dict = {}

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
    print_mc_register_map(register_map)
    return register_map


def read_all_mc(sock: socket.socket) -> dict:
    """Read all Mitsubishi device memory via MC Protocol for a single snapshot."""
    snap: dict = {}
    for dev_name in ["D", "W", "T", "C", "SD"]:
        dev_code = MITSUB_DEVICES[dev_name][0]
        try:
            values = mc_read_device(sock, dev_code, 0, 100)
            for i, val in enumerate(values):
                snap[f"{dev_name}{i}"] = val
        except Exception:
            pass
    return snap


# ── Register map printing ──

def print_register_map(reg_map: Dict[str, dict]) -> None:
    """Pretty-print a Modbus register map."""
    print(f"\n{BOLD}  ── Register Map Summary ──{RESET}\n")

    for space, regs in reg_map.items():
        if not regs:
            continue
        label = space.replace("_", " ").title()
        print(f"  {BOLD}{label}{RESET} ({len(regs)} populated):")
        addrs = sorted(regs.keys()) if isinstance(regs, dict) else []
        for addr in addrs:
            val = regs[addr]
            if isinstance(val, bool):
                print(f"    [{addr:>6}] = {'ON' if val else 'OFF'}")
            else:
                signed = val - 65536 if val > 32767 else val
                extra = f" (signed: {signed})" if val > 32767 else ""
                print(f"    [{addr:>6}] = {val:<8} (0x{val:04X}){extra}")
        print()


def print_mc_register_map(reg_map: Dict[str, dict]) -> None:
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
