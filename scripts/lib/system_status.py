"""
System status gathering for IronSight.

Collects live system health: viam-server, PLC connectivity, network,
disk/CPU/memory, battery, and merges with latest sensor data from the
offline buffer. Injects real-time diagnostics on top.

Usage:
    from lib.system_status import get_system_status, get_battery_status
"""

import glob as _glob
import json
import os
import re
import socket
import subprocess
import time
from pathlib import Path

from lib.plc_constants import PLC_HOST, PLC_PORT, OFFLINE_BUFFER_DIR, VIAM_CONFIG_PATH
from lib.buffer_reader import read_latest_entry, get_data_age_seconds

PISUGAR_SOCK = "/tmp/pisugar-server.sock"
STATUS_FILE = Path("/tmp/ironsight-status.json")
HISTORY_FILE = Path("/tmp/ironsight-history.json")


def _pisugar_query(cmd: str) -> str:
    """Query the PiSugar server via Unix socket."""
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(1)
        s.connect(PISUGAR_SOCK)
        s.sendall((cmd + "\n").encode())
        data = s.recv(256).decode().strip()
        s.close()
        return data
    except Exception:
        return ""


def get_battery_status() -> dict:
    """Read battery info from PiSugar 3 Plus with glitch filtering."""
    battery = {
        "available": False,
        "percent": -1,
        "voltage": 0.0,
        "charging": False,
        "power_plugged": False,
    }
    try:
        resp = _pisugar_query("get battery")
        if resp and ":" in resp:
            pct = float(resp.split(":")[1].strip())
            battery["available"] = True

            resp_v = _pisugar_query("get battery_v")
            voltage = 0.0
            if resp_v and ":" in resp_v:
                voltage = float(resp_v.split(":")[1].strip())
            battery["voltage"] = voltage

            sane = True
            if voltage > 2.0:
                v_pct = max(0, min(100, (voltage - 3.0) / 1.2 * 100))
                if abs(pct - v_pct) > 40:
                    sane = False

            last = getattr(get_battery_status, "_last_good_pct", None)
            if sane and last is not None:
                if abs(pct - last) > 15:
                    sane = False

            if sane:
                battery["percent"] = pct
                get_battery_status._last_good_pct = pct
            elif last is not None:
                battery["percent"] = last
            else:
                battery["percent"] = pct
                get_battery_status._last_good_pct = pct

        resp = _pisugar_query("get battery_charging")
        if resp and ":" in resp:
            battery["charging"] = resp.split(":")[1].strip().lower() == "true"

        resp = _pisugar_query("get battery_power_plugged")
        if resp and ":" in resp:
            battery["power_plugged"] = resp.split(":")[1].strip().lower() == "true"
    except Exception:
        pass
    return battery


def get_component_status() -> dict:
    try:
        return json.loads(STATUS_FILE.read_text()).get("components", {})
    except Exception:
        return {}


def get_activity_history() -> list:
    try:
        return json.loads(HISTORY_FILE.read_text())
    except Exception:
        return []


def get_system_status() -> dict:
    """Gather live system health. Returns comprehensive status dict."""
    status = {
        "viam_server": False,
        "plc_reachable": False,
        "plc_ip": "unknown",
        "internet": False,
        "disk_pct": 0,
        "uptime": "",
        "truck_id": "unknown",
        "connected": False,
        "travel_ft": 0.0,
        "speed_ftpm": 0.0,
        "plate_count": 0,
        "plates_per_min": 0.0,
        "system_state": "unknown",
        "last_spacing_in": 0.0,
        "avg_spacing_in": 0.0,
        "ds_registers": {},
        "eth0_carrier": False,
        "wifi_ssid": "",
        "wifi_signal_dbm": 0,
        "iphone_connected": False,
        "cpu_temp": 0.0,
        "mem_pct": 0,
        "tailscale_ip": "",
        "eth0_ip": "",
        "battery": {"available": False, "percent": -1, "voltage": 0.0,
                     "charging": False, "power_plugged": False},
        "diagnostics": [],
        "tps_power_loop": False,
        "camera_rate": 0.0,
        "tps_mode": "",
        "encoder_direction": "forward",
    }

    # viam-server
    try:
        r = subprocess.run(["systemctl", "is-active", "viam-server"],
                           capture_output=True, text=True, timeout=5)
        status["viam_server"] = r.stdout.strip() == "active"
    except Exception:
        pass

    # Internet
    try:
        r = subprocess.run(["ping", "-c", "1", "-W", "2", "8.8.8.8"],
                           capture_output=True, timeout=5)
        status["internet"] = r.returncode == 0
    except Exception:
        pass

    # Disk
    try:
        r = subprocess.check_output(["df", "/", "--output=pcent"], text=True, timeout=5)
        for line in r.strip().splitlines():
            line = line.strip()
            if line.endswith("%"):
                status["disk_pct"] = int(line.rstrip("%"))
    except Exception:
        pass

    # Uptime
    try:
        up = float(Path("/proc/uptime").read_text().split()[0])
        hours = int(up // 3600)
        mins = int((up % 3600) // 60)
        status["uptime"] = f"{hours}h {mins}m"
    except Exception:
        status["uptime"] = "?"

    # eth0 carrier + IP
    try:
        status["eth0_carrier"] = Path("/sys/class/net/eth0/carrier").read_text().strip() == "1"
    except Exception:
        pass
    try:
        r = subprocess.check_output(
            ["ip", "-4", "addr", "show", "eth0"], text=True, timeout=5)
        for line in r.splitlines():
            if "inet " in line:
                status["eth0_ip"] = line.strip().split()[1].split("/")[0]
    except Exception:
        pass

    # WiFi SSID + signal
    try:
        status["wifi_ssid"] = subprocess.check_output(
            ["iwgetid", "-r"], text=True, timeout=5).strip()
    except Exception:
        pass
    try:
        r = subprocess.check_output(
            ["iwconfig", "wlan0"], text=True, timeout=5, stderr=subprocess.DEVNULL)
        for line in r.splitlines():
            if "Signal level" in line:
                m = re.search(r"Signal level[=:]?\s*(-?\d+)", line)
                if m:
                    status["wifi_signal_dbm"] = int(m.group(1))
    except Exception:
        pass

    # Default route
    try:
        r = subprocess.check_output(
            ["ip", "route", "show", "default"], text=True, timeout=5)
        default_line = r.strip().split("\n")[0] if r.strip() else ""
        status["active_interface"] = ""
        if "dev " in default_line:
            status["active_interface"] = default_line.split("dev ")[1].split()[0]
    except Exception:
        pass

    # iPhone USB tethering
    try:
        for driver_path in _glob.glob("/sys/class/net/*/device/driver"):
            if "ipheth" in os.readlink(driver_path):
                status["iphone_connected"] = True
                break
    except Exception:
        pass

    # Tailscale IP
    try:
        status["tailscale_ip"] = subprocess.check_output(
            ["tailscale", "ip", "-4"], text=True, timeout=5).strip()
    except Exception:
        pass

    # CPU temp
    try:
        temp = float(Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip())
        status["cpu_temp"] = temp / 1000.0
    except Exception:
        pass

    # Memory
    try:
        mem = Path("/proc/meminfo").read_text()
        total = avail = 0
        for line in mem.splitlines():
            if line.startswith("MemTotal:"):
                total = int(line.split()[1])
            elif line.startswith("MemAvailable:"):
                avail = int(line.split()[1])
        if total > 0:
            status["mem_pct"] = int(100 * (total - avail) / total)
    except Exception:
        pass

    # Battery
    status["battery"] = get_battery_status()

    # PLC config
    try:
        config = json.loads(VIAM_CONFIG_PATH.read_text())
        for comp in config.get("components", []):
            if comp.get("name") == "plc-monitor":
                status["plc_ip"] = comp["attributes"]["host"]
                status["truck_id"] = comp["attributes"].get("truck_id", "unknown")
    except Exception:
        pass

    # PLC reachability
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex((status["plc_ip"], 502))
        sock.close()
        status["plc_reachable"] = result == 0
        status["connected"] = result == 0
    except Exception:
        pass

    live_plc_reachable = status["plc_reachable"]
    live_connected = status["connected"]

    # Latest reading from offline buffer
    data = read_latest_entry()
    data_age_seconds = get_data_age_seconds(data) if data else float("inf")

    if data:
        status["travel_ft"] = data.get("encoder_distance_ft", 0)
        status["speed_ftpm"] = data.get("encoder_speed_ftpm", 0)
        status["plate_count"] = data.get("plate_drop_count", 0)
        status["plates_per_min"] = data.get("plates_per_minute", 0)
        status["system_state"] = data.get("system_state", "unknown")
        status["last_spacing_in"] = data.get("last_drop_spacing_in", 0)
        status["avg_spacing_in"] = data.get("avg_drop_spacing_in", 0)
        raw_diag = data.get("diagnostics", [])
        if isinstance(raw_diag, str):
            try:
                raw_diag = json.loads(raw_diag)
            except (json.JSONDecodeError, ValueError):
                raw_diag = []
        status["diagnostics"] = raw_diag if isinstance(raw_diag, list) else []
        status["tps_power_loop"] = data.get("tps_power_loop", False)
        status["camera_rate"] = data.get("camera_rate", 0.0)
        status["tps_mode"] = data.get("tps_mode", "")
        status["encoder_direction"] = data.get("encoder_direction", "forward")
        for i in range(1, 26):
            key = f"ds{i}"
            if key in data:
                status["ds_registers"][key] = data[key]

    # Restore live PLC connection state (authoritative over cached buffer)
    status["plc_reachable"] = live_plc_reachable
    status["connected"] = live_connected
    status["data_age_seconds"] = data_age_seconds

    # Live diagnostic injection
    live_diags = list(status["diagnostics"])

    if not status["eth0_carrier"]:
        live_diags.append({
            "id": "eth0-no-carrier", "severity": "critical",
            "title": "Ethernet Cable Disconnected",
            "action": "No carrier on eth0 — check the Ethernet cable between Pi and PLC.",
        })
    elif not live_connected:
        live_diags.append({
            "id": "plc-unreachable", "severity": "critical",
            "title": "PLC Not Responding",
            "action": "Ethernet link up but PLC not responding on port 502. "
                      "Check PLC power and Modbus TCP settings.",
        })

    if data_age_seconds > 30:
        if data_age_seconds > 3600:
            age_str = f"{data_age_seconds / 3600:.1f} hours"
        elif data_age_seconds > 60:
            age_str = f"{data_age_seconds / 60:.0f} minutes"
        else:
            age_str = f"{data_age_seconds:.0f} seconds"
        live_diags.append({
            "id": "stale-data", "severity": "warning",
            "title": f"Sensor Data Stale ({age_str} old)",
            "action": "No fresh readings from plc-sensor. "
                      "Check if viam-server is running and PLC is connected.",
        })

    if not status["viam_server"]:
        live_diags.append({
            "id": "viam-down", "severity": "critical",
            "title": "viam-server Not Running",
            "action": "viam-server is not active. Go to Commands and tap Restart Viam.",
        })

    status["diagnostics"] = live_diags
    return status
