#!/usr/bin/env python3
"""
IronSight Diagnostic Agent — AI that can independently investigate truck problems.

Unlike the old one-shot prompt approach, this agent has TOOLS to query the system
directly. It can read PLC registers, check logs, look at trends, inspect network
state — whatever it needs to figure out the problem. The 19-rule diagnostic engine
is a starting point, not a ceiling.

Called by ironsight-touch.py as a subprocess:
  - Writes progress lines to PROGRESS_FILE so the touch screen can show live updates
  - Prints final diagnosis JSON to stdout
  - Exits when done

Usage:
    python3 diagnose_agent.py [--retry] [--prev-diagnosis "..."]

Requires: pip3 install anthropic pymodbus
"""

import argparse
import json
import os
import socket
import subprocess
import struct
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import anthropic
except ImportError:
    print(json.dumps({"error": "anthropic SDK not installed"}))
    sys.exit(1)

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    ModbusTcpClient = None

# ─────────────────────────────────────────────────────────────
#  Config
# ─────────────────────────────────────────────────────────────

PLC_HOST = "169.168.10.21"
PLC_PORT = 502
PROGRESS_FILE = Path("/tmp/ironsight-diagnose-progress.txt")
OFFLINE_BUFFER_DIR = Path("/home/andrew/.viam/offline-buffer")
CAPTURE_DIR = Path("/home/andrew/.viam/capture/rdk_component_sensor/plc-monitor/Readings")
MAX_TOOL_CALLS = 12  # safety limit — don't let it loop forever
MODEL = "claude-sonnet-4-20250514"

# PLC register labels (decoded from .ckp ladder logic)
DS_LABELS = {
    0: "DS1 Encoder Ignore", 1: "DS2 Tie Spacing (x0.5in)",
    2: "DS3 Tie Spacing (x0.1in)", 3: "DS4 Tenths Mile Laying",
    4: "DS5 Detector Offset Bits", 5: "DS6 Detector Offset (x0.1in)",
    6: "DS7 Plate Count", 7: "DS8 AVG Plates/Min",
    8: "DS9 Detector Next Tie", 9: "DS10 Encoder Next Tie",
    10: "DS11 Detector Bits", 11: "DS12 Last Detector Laid Inch",
    12: "DS13 2nd Pass Double Lay", 13: "DS14 Tie Team Skips",
    14: "DS15 Tie Team Lays", 15: "DS16 Skip Plus Lay Less 1",
    16: "DS17", 17: "DS18", 18: "DS19 HMI Screen",
    19: "DS20", 20: "DS21", 21: "DS22", 22: "DS23", 23: "DS24", 24: "DS25",
}

COIL_LABELS = {
    0: "C1", 1: "C2", 2: "C3 Camera Positive",
    3: "C4", 4: "C5", 5: "C6",
    6: "C7 First Tie Detected", 7: "C8", 8: "C9", 9: "C10",
    10: "C11", 11: "C12 Lay Ties Set", 12: "C13 Drop Ties",
    13: "C14 Drop Enable", 14: "C15 Drop Enable Latch",
    15: "C16 Software Eject", 16: "C17 Detector Eject",
    17: "C18", 18: "C19",
    19: "C20 TPS 1 Single", 20: "C21 TPS 1 Double",
    21: "C22 TPS 2 Left", 22: "C23 TPS 2 Right",
    23: "C24 TPS 2 Both", 24: "C25 TPS 2 Left Double",
    25: "C26 TPS 2 Right Double", 26: "C27 2nd Pass",
    27: "C28 Encoder Eject", 28: "C29 Encoder Mode",
    29: "C30 Detector Drop", 30: "C31 Backup Alarm",
    31: "C32 Double Lay Trigger", 32: "C33", 33: "C34",
}

INPUT_LABELS = {
    0: "X1 Encoder A", 1: "X2 Encoder B",
    2: "X3 Camera/Flipper", 3: "X4 TPS Power Loop",
    4: "X5 Air Eagle 1 Feedback", 5: "X6 Air Eagle 2 Feedback",
    6: "X7 Air Eagle 3 Enable", 7: "X8",
}

OUTPUT_LABELS = {
    0: "Y1 Eject TPS 1 Center", 1: "Y2 Eject Left TPS 2",
    2: "Y3 Eject Right TPS 2",
}


def _progress(msg: str):
    """Write a progress line for the touch screen to display."""
    try:
        PROGRESS_FILE.write_text(msg)
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────
#  Tool implementations
# ─────────────────────────────────────────────────────────────

def _plc_connected() -> bool:
    """Quick TCP check — is the PLC reachable?"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex((PLC_HOST, PLC_PORT))
        sock.close()
        return result == 0
    except Exception:
        return False


def tool_read_plc_registers(start: int = 0, count: int = 25) -> dict:
    """Read PLC holding registers (DS/DD). Returns labeled values."""
    if not ModbusTcpClient:
        return {"error": "pymodbus not installed"}
    if not _plc_connected():
        return {"error": "PLC not reachable at 169.168.10.21:502"}

    try:
        client = ModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=2)
        client.connect()
        r = client.read_holding_registers(address=start, count=count)
        client.close()
        if r.isError():
            return {"error": f"Modbus read error at addr {start}: {r}"}
        result = {}
        for i, val in enumerate(r.registers):
            addr = start + i
            label = DS_LABELS.get(addr, f"addr_{addr}")
            # Interpret as signed 16-bit
            if val > 32767:
                val = val - 65536
            result[label] = val
        return {"registers": result, "start_addr": start, "count": count}
    except Exception as e:
        return {"error": f"Modbus exception: {str(e)[:100]}"}


def tool_read_plc_encoder() -> dict:
    """Read DD1 raw encoder count (32-bit signed) from addresses 16384-16385."""
    if not ModbusTcpClient:
        return {"error": "pymodbus not installed"}
    if not _plc_connected():
        return {"error": "PLC not reachable"}

    try:
        client = ModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=2)
        client.connect()
        r = client.read_holding_registers(address=16384, count=2)
        client.close()
        if r.isError():
            return {"error": f"Read error: {r}"}
        lo = r.registers[0] & 0xFFFF
        hi = r.registers[1] & 0xFFFF
        count = (hi << 16) | lo
        if count > 0x7FFFFFFF:
            count -= 0x100000000
        return {
            "dd1_encoder_count": count,
            "note": "DD1 resets every ~10 counts at PLC scan rate. "
                    "Do NOT use for distance. Use DS10 Encoder Next Tie instead."
        }
    except Exception as e:
        return {"error": str(e)[:100]}


def tool_read_plc_coils() -> dict:
    """Read all application coils C1-C34 (operating modes, drops, etc)."""
    if not ModbusTcpClient:
        return {"error": "pymodbus not installed"}
    if not _plc_connected():
        return {"error": "PLC not reachable"}

    try:
        client = ModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=2)
        client.connect()

        result = {}

        # C1-C34 (application coils)
        r = client.read_coils(address=0, count=34)
        if not r.isError():
            for i in range(34):
                label = COIL_LABELS.get(i, f"C{i+1}")
                result[label] = bool(r.bits[i])

        # Y1-Y3 (output coils)
        r2 = client.read_coils(address=8192, count=3)
        if not r2.isError():
            for i in range(3):
                label = OUTPUT_LABELS.get(i, f"Y{i+1}")
                result[label] = bool(r2.bits[i])

        # C1999-C2000 (encoder control)
        r3 = client.read_coils(address=1998, count=2)
        if not r3.isError() and len(r3.bits) >= 2:
            result["C1999 Encoder Reset"] = bool(r3.bits[0])
            result["C2000 Floating Zero"] = bool(r3.bits[1])

        client.close()
        return {"coils": result}
    except Exception as e:
        return {"error": str(e)[:100]}


def tool_read_plc_inputs() -> dict:
    """Read discrete inputs X1-X8 (encoder channels, camera, power, air eagles)."""
    if not ModbusTcpClient:
        return {"error": "pymodbus not installed"}
    if not _plc_connected():
        return {"error": "PLC not reachable"}

    try:
        client = ModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=2)
        client.connect()
        r = client.read_discrete_inputs(address=0, count=8)
        client.close()
        if r.isError():
            return {"error": f"Read error: {r}"}
        result = {}
        for i in range(8):
            label = INPUT_LABELS.get(i, f"X{i+1}")
            result[label] = bool(r.bits[i])
        return {"inputs": result}
    except Exception as e:
        return {"error": str(e)[:100]}


def tool_get_sensor_history(minutes: int = 5) -> dict:
    """Get recent sensor readings from the offline buffer. Returns last N minutes of data."""
    minutes = min(minutes, 30)  # cap at 30 min to avoid huge responses
    try:
        if not OFFLINE_BUFFER_DIR.exists():
            return {"error": "Offline buffer directory not found"}
        jsonl_files = sorted(OFFLINE_BUFFER_DIR.glob("readings_*.jsonl"))
        if not jsonl_files:
            return {"error": "No buffer files found"}

        cutoff = time.time() - (minutes * 60)
        readings = []

        # Read from the latest file(s), going backwards
        for fpath in reversed(jsonl_files[-2:]):  # last 2 files max
            with open(fpath, "rb") as f:
                # Read last chunk (enough for the time window)
                f.seek(0, 2)
                size = f.tell()
                chunk_size = min(size, minutes * 60 * 500)  # ~500 bytes per reading at 1Hz
                f.seek(max(0, size - chunk_size))
                chunk = f.read()

            for line in chunk.strip().split(b"\n"):
                try:
                    data = json.loads(line)
                    epoch = data.get("epoch", 0)
                    if epoch >= cutoff:
                        # Return key fields only (not the full 100+ field record)
                        readings.append({
                            "ts": data.get("ts", ""),
                            "connected": data.get("connected"),
                            "speed_ftpm": data.get("encoder_speed_ftpm", 0),
                            "distance_ft": data.get("encoder_distance_ft", 0),
                            "plate_count": data.get("plate_drop_count", 0),
                            "ds10": data.get("ds10", 0),
                            "dd1": data.get("encoder_count", 0),
                            "camera_signal": data.get("camera_signal"),
                            "tps_power": data.get("tps_power_loop"),
                            "direction": data.get("encoder_direction"),
                            "eject_tps1": data.get("eject_tps_1"),
                            "spacing_in": data.get("last_drop_spacing_in", 0),
                            "modbus_ms": data.get("modbus_response_time_ms", 0),
                            "cam_rate": data.get("camera_detections_per_min", 0),
                            "cam_trend": data.get("camera_rate_trend", ""),
                            "eject_rate": data.get("eject_rate_per_min", 0),
                            "enc_noise": data.get("encoder_noise", 0),
                            "diagnostics_count": data.get("diagnostics_count", 0),
                        })
                except (json.JSONDecodeError, ValueError):
                    continue

        if not readings:
            return {"error": f"No readings in the last {minutes} minutes"}

        # Summarize trends instead of dumping every reading
        summary = {
            "time_range": f"{readings[0]['ts']} to {readings[-1]['ts']}",
            "reading_count": len(readings),
            "connection_changes": _count_changes(readings, "connected"),
            "latest": readings[-1],
        }

        # Detect trends
        speeds = [r["speed_ftpm"] for r in readings if r["speed_ftpm"] is not None]
        if speeds:
            summary["speed_min"] = min(speeds)
            summary["speed_max"] = max(speeds)
            summary["speed_avg"] = sum(speeds) / len(speeds)

        plates = [r["plate_count"] for r in readings if r["plate_count"] is not None]
        if plates and len(plates) > 1:
            summary["plates_start"] = plates[0]
            summary["plates_end"] = plates[-1]
            summary["plates_dropped_in_window"] = plates[-1] - plates[0]

        spacings = [r["spacing_in"] for r in readings if r["spacing_in"] and r["spacing_in"] > 0]
        if spacings:
            summary["spacing_min"] = min(spacings)
            summary["spacing_max"] = max(spacings)
            summary["spacing_avg"] = sum(spacings) / len(spacings)

        modbus_times = [r["modbus_ms"] for r in readings if r["modbus_ms"] and r["modbus_ms"] > 0]
        if modbus_times:
            summary["modbus_avg_ms"] = sum(modbus_times) / len(modbus_times)
            summary["modbus_max_ms"] = max(modbus_times)

        # Camera trend over window
        cam_trends = [r["cam_trend"] for r in readings if r["cam_trend"]]
        if cam_trends:
            summary["camera_trends_seen"] = list(set(cam_trends))

        # Direction changes
        summary["direction_changes"] = _count_changes(readings, "direction")

        # Sample 5 evenly-spaced readings for detail
        if len(readings) > 5:
            step = len(readings) // 5
            summary["samples"] = [readings[i * step] for i in range(5)]
        else:
            summary["samples"] = readings

        return summary

    except Exception as e:
        return {"error": str(e)[:200]}


def _count_changes(readings: list, field: str) -> int:
    """Count how many times a field changed value across readings."""
    changes = 0
    prev = None
    for r in readings:
        val = r.get(field)
        if prev is not None and val != prev:
            changes += 1
        prev = val
    return changes


def tool_check_network() -> dict:
    """Check network interfaces, connectivity, and routing."""
    result = {}

    # eth0 carrier
    try:
        carrier = Path("/sys/class/net/eth0/carrier").read_text().strip()
        result["eth0_carrier"] = carrier == "1"
    except Exception:
        result["eth0_carrier"] = False

    # eth0 IP
    try:
        r = subprocess.check_output(["ip", "-4", "addr", "show", "eth0"],
                                    text=True, timeout=5)
        for line in r.splitlines():
            if "inet " in line:
                result["eth0_ip"] = line.strip().split()[1]
    except Exception:
        result["eth0_ip"] = "none"

    # WiFi
    try:
        result["wifi_ssid"] = subprocess.check_output(
            ["iwgetid", "-r"], text=True, timeout=5).strip()
    except Exception:
        result["wifi_ssid"] = "none"

    # Internet
    try:
        r = subprocess.run(["ping", "-c", "1", "-W", "2", "8.8.8.8"],
                           capture_output=True, timeout=5)
        result["internet"] = r.returncode == 0
    except Exception:
        result["internet"] = False

    # PLC ping (ICMP)
    try:
        r = subprocess.run(["ping", "-c", "1", "-W", "1", PLC_HOST],
                           capture_output=True, timeout=3)
        result["plc_ping"] = r.returncode == 0
    except Exception:
        result["plc_ping"] = False

    # Default route
    try:
        r = subprocess.check_output(["ip", "route", "show", "default"],
                                    text=True, timeout=5)
        result["default_route"] = r.strip().split("\n")[0] if r.strip() else "none"
    except Exception:
        result["default_route"] = "unknown"

    # Tailscale
    try:
        result["tailscale_ip"] = subprocess.check_output(
            ["tailscale", "ip", "-4"], text=True, timeout=5).strip()
    except Exception:
        result["tailscale_ip"] = "none"

    # eth0 error counters (for diagnosing cable/hardware issues)
    try:
        stats = Path("/sys/class/net/eth0/statistics")
        result["eth0_rx_errors"] = int((stats / "rx_errors").read_text().strip())
        result["eth0_tx_errors"] = int((stats / "tx_errors").read_text().strip())
        result["eth0_rx_crc_errors"] = int((stats / "rx_crc_errors").read_text().strip())
        result["eth0_rx_dropped"] = int((stats / "rx_dropped").read_text().strip())
    except Exception:
        pass

    return result


def tool_check_services() -> dict:
    """Check status of key system services."""
    services = {}
    for svc in ["viam-server", "ironsight-touch", "ironsight-discovery",
                "NetworkManager", "tailscaled"]:
        try:
            r = subprocess.run(["systemctl", "is-active", svc],
                               capture_output=True, text=True, timeout=5)
            services[svc] = r.stdout.strip()
        except Exception:
            services[svc] = "unknown"

    # viam-server uptime
    try:
        r = subprocess.check_output(
            ["systemctl", "show", "viam-server", "--property=ActiveEnterTimestamp"],
            text=True, timeout=5)
        ts = r.strip().split("=", 1)[1] if "=" in r else ""
        services["viam_server_since"] = ts
    except Exception:
        pass

    return services


def tool_get_system_logs(service: str = "viam-server", minutes: int = 5) -> dict:
    """Get recent journal logs for a service. Returns last N minutes."""
    minutes = min(minutes, 15)  # cap to avoid huge output
    try:
        r = subprocess.run(
            ["journalctl", "-u", service, f"--since={minutes} min ago",
             "--no-pager", "-n", "50"],
            capture_output=True, text=True, timeout=10)
        lines = r.stdout.strip().splitlines()
        # Classify lines
        errors = [l for l in lines if "ERROR" in l or "FAIL" in l or "error" in l.lower()]
        warnings = [l for l in lines if "WARN" in l]
        return {
            "service": service,
            "total_lines": len(lines),
            "errors": errors[-10:],  # last 10 errors
            "warnings": warnings[-10:],
            "last_5_lines": lines[-5:] if lines else [],
        }
    except Exception as e:
        return {"error": str(e)[:100]}


def tool_get_system_health() -> dict:
    """Get Pi system health: CPU temp, disk, memory, uptime."""
    health = {}

    try:
        temp = float(Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip())
        health["cpu_temp_f"] = round(temp / 1000 * 9 / 5 + 32, 1)
    except Exception:
        pass

    try:
        r = subprocess.check_output(["df", "/", "--output=pcent"], text=True, timeout=5)
        for line in r.strip().splitlines():
            line = line.strip()
            if line.endswith("%"):
                health["disk_pct"] = int(line.rstrip("%"))
    except Exception:
        pass

    try:
        mem = Path("/proc/meminfo").read_text()
        total = avail = 0
        for line in mem.splitlines():
            if line.startswith("MemTotal:"):
                total = int(line.split()[1])
            elif line.startswith("MemAvailable:"):
                avail = int(line.split()[1])
        if total > 0:
            health["mem_pct"] = int(100 * (total - avail) / total)
    except Exception:
        pass

    try:
        up = float(Path("/proc/uptime").read_text().split()[0])
        health["uptime_hours"] = round(up / 3600, 1)
    except Exception:
        pass

    # Capture status
    try:
        if CAPTURE_DIR.exists():
            prog_files = sorted(CAPTURE_DIR.glob("*.prog"))
            if prog_files:
                latest = prog_files[-1]
                health["capture_size"] = latest.stat().st_size
                health["capture_age_s"] = round(time.time() - latest.stat().st_mtime, 1)
            health["completed_captures"] = len(list(CAPTURE_DIR.glob("*.capture")))
    except Exception:
        pass

    return health


def tool_read_plc_timers() -> dict:
    """Read PLC timer registers TD1-TD12 (addr 24576-24587)."""
    if not ModbusTcpClient:
        return {"error": "pymodbus not installed"}
    if not _plc_connected():
        return {"error": "PLC not reachable"}

    try:
        client = ModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=2)
        client.connect()
        r = client.read_holding_registers(address=24576, count=12)
        client.close()
        if r.isError():
            return {"error": f"Read error: {r}"}
        result = {}
        for i, val in enumerate(r.registers):
            result[f"TD{i+1}"] = val
        return {"timers": result}
    except Exception as e:
        return {"error": str(e)[:100]}


def tool_sample_plc_fast(register: str = "ds10", samples: int = 5,
                          interval_ms: int = 500) -> dict:
    """Take multiple rapid samples of a PLC register to detect changes/trends.

    Useful for checking if encoder is moving, if signals are toggling, etc.
    """
    if not ModbusTcpClient:
        return {"error": "pymodbus not installed"}
    if not _plc_connected():
        return {"error": "PLC not reachable"}

    samples = min(samples, 10)
    interval_ms = max(200, min(interval_ms, 2000))

    # Map register name to Modbus address
    reg_map = {}
    for i in range(25):
        reg_map[f"ds{i+1}"] = ("holding", i, 1)
    reg_map["dd1"] = ("holding", 16384, 2)
    reg_map["x3"] = ("discrete", 2, 1)
    reg_map["x4"] = ("discrete", 3, 1)
    reg_map["y1"] = ("coil", 8192, 1)

    register = register.lower()
    if register not in reg_map:
        return {"error": f"Unknown register '{register}'. Available: {list(reg_map.keys())}"}

    reg_type, addr, count = reg_map[register]

    try:
        client = ModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=2)
        client.connect()
        results = []
        for _ in range(samples):
            ts = time.time()
            if reg_type == "holding":
                r = client.read_holding_registers(address=addr, count=count)
                if not r.isError():
                    if count == 2:
                        lo = r.registers[0] & 0xFFFF
                        hi = r.registers[1] & 0xFFFF
                        val = (hi << 16) | lo
                        if val > 0x7FFFFFFF:
                            val -= 0x100000000
                    else:
                        val = r.registers[0]
                        if val > 32767:
                            val -= 65536
                    results.append({"t": round(ts, 3), "val": val})
            elif reg_type == "discrete":
                r = client.read_discrete_inputs(address=addr, count=1)
                if not r.isError():
                    results.append({"t": round(ts, 3), "val": bool(r.bits[0])})
            elif reg_type == "coil":
                r = client.read_coils(address=addr, count=1)
                if not r.isError():
                    results.append({"t": round(ts, 3), "val": bool(r.bits[0])})
            time.sleep(interval_ms / 1000)
        client.close()

        # Analyze
        vals = [r["val"] for r in results]
        analysis = {"register": register, "samples": results}
        if all(isinstance(v, (int, float)) for v in vals):
            analysis["min"] = min(vals)
            analysis["max"] = max(vals)
            analysis["changed"] = len(set(vals)) > 1
            if len(vals) > 1:
                deltas = [vals[i+1] - vals[i] for i in range(len(vals)-1)]
                analysis["deltas"] = deltas
                analysis["trend"] = "increasing" if all(d > 0 for d in deltas) else \
                                    "decreasing" if all(d < 0 for d in deltas) else \
                                    "stable" if all(d == 0 for d in deltas) else "mixed"
        else:
            analysis["values"] = vals
            analysis["changed"] = len(set(str(v) for v in vals)) > 1

        return analysis
    except Exception as e:
        return {"error": str(e)[:100]}


# ─────────────────────────────────────────────────────────────
#  Tool definitions for Claude API
# ─────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "read_plc_registers",
        "description": (
            "Read PLC holding registers (DS1-DS25 at addr 0-24). "
            "Key registers: DS2=Tie Spacing (x0.5in, 39=19.5in), "
            "DS7=Plate Count, DS8=AVG Plates/Min, "
            "DS10=Encoder Next Tie (counts down from DS3, THE distance source). "
            "Can also read other address ranges."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "start": {"type": "integer", "description": "Start address (default 0)", "default": 0},
                "count": {"type": "integer", "description": "Number of registers (default 25)", "default": 25},
            },
        },
    },
    {
        "name": "read_plc_encoder",
        "description": (
            "Read DD1 raw encoder count (32-bit signed). NOTE: DD1 is NOT usable "
            "for distance — PLC resets it every ~10 counts. Use DS10 for distance. "
            "DD1 is useful for: checking if encoder is spinning, delta direction detection."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "read_plc_coils",
        "description": (
            "Read all PLC coils: C1-C34 (app coils including operating modes C20-C27, "
            "drop pipeline C14-C17/C28-C32, detection C3/C7), Y1-Y3 (eject outputs), "
            "C1999-C2000 (encoder reset/floating zero)."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "read_plc_inputs",
        "description": (
            "Read discrete inputs X1-X8: X1/X2=encoder channels, "
            "X3=camera/flipper signal, X4=TPS power loop, "
            "X5-X7=Air Eagle feedback/enable."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_sensor_history",
        "description": (
            "Get recent sensor readings from offline buffer. Returns trend summary "
            "with min/max/avg for speed, plates, spacing, modbus latency, plus "
            "connection changes and direction changes. Max 30 minutes."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "minutes": {"type": "integer", "description": "Minutes of history (default 5, max 30)", "default": 5},
            },
        },
    },
    {
        "name": "check_network",
        "description": (
            "Check all network interfaces: eth0 carrier/IP/error counters, "
            "WiFi SSID, internet connectivity, PLC ICMP ping, default route, "
            "Tailscale IP. Good for diagnosing connection issues."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "check_services",
        "description": (
            "Check status of system services: viam-server, ironsight-touch, "
            "ironsight-discovery, NetworkManager, tailscaled. "
            "Includes viam-server start time."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_system_logs",
        "description": (
            "Get recent journal logs for a service. Returns errors, warnings, "
            "and last few lines. Useful for diagnosing crashes, connection failures, "
            "or unexpected behavior."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "service": {"type": "string", "description": "Service name (default: viam-server)", "default": "viam-server"},
                "minutes": {"type": "integer", "description": "Minutes of logs (default 5, max 15)", "default": 5},
            },
        },
    },
    {
        "name": "get_system_health",
        "description": (
            "Get Pi hardware health: CPU temperature, disk usage, memory usage, "
            "uptime, and Viam capture file status."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "read_plc_timers",
        "description": "Read PLC timer registers TD1-TD12. TD5=seconds laying, TD6=tie travel timer.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "sample_plc_fast",
        "description": (
            "Take multiple rapid samples of a single PLC register to detect movement "
            "or signal toggling. Returns values, deltas, and trend analysis. "
            "Available registers: ds1-ds25, dd1, x3, x4, y1."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "register": {"type": "string", "description": "Register to sample (e.g. 'ds10', 'dd1', 'x3')"},
                "samples": {"type": "integer", "description": "Number of samples (default 5, max 10)", "default": 5},
                "interval_ms": {"type": "integer", "description": "Milliseconds between samples (default 500)", "default": 500},
            },
            "required": ["register"],
        },
    },
]

TOOL_DISPATCH = {
    "read_plc_registers": tool_read_plc_registers,
    "read_plc_encoder": tool_read_plc_encoder,
    "read_plc_coils": tool_read_plc_coils,
    "read_plc_inputs": tool_read_plc_inputs,
    "get_sensor_history": tool_get_sensor_history,
    "check_network": tool_check_network,
    "check_services": tool_check_services,
    "get_system_logs": tool_get_system_logs,
    "get_system_health": tool_get_system_health,
    "read_plc_timers": tool_read_plc_timers,
    "sample_plc_fast": tool_sample_plc_fast,
}


# ─────────────────────────────────────────────────────────────
#  Agent loop
# ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are IronSight, a diagnostic AI on a TPS (Tie Plate System) railroad truck.
You have tools to directly query the PLC, read sensor history, check network/services/logs.

Your job: figure out what's wrong (or confirm everything is fine) by INVESTIGATING.
Do NOT guess. Use your tools to gather evidence, then draw conclusions.

Investigation approach:
1. Start with the current snapshot (provided in the first message)
2. If something looks off, dig deeper — read specific registers, check trends, sample signals
3. Cross-reference: e.g. if plates aren't dropping, check encoder (moving?), camera (detecting?), coils (drop enabled?), eject outputs (firing?)
4. Check for intermittent issues by looking at history/trends, not just current values

CRITICAL KNOWLEDGE:
- DD1 (raw encoder) resets every ~10 counts at PLC scan rate. NEVER use DD1 for distance.
- DS10 (Encoder Next Tie) counts down from DS3 to 0 for each tie spacing. This IS the distance source.
- DS2=39 means 19.5" tie spacing (x0.5"). DS3=195 means 19.5" (x0.1").
- X3 is the camera/flipper tie detector. X4 is TPS power loop.
- Y1 is the eject solenoid for TPS 1.
- C13=Drop Ties, C14=Drop Enable. Both must be ON for plates to drop.
- eth0 NO-CARRIER means physical cable disconnected or PLC powered off.

IMPORTANT — your final answer is displayed on a 3.5-inch touchscreen for a railroad worker:
- Final diagnosis: 3-5 SHORT sentences, plain text, NO markdown
- Start with ALL CLEAR or the problem name
- Give PRACTICAL advice: check cables, power cycle, look at lights, listen for sounds
- Do NOT tell them to check registers or run commands — they are in the field with gloves on
- Include what evidence you found (in simple terms)
"""


def run_agent(initial_context: str, retry: bool = False, prev_diagnosis: str = "") -> str:
    """Run the diagnostic agent loop. Returns the final diagnosis text."""
    client = anthropic.Anthropic()

    # Build initial message
    user_msg = f"Current system snapshot:\n\n{initial_context}\n\n"
    if retry and prev_diagnosis:
        user_msg += (
            f"PREVIOUS DIAGNOSIS (operator says it didn't help):\n\"{prev_diagnosis}\"\n\n"
            "Investigate deeper. Check things the previous diagnosis missed. "
            "Use your tools to gather fresh evidence.\n"
        )
    else:
        user_msg += (
            "Investigate this system. Use your tools to check whatever you need. "
            "When you have enough evidence, give your diagnosis.\n"
        )

    messages = [{"role": "user", "content": user_msg}]

    tool_call_count = 0
    _progress("Investigating...")

    while tool_call_count < MAX_TOOL_CALLS:
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # Check if Claude wants to use tools
        if response.stop_reason == "tool_use":
            # Process all tool calls in this response
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    tool_call_count += 1
                    tool_name = block.name
                    tool_input = block.input or {}

                    # Show progress on the touchscreen
                    progress_labels = {
                        "read_plc_registers": "Reading PLC registers...",
                        "read_plc_encoder": "Checking encoder...",
                        "read_plc_coils": "Checking control coils...",
                        "read_plc_inputs": "Checking inputs...",
                        "get_sensor_history": "Analyzing trends...",
                        "check_network": "Checking network...",
                        "check_services": "Checking services...",
                        "get_system_logs": "Reading logs...",
                        "get_system_health": "Checking system health...",
                        "read_plc_timers": "Reading timers...",
                        "sample_plc_fast": f"Sampling {tool_input.get('register', '?')}...",
                    }
                    _progress(progress_labels.get(tool_name, f"Running {tool_name}..."))

                    # Execute the tool
                    fn = TOOL_DISPATCH.get(tool_name)
                    if fn:
                        try:
                            result = fn(**tool_input)
                        except TypeError:
                            result = fn()
                        except Exception as e:
                            result = {"error": str(e)[:200]}
                    else:
                        result = {"error": f"Unknown tool: {tool_name}"}

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result, default=str),
                    })

            # Add Claude's response and tool results to conversation
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})

        else:
            # Claude is done — extract the final text
            _progress("Done")
            final_text = ""
            reasoning = ""
            for block in response.content:
                if hasattr(block, "text"):
                    final_text += block.text

            # Parse reasoning if included
            if "REASON:" in final_text:
                parts = final_text.split("REASON:", 1)
                final_text = parts[0].strip()
                reasoning = parts[1].strip()

            return json.dumps({
                "diagnosis": final_text,
                "reasoning": reasoning,
                "tool_calls": tool_call_count,
            })

    # Safety limit reached
    _progress("Done")
    return json.dumps({
        "diagnosis": "Investigation took too long. Based on what I found so far, check the system manually.",
        "reasoning": f"Hit {MAX_TOOL_CALLS} tool call limit",
        "tool_calls": tool_call_count,
    })


def build_initial_context() -> str:
    """Build the initial system snapshot that starts the investigation."""
    parts = []

    # Live connectivity
    plc_ok = _plc_connected()
    parts.append(f"PLC: {'CONNECTED' if plc_ok else 'DISCONNECTED'} ({PLC_HOST}:502)")

    try:
        carrier = Path("/sys/class/net/eth0/carrier").read_text().strip() == "1"
    except Exception:
        carrier = False
    parts.append(f"eth0: {'linked' if carrier else 'NO CARRIER'}")

    try:
        r = subprocess.run(["ping", "-c", "1", "-W", "2", "8.8.8.8"],
                           capture_output=True, timeout=5)
        parts.append(f"Internet: {'connected' if r.returncode == 0 else 'OFFLINE'}")
    except Exception:
        parts.append("Internet: unknown")

    try:
        ssid = subprocess.check_output(["iwgetid", "-r"], text=True, timeout=5).strip()
        parts.append(f"WiFi: {ssid}")
    except Exception:
        parts.append("WiFi: unknown")

    try:
        r = subprocess.run(["systemctl", "is-active", "viam-server"],
                           capture_output=True, text=True, timeout=5)
        parts.append(f"viam-server: {r.stdout.strip()}")
    except Exception:
        parts.append("viam-server: unknown")

    # Latest sensor reading summary
    try:
        buf_dir = OFFLINE_BUFFER_DIR
        if buf_dir.exists():
            jsonl_files = sorted(buf_dir.glob("readings_*.jsonl"))
            if jsonl_files:
                with open(jsonl_files[-1], "rb") as f:
                    f.seek(0, 2)
                    size = f.tell()
                    f.seek(max(0, size - 4096))
                    chunk = f.read()
                for line in reversed(chunk.strip().split(b"\n")):
                    try:
                        data = json.loads(line)
                        ts = data.get("ts", "?")
                        parts.append(f"\nLatest sensor reading ({ts}):")
                        parts.append(f"  Speed: {data.get('encoder_speed_ftpm', 0):.1f} ft/min")
                        parts.append(f"  Plates: {data.get('plate_drop_count', 0)}")
                        parts.append(f"  Direction: {data.get('encoder_direction', '?')}")
                        parts.append(f"  TPS Power: {'ON' if data.get('tps_power_loop') else 'OFF'}")
                        parts.append(f"  Camera signal: {'ON' if data.get('camera_signal') else 'OFF'}")
                        parts.append(f"  Modbus latency: {data.get('modbus_response_time_ms', 0):.1f}ms")
                        parts.append(f"  Diagnostics active: {data.get('diagnostics_count', 0)}")

                        # Include active diagnostics
                        diags = data.get("diagnostics", [])
                        if isinstance(diags, str):
                            try:
                                diags = json.loads(diags)
                            except Exception:
                                diags = []
                        if diags:
                            parts.append("  Active diagnostics:")
                            for d in diags[:5]:
                                if isinstance(d, dict):
                                    parts.append(f"    [{d.get('severity', '?')}] {d.get('title', '?')}")
                        break
                    except (json.JSONDecodeError, ValueError):
                        continue
    except Exception:
        parts.append("\nNo sensor data available")

    return "\n".join(parts)


# ─────────────────────────────────────────────────────────────
#  Main
# ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="IronSight Diagnostic Agent")
    parser.add_argument("--retry", action="store_true",
                        help="Re-investigate (previous fix didn't work)")
    parser.add_argument("--prev-diagnosis", type=str, default="",
                        help="Previous diagnosis text (for retry mode)")
    args = parser.parse_args()

    _progress("Starting investigation...")

    try:
        context = build_initial_context()
        result = run_agent(context, retry=args.retry, prev_diagnosis=args.prev_diagnosis)
        print(result)
    except Exception as e:
        print(json.dumps({
            "diagnosis": f"Agent error: {str(e)[:100]}. Check internet connection.",
            "reasoning": "",
            "tool_calls": 0,
            "error": str(e),
        }))
    finally:
        # Clean up progress file
        try:
            PROGRESS_FILE.unlink(missing_ok=True)
        except Exception:
            pass


if __name__ == "__main__":
    main()
