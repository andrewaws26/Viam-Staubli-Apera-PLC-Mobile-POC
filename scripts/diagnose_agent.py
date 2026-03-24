#!/usr/bin/env python3
"""
IronSight Diagnostic Agent — AI that independently investigates truck problems.

Uses Claude CLI (not the API) so it has full access to Bash, file reading,
and any command on the system. It can read PLC registers via pymodbus,
check logs, analyze trends, inspect network — whatever it needs.

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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.plc_constants import PLC_HOST, PLC_PORT, OFFLINE_BUFFER_DIR
from lib.buffer_reader import read_latest_entry

PROGRESS_FILE = Path("/tmp/ironsight-diagnose-progress.txt")
SCRIPTS_DIR = Path(__file__).resolve().parent


def _progress(msg: str):
    """Write a progress line for the touch screen to display."""
    try:
        PROGRESS_FILE.write_text(msg)
    except Exception:
        pass


def _plc_connected() -> bool:
    """Quick TCP check."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex((PLC_HOST, PLC_PORT))
        sock.close()
        return result == 0
    except Exception:
        return False


def build_initial_context() -> str:
    """Build the system snapshot that starts the investigation."""
    parts = []

    # Live connectivity
    plc_ok = _plc_connected()
    parts.append(f"PLC: {'CONNECTED' if plc_ok else 'DISCONNECTED'} ({PLC_HOST}:{PLC_PORT})")

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

    # Latest sensor reading
    data = read_latest_entry()
    if data:
        ts = data.get("ts", "?")
        parts.append(f"\nLatest sensor reading ({ts}):")
        parts.append(f"  Speed: {data.get('encoder_speed_ftpm', 0):.1f} ft/min")
        parts.append(f"  Plates: {data.get('plate_drop_count', 0)}")
        parts.append(f"  Direction: {data.get('encoder_direction', '?')}")
        parts.append(f"  TPS Power: {'ON' if data.get('tps_power_loop') else 'OFF'}")
        parts.append(f"  Camera signal: {'ON' if data.get('camera_signal') else 'OFF'}")
        parts.append(f"  Modbus latency: {data.get('modbus_response_time_ms', 0):.1f}ms")
        parts.append(f"  Diagnostics active: {data.get('diagnostics_count', 0)}")

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
    else:
        parts.append("\nNo sensor data available")

    return "\n".join(parts)


def build_prompt(context: str, retry: bool = False, prev_diagnosis: str = "") -> str:
    """Build the prompt for Claude CLI."""

    prompt = f"""You are IronSight, a diagnostic AI on a TPS (Tie Plate System) railroad truck.
You are running on a Raspberry Pi 5 connected to a Click PLC C0-10DD2E-D via Modbus TCP.

CURRENT SYSTEM SNAPSHOT:
{context}

YOUR TASK: Investigate this system and diagnose any problems. You have full access
to Bash — use it to dig deeper. Don't guess. Gather evidence, then conclude.

INVESTIGATION COMMANDS YOU CAN USE:
- python3 {SCRIPTS_DIR}/test_plc_modbus.py          # Read all PLC registers (DS1-25, DD1, X1-8, Y1-3, C1-34)
- python3 {SCRIPTS_DIR}/test_plc_modbus.py --watch   # Watch registers change in real-time (Ctrl+C after a few seconds)
- python3 -c "from lib.buffer_reader import read_history; import json; h=read_history(minutes=5); print(json.dumps(h[-3:], indent=2, default=str))"
  # Get recent sensor history (last 5 min)
- journalctl -u viam-server --since '5 min ago' --no-pager -n 30   # Check viam-server logs
- systemctl status viam-server                        # Check service status
- cat /sys/class/net/eth0/carrier                     # Check ethernet link (1=up, 0=down)
- ping -c 1 -W 1 {PLC_HOST}                          # Ping PLC
- ip addr show eth0                                   # Check eth0 IP
- cat /sys/class/thermal/thermal_zone0/temp           # CPU temp (divide by 1000 for °C)
- df -h /                                             # Disk usage
- ls -la /home/andrew/.viam/capture/rdk_component_sensor/plc-monitor/Readings/*.prog  # Capture status

CRITICAL PLC KNOWLEDGE:
- DD1 (raw encoder) resets every ~10 counts at PLC scan rate. NEVER use for distance.
- DS10 (Encoder Next Tie) counts down from DS3 to 0. THIS is the distance source.
- DS2=39 means 19.5" tie spacing (x0.5"). DS3=195 means 19.5" (x0.1").
- X3 = camera/flipper detector. X4 = TPS power loop.
- Y1 = eject solenoid. C13=Drop Ties, C14=Drop Enable (both must be ON).
- eth0 NO-CARRIER = physical cable disconnected or PLC powered off.

WORKING DIRECTORY: {SCRIPTS_DIR}
"""

    if retry and prev_diagnosis:
        prompt += f"""
RE-INVESTIGATING: The operator tried your previous fix and it didn't help.
Previous diagnosis: "{prev_diagnosis}"
Look deeper. Check things the previous diagnosis missed. Try different commands.
"""

    prompt += """
IMPORTANT — Write your progress to /tmp/ironsight-diagnose-progress.txt as you work:
  echo "Reading PLC registers..." > /tmp/ironsight-diagnose-progress.txt
  echo "Checking logs..." > /tmp/ironsight-diagnose-progress.txt

When done investigating, output your diagnosis in EXACTLY this format (and nothing else after it):
DIAGNOSIS_START
{"diagnosis": "Your 3-5 sentence diagnosis here. Plain text, no markdown. Start with ALL CLEAR or the problem name. Give practical advice for a railroad worker at the truck — check cables, power cycle, look at lights. Do NOT mention registers or commands.", "reasoning": "1-2 sentences about what evidence you found.", "tool_calls": N}
DIAGNOSIS_END

Replace N with the number of commands you ran during investigation.
"""

    return prompt


def run_agent(prompt: str) -> str:
    """Run Claude CLI with the investigation prompt. Returns JSON result."""
    _progress("Starting investigation...")

    claude_env = {**os.environ, "HOME": "/home/andrew"}

    try:
        result = subprocess.run(
            ["claude", "-p", "--model", "sonnet"],
            input=prompt,
            capture_output=True, text=True, timeout=120,
            env=claude_env,
            cwd=str(SCRIPTS_DIR),
        )

        if result.returncode != 0:
            stderr = result.stderr.strip()[:100] if result.stderr else "unknown error"
            return json.dumps({
                "diagnosis": f"Investigation failed: {stderr}",
                "reasoning": "", "tool_calls": 0,
            })

        output = result.stdout.strip()

        # Parse the structured diagnosis from the output
        if "DIAGNOSIS_START" in output and "DIAGNOSIS_END" in output:
            block = output.split("DIAGNOSIS_START")[1].split("DIAGNOSIS_END")[0].strip()
            try:
                return block
            except Exception:
                pass

        # Fallback: try to find JSON anywhere in the output
        for line in output.split("\n"):
            line = line.strip()
            if line.startswith("{") and "diagnosis" in line:
                try:
                    json.loads(line)
                    return line
                except Exception:
                    continue

        # Last resort: use the whole output as diagnosis
        # Truncate to reasonable length for the touch screen
        text = output[-500:] if len(output) > 500 else output
        return json.dumps({
            "diagnosis": text,
            "reasoning": "Raw output from investigation",
            "tool_calls": 0,
        })

    except subprocess.TimeoutExpired:
        return json.dumps({
            "diagnosis": "Investigation timed out after 2 minutes. Check internet connection.",
            "reasoning": "Claude CLI timed out", "tool_calls": 0,
        })
    except FileNotFoundError:
        return json.dumps({
            "diagnosis": "Claude CLI not found. Cannot run AI investigation.",
            "reasoning": "claude command not in PATH", "tool_calls": 0,
        })
    except Exception as e:
        return json.dumps({
            "diagnosis": f"Investigation error: {str(e)[:80]}",
            "reasoning": str(e), "tool_calls": 0,
        })


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
        prompt = build_prompt(context, retry=args.retry,
                              prev_diagnosis=args.prev_diagnosis)
        result = run_agent(prompt)
        print(result)
    except Exception as e:
        print(json.dumps({
            "diagnosis": f"Agent error: {str(e)[:100]}. Check internet connection.",
            "reasoning": "", "tool_calls": 0, "error": str(e),
        }))
    finally:
        try:
            PROGRESS_FILE.unlink(missing_ok=True)
        except Exception:
            pass


if __name__ == "__main__":
    main()
