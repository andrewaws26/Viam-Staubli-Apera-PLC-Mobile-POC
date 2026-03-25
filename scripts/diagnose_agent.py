#!/usr/bin/env python3
"""
IronSight Diagnostic Agent — single-shot AI diagnosis.

Pre-gathers ALL evidence (PLC registers, logs, network, sensors) in Python,
then makes ONE Claude CLI call with all data pre-loaded. No tool loop.
Haiku model for speed (~5-15 seconds total).

Called by voice_chat.py as a subprocess:
  - Writes progress to /tmp/ironsight-diagnose-progress.txt
  - Prints final diagnosis JSON to stdout
  - Exits when done

Usage:
    python3 diagnose_agent.py [--retry] [--prev-diagnosis "..."]
"""

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.plc_constants import PLC_HOST, PLC_PORT, OFFLINE_BUFFER_DIR, \
    DS_SHORT_LABELS, CAPTURE_DIR
from lib.buffer_reader import read_latest_entry, read_history

PROGRESS_FILE = Path("/tmp/ironsight-diagnose-progress.txt")
SCRIPTS_DIR = Path(__file__).resolve().parent


def _progress(msg: str):
    """Write a progress line for the touch screen to display."""
    try:
        PROGRESS_FILE.write_text(msg)
    except Exception:
        pass


# ── Evidence gatherers (run in parallel) ─────────────────────────────

def _gather_plc() -> str:
    """Read PLC registers via pymodbus. Returns formatted string."""
    try:
        from pymodbus.client import ModbusTcpClient
    except ImportError:
        return "PLC: pymodbus not installed"

    try:
        client = ModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=2)
        if not client.connect():
            return "PLC: Cannot connect (powered off or cable disconnected)"

        parts = []
        t0 = time.monotonic()

        # DS registers (holding 0-24)
        r = client.read_holding_registers(address=0, count=25)
        if not r.isError():
            parts.append("DS Registers (holding 0-24):")
            for i, val in enumerate(r.registers):
                name = f"DS{i+1}"
                label = DS_SHORT_LABELS.get(name.lower(), "")
                label_str = f" ({label})" if label else ""
                parts.append(f"  {name}={val & 0xFFFF}{label_str}")
        else:
            parts.append(f"DS Registers: read error — {r}")

        # DD1 encoder (addresses 16384-16385, 32-bit signed)
        r = client.read_holding_registers(address=16384, count=2)
        if not r.isError():
            lo, hi = r.registers[0] & 0xFFFF, r.registers[1] & 0xFFFF
            dd1 = (hi << 16) | lo
            if dd1 >= 0x80000000:
                dd1 -= 0x100000000
            parts.append(f"\nDD1 (raw encoder): {dd1}")
        else:
            parts.append(f"\nDD1: read error — {r}")

        # X inputs (discrete 0-7)
        r = client.read_discrete_inputs(address=0, count=8)
        if not r.isError():
            x_labels = ["X1", "X2", "X3 (camera)", "X4 (TPS power)",
                        "X5", "X6", "X7", "X8"]
            x_parts = [f"{x_labels[i]}={'ON' if b else 'OFF'}"
                       for i, b in enumerate(r.bits[:8])]
            parts.append(f"\nInputs: {', '.join(x_parts)}")
        else:
            parts.append(f"\nInputs: read error — {r}")

        # Y outputs (coils 8192-8194)
        r = client.read_coils(address=8192, count=3)
        if not r.isError():
            y_labels = ["Y1 (eject)", "Y2", "Y3"]
            y_parts = [f"{y_labels[i]}={'ON' if b else 'OFF'}"
                       for i, b in enumerate(r.bits[:3])]
            parts.append(f"Outputs: {', '.join(y_parts)}")
        else:
            parts.append(f"Outputs: read error — {r}")

        # C coils (control bits 0-33)
        r = client.read_coils(address=16384, count=34)
        if not r.isError():
            c_labels = {
                2: "C3 detect", 6: "C7 camera det", 11: "C12 flipper",
                12: "C13 lay ties", 13: "C14 drop enable",
                15: "C16 drop pipe", 16: "C17 drop pipe2",
                19: "C20 TPS_1 single", 20: "C21 TPS_2 double",
            }
            on_bits = []
            for i, b in enumerate(r.bits[:34]):
                if b:
                    label = c_labels.get(i, f"C{i+1}")
                    on_bits.append(label)
            parts.append(f"Active C-bits: {', '.join(on_bits) if on_bits else 'none'}")
        else:
            parts.append(f"C-bits: read error — {r}")

        elapsed = (time.monotonic() - t0) * 1000
        parts.append(f"\nModbus round-trip: {elapsed:.0f}ms")

        client.close()
        return "\n".join(parts)

    except Exception as e:
        return f"PLC: Error reading registers — {e}"


def _gather_network() -> str:
    """Check network connectivity."""
    parts = []

    # eth0 carrier
    try:
        carrier = Path("/sys/class/net/eth0/carrier").read_text().strip() == "1"
        parts.append(f"eth0: {'linked' if carrier else 'NO CARRIER'}")
    except Exception:
        parts.append("eth0: unknown")

    # eth0 IP
    try:
        r = subprocess.run(["ip", "-4", "addr", "show", "eth0"],
                           capture_output=True, text=True, timeout=3)
        for line in r.stdout.split("\n"):
            if "inet " in line:
                parts.append(f"eth0 IP: {line.strip()}")
                break
    except Exception:
        pass

    # PLC ping
    try:
        r = subprocess.run(["ping", "-c", "1", "-W", "1", PLC_HOST],
                           capture_output=True, text=True, timeout=3)
        if r.returncode == 0:
            for line in r.stdout.split("\n"):
                if "time=" in line:
                    parts.append(f"PLC ping: {line.strip().split('time=')[1]}")
                    break
        else:
            parts.append("PLC ping: unreachable")
    except Exception:
        parts.append("PLC ping: timeout")

    # Internet
    try:
        r = subprocess.run(["ping", "-c", "1", "-W", "2", "8.8.8.8"],
                           capture_output=True, timeout=5)
        parts.append(f"Internet: {'connected' if r.returncode == 0 else 'OFFLINE'}")
    except Exception:
        parts.append("Internet: unknown")

    # WiFi
    try:
        ssid = subprocess.check_output(["iwgetid", "-r"], text=True, timeout=3).strip()
        parts.append(f"WiFi: {ssid}")
    except Exception:
        parts.append("WiFi: not connected")

    return "\n".join(parts)


def _gather_services() -> str:
    """Check service status and recent logs."""
    parts = []

    # viam-server status
    try:
        r = subprocess.run(["systemctl", "is-active", "viam-server"],
                           capture_output=True, text=True, timeout=5)
        status = r.stdout.strip()
        parts.append(f"viam-server: {status}")

        if status == "active":
            # Get uptime
            r2 = subprocess.run(
                ["systemctl", "show", "viam-server", "--property=ActiveEnterTimestamp"],
                capture_output=True, text=True, timeout=5)
            parts.append(f"  {r2.stdout.strip()}")
    except Exception:
        parts.append("viam-server: unknown")

    # Recent viam-server errors (last 5 min)
    try:
        r = subprocess.run(
            ["journalctl", "-u", "viam-server", "--since", "5 min ago",
             "--no-pager", "-p", "err", "-n", "10"],
            capture_output=True, text=True, timeout=5)
        errors = r.stdout.strip()
        if errors:
            parts.append(f"\nRecent viam-server errors:\n{errors}")
        else:
            parts.append("\nNo viam-server errors in last 5 min")
    except Exception:
        pass

    # Capture status
    try:
        if CAPTURE_DIR.exists():
            prog_files = sorted(CAPTURE_DIR.glob("*.prog"))
            if prog_files:
                latest = prog_files[-1]
                size = latest.stat().st_size
                age = time.time() - latest.stat().st_mtime
                parts.append(f"\nCapture: {size}B, {age:.0f}s ago")
            else:
                parts.append("\nCapture: no active .prog file")
            cap_count = len(list(CAPTURE_DIR.glob("*.capture")))
            parts.append(f"Completed capture files: {cap_count}")
    except Exception:
        pass

    return "\n".join(parts)


def _gather_sensor() -> str:
    """Read latest sensor data and recent history."""
    parts = []

    # Latest reading
    data = read_latest_entry()
    if data:
        ts = data.get("ts", "?")
        parts.append(f"Latest reading ({ts}):")
        parts.append(f"  Speed: {data.get('encoder_speed_ftpm', 0):.1f} ft/min")
        parts.append(f"  Plates: {data.get('plate_drop_count', 0)}")
        parts.append(f"  Direction: {data.get('encoder_direction', '?')}")
        parts.append(f"  TPS Power: {'ON' if data.get('tps_power_loop') else 'OFF'}")
        parts.append(f"  Camera signal: {'ON' if data.get('camera_signal') else 'OFF'}")
        parts.append(f"  Drop enable: {'ON' if data.get('drop_enable') else 'OFF'}")
        parts.append(f"  Lay ties set: {'ON' if data.get('lay_ties_set') else 'OFF'}")
        parts.append(f"  Modbus latency: {data.get('modbus_response_time_ms', 0):.1f}ms")
        parts.append(f"  Modbus errors: {data.get('modbus_error_count', 0)}")

        diags = data.get("diagnostics", [])
        if isinstance(diags, str):
            try:
                diags = json.loads(diags)
            except Exception:
                diags = []
        if diags:
            parts.append("\n  Active diagnostics:")
            for d in diags[:8]:
                if isinstance(d, dict):
                    sev = d.get("severity", "?")
                    title = d.get("title", "?")
                    action = d.get("action", "")
                    parts.append(f"    [{sev}] {title}")
                    if action:
                        parts.append(f"      Fix: {action[:120]}")
        else:
            parts.append("  Diagnostics: all clear")
    else:
        parts.append("No sensor data available (buffer empty or sensor not running)")

    # Trend: last 3 readings
    try:
        history = read_history(minutes=3)
        if history and len(history) >= 2:
            speeds = [h.get("encoder_speed_ftpm", 0) for h in history[-5:]]
            plates = [h.get("plate_drop_count", 0) for h in history[-5:]]
            parts.append(f"\n  Recent speeds: {[f'{s:.1f}' for s in speeds]}")
            if plates[-1] != plates[0]:
                parts.append(f"  Plate count trend: {plates[0]} -> {plates[-1]}")
    except Exception:
        pass

    return "\n".join(parts)


def _gather_system() -> str:
    """System health checks."""
    parts = []

    try:
        temp = int(Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip())
        temp_f = temp / 1000 * 9 / 5 + 32
        parts.append(f"CPU temp: {temp_f:.0f}F ({temp/1000:.1f}C)")
    except Exception:
        pass

    try:
        r = subprocess.run(["df", "-h", "/"], capture_output=True, text=True, timeout=3)
        for line in r.stdout.strip().split("\n")[1:]:
            parts.append(f"Disk: {line}")
    except Exception:
        pass

    try:
        with open("/proc/uptime") as f:
            secs = float(f.read().split()[0])
            hrs = int(secs // 3600)
            mins = int((secs % 3600) // 60)
            parts.append(f"System uptime: {hrs}h{mins}m")
    except Exception:
        pass

    return "\n".join(parts)


# ── Main logic ───────────────────────────────────────────────────────

def gather_all_evidence() -> str:
    """Gather all evidence in parallel. Returns formatted context string."""
    _progress("Gathering evidence...")

    results = {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {
            pool.submit(_gather_plc): "PLC REGISTERS",
            pool.submit(_gather_network): "NETWORK",
            pool.submit(_gather_services): "SERVICES & LOGS",
            pool.submit(_gather_sensor): "SENSOR DATA",
            pool.submit(_gather_system): "SYSTEM HEALTH",
        }
        for future in as_completed(futures):
            label = futures[future]
            try:
                results[label] = future.result(timeout=10)
            except Exception as e:
                results[label] = f"Error: {e}"

    # Assemble in logical order
    sections = ["NETWORK", "PLC REGISTERS", "SENSOR DATA",
                "SERVICES & LOGS", "SYSTEM HEALTH"]
    parts = []
    for section in sections:
        if section in results:
            parts.append(f"=== {section} ===")
            parts.append(results[section])
            parts.append("")

    return "\n".join(parts)


def build_prompt(evidence: str, retry: bool = False,
                 prev_diagnosis: str = "") -> str:
    """Build a single-shot analysis prompt. No tools, just analyze."""

    prompt = f"""You are IronSight, a diagnostic AI on a TPS (Tie Plate System) railroad truck.
Raspberry Pi 5 connected to a Click PLC C0-10DD2E-D via Modbus TCP.

ALL EVIDENCE HAS BEEN GATHERED FOR YOU. Analyze it and diagnose.

{evidence}

CRITICAL PLC KNOWLEDGE:
- DD1 (raw encoder) resets every ~10 counts at PLC scan rate. NEVER use for distance.
- DS10 (Encoder Next Tie) counts down from DS3 to 0 = distance source.
- DS2=39 means 19.5" tie spacing (x0.5"). DS3=195 means 19.5" (x0.1").
- X3 = camera/flipper detector. X4 = TPS power loop.
- Y1 = eject solenoid. C13=Drop Ties, C14=Drop Enable (both must be ON to drop plates).
- eth0 NO-CARRIER = physical cable disconnected or PLC powered off.
- PLC powered off overnight is NORMAL at a railroad shop.
"""

    if retry and prev_diagnosis:
        prompt += f"""
The operator already tried your previous advice and it didn't help:
Previous: "{prev_diagnosis}"
Give DIFFERENT advice. Look at the evidence more carefully for what was missed.
"""

    prompt += """
Respond with ONLY a JSON object (no markdown, no code fences):
{"diagnosis": "Your 3-5 sentence diagnosis. Plain text. Start with ALL CLEAR or the problem name. Give practical advice for a railroad worker — things to physically check or do at the truck. Do NOT mention register names or software commands.", "severity": "ok|warning|critical"}
"""

    return prompt


def run_claude(prompt: str) -> str:
    """Single Claude CLI call with pre-gathered evidence. Returns JSON."""
    _progress("Analyzing...")

    claude_env = {**os.environ, "HOME": "/home/andrew"}

    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "haiku"],
            input=prompt,
            capture_output=True, text=True, timeout=30,
            env=claude_env,
            cwd=str(SCRIPTS_DIR),
        )

        if result.returncode != 0:
            stderr = result.stderr.strip()[:100] if result.stderr else "unknown"
            return json.dumps({
                "diagnosis": f"AI analysis failed: {stderr}",
                "severity": "warning",
            })

        output = result.stdout.strip()

        # Try to parse JSON from output (may have surrounding text)
        # First try the whole output
        try:
            parsed = json.loads(output)
            if "diagnosis" in parsed:
                return output
        except json.JSONDecodeError:
            pass

        # Find JSON object in output
        start = output.find("{")
        end = output.rfind("}") + 1
        if start >= 0 and end > start:
            candidate = output[start:end]
            try:
                parsed = json.loads(candidate)
                if "diagnosis" in parsed:
                    return candidate
            except json.JSONDecodeError:
                pass

        # Fallback: wrap raw output
        text = output[-400:] if len(output) > 400 else output
        return json.dumps({"diagnosis": text, "severity": "warning"})

    except subprocess.TimeoutExpired:
        return json.dumps({
            "diagnosis": "Analysis timed out. Internet may be slow.",
            "severity": "warning",
        })
    except FileNotFoundError:
        return json.dumps({
            "diagnosis": "Claude CLI not found.",
            "severity": "warning",
        })
    except Exception as e:
        return json.dumps({
            "diagnosis": f"Analysis error: {str(e)[:80]}",
            "severity": "warning",
        })


def main():
    parser = argparse.ArgumentParser(description="IronSight Diagnostic Agent")
    parser.add_argument("--retry", action="store_true")
    parser.add_argument("--prev-diagnosis", type=str, default="")
    args = parser.parse_args()

    _progress("Gathering evidence...")

    try:
        evidence = gather_all_evidence()
        prompt = build_prompt(evidence, retry=args.retry,
                              prev_diagnosis=args.prev_diagnosis)
        result = run_claude(prompt)
        print(result)
    except Exception as e:
        print(json.dumps({
            "diagnosis": f"Agent error: {str(e)[:100]}",
            "severity": "warning",
        }))
    finally:
        try:
            PROGRESS_FILE.unlink(missing_ok=True)
        except Exception:
            pass


if __name__ == "__main__":
    main()
