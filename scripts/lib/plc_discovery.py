"""
Unknown PLC register discovery logic for IronSight AI Analysis.

Extracted from ironsight-analyze.py. Contains:
  - Targeted register watcher (watch specific registers with statistics)
  - AI system prompt for PLC reverse-engineering
  - Claude CLI headless interface
  - Result printing utilities
"""

import json
import os
import subprocess
import sys
import time
from typing import Optional

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    print("ERROR: pymodbus not installed. Run: pip3 install pymodbus")
    sys.exit(1)


# ─────────────────────────────────────────────────────────────
#  Claude CLI Headless Interface
# ─────────────────────────────────────────────────────────────

# Claude CLI binary -- override with CLAUDE_CLI env var if needed
CLAUDE_CLI = os.environ.get("CLAUDE_CLI", "claude")


def claude_headless(prompt: str, system: Optional[str] = None) -> str:
    """Send a prompt to Claude via the CLI in headless mode.

    Uses ``claude -p`` (print mode) which takes a prompt on stdin,
    sends it to Claude, and prints the response to stdout.
    No API key needed -- uses your Claude subscription.

    Args:
        prompt: The prompt text to send.
        system: Optional system prompt.

    Returns:
        Claude's response text.

    Raises:
        RuntimeError: If the Claude CLI exits with a non-zero code.
    """
    cmd = [CLAUDE_CLI, "-p", "--output-format", "text"]

    if system:
        cmd.extend(["--system-prompt", system])

    result = subprocess.run(
        cmd,
        input=prompt,
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.returncode != 0:
        stderr = result.stderr.strip()
        raise RuntimeError(f"Claude CLI failed (exit {result.returncode}): {stderr}")

    return result.stdout.strip()


# ─────────────────────────────────────────────────────────────
#  AI System Prompt
# ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are IronSight, an AI that reverse-engineers PLC (Programmable Logic Controller) \
programs by observing register behavior over Modbus TCP.

You CANNOT read the PLC's ladder logic program -- it's locked inside the PLC. But you \
CAN read every register, coil, and input at 1Hz+ and watch how they change over time. \
By correlating inputs, outputs, timers, and counters, you can reconstruct what the \
program does.

Your approach:
1. Look at the register map and any prior observations
2. Pick the most promising unknown registers to investigate
3. Design a focused observation test (which registers to watch, what to look for)
4. After observing, interpret the results -- what does each register do?
5. Label registers with confidence levels (high/medium/low)

Register naming convention:
- HR_N = Holding Register at address N (FC03)
- IR_N = Input Register at address N (FC04)
- COIL_N = Coil at address N (FC01)
- DI_N = Discrete Input at address N (FC02)

When labeling registers, consider common PLC patterns:
- Counters (monotonically increasing values)
- Timers (count up/down then reset)
- Setpoints (rarely change, operator-configured)
- Status flags (binary on/off)
- Calculated values (derived from other registers)
- Countdown registers (count down to zero then reload)
- HMI screen selectors
- Error/alarm codes
"""


# ─────────────────────────────────────────────────────────────
#  Targeted Register Watcher
# ─────────────────────────────────────────────────────────────

def watch_specific_registers(ip: str, registers: list[str], duration: int = 60,
                             interval: float = 0.5, port: int = 502) -> dict:
    """Watch a specific set of registers and return detailed observations.

    Args:
        ip: PLC IP address.
        registers: List of register names like ``["HR_7", "HR_10", "COIL_20"]``.
        duration: How long to observe in seconds.
        interval: Sample interval in seconds.
        port: Modbus TCP port.

    Returns:
        Dict with per-register statistics, correlations, and timeline sample.
    """
    client = ModbusTcpClient(ip, port=port, timeout=3)
    if not client.connect():
        return {"error": "Cannot connect to PLC"}

    # Parse register names to figure out what to read
    holding_addrs: set[int] = set()
    coil_addrs: set[int] = set()
    discrete_addrs: set[int] = set()
    input_addrs: set[int] = set()

    for reg in registers:
        parts = reg.split("_", 1)
        prefix = parts[0]
        addr = int(parts[1]) if len(parts) > 1 else 0

        if prefix == "HR":
            holding_addrs.add(addr)
        elif prefix == "COIL":
            coil_addrs.add(addr)
        elif prefix == "DI":
            discrete_addrs.add(addr)
        elif prefix == "IR":
            input_addrs.add(addr)

    def _read_range(addrs: set[int]) -> tuple[int, int]:
        if not addrs:
            return 0, 0
        mn, mx = min(addrs), max(addrs)
        return mn, mx - mn + 1

    timeline: list[dict] = []
    start_time = time.time()

    try:
        while (time.time() - start_time) < duration:
            snap: dict[str, int] = {}
            ts = time.time() - start_time

            # Read holding registers
            if holding_addrs:
                start, count = _read_range(holding_addrs)
                ctx_start = max(0, start - 5)
                ctx_count = count + 10
                try:
                    r = client.read_holding_registers(address=ctx_start, count=ctx_count)
                    if not r.isError():
                        for i, val in enumerate(r.registers):
                            a = ctx_start + i
                            snap[f"HR_{a}"] = val & 0xFFFF
                except Exception:
                    pass

            # Read coils
            if coil_addrs:
                start, count = _read_range(coil_addrs)
                ctx_start = max(0, start - 5)
                ctx_count = count + 10
                try:
                    r = client.read_coils(address=ctx_start, count=ctx_count)
                    if not r.isError():
                        for i in range(min(ctx_count, len(r.bits))):
                            snap[f"COIL_{ctx_start + i}"] = int(r.bits[i])
                except Exception:
                    pass

            # Read discrete inputs
            if discrete_addrs:
                start, count = _read_range(discrete_addrs)
                ctx_start = max(0, start - 5)
                ctx_count = count + 10
                try:
                    r = client.read_discrete_inputs(address=ctx_start, count=ctx_count)
                    if not r.isError():
                        for i in range(min(ctx_count, len(r.bits))):
                            snap[f"DI_{ctx_start + i}"] = int(r.bits[i])
                except Exception:
                    pass

            # Read input registers
            if input_addrs:
                start, count = _read_range(input_addrs)
                ctx_start = max(0, start - 5)
                ctx_count = count + 10
                try:
                    r = client.read_input_registers(address=ctx_start, count=ctx_count)
                    if not r.isError():
                        for i, val in enumerate(r.registers):
                            snap[f"IR_{ctx_start + i}"] = val & 0xFFFF
                except Exception:
                    pass

            timeline.append({"t": round(ts, 2), "values": snap})
            time.sleep(interval)

    except KeyboardInterrupt:
        pass
    finally:
        client.close()

    # Compute per-register statistics
    stats = _compute_register_stats(registers, timeline, duration)

    # Find correlations
    correlations = _compute_correlations(registers, timeline)

    return {
        "duration_seconds": round(time.time() - start_time, 1),
        "total_samples": len(timeline),
        "register_stats": stats,
        "correlations": correlations,
        "timeline_sample": timeline[:10] + timeline[-10:],
    }


def _compute_register_stats(registers: list[str], timeline: list[dict],
                            duration: float) -> dict:
    """Compute per-register statistics from observation timeline.

    Args:
        registers: Register names observed.
        timeline: List of timestamped snapshots.
        duration: Total observation duration in seconds.

    Returns:
        Dict mapping register name to statistics dict.
    """
    stats: dict[str, dict] = {}
    for reg in registers:
        values = [s["values"].get(reg) for s in timeline if reg in s["values"]]
        if not values:
            stats[reg] = {"error": "no data"}
            continue

        numeric = [v for v in values if isinstance(v, (int, float))]
        if not numeric:
            stats[reg] = {"samples": len(values), "all_values": values[:20]}
            continue

        changes = sum(1 for i in range(1, len(numeric)) if numeric[i] != numeric[i - 1])
        deltas = [numeric[i] - numeric[i - 1]
                  for i in range(1, len(numeric)) if numeric[i] != numeric[i - 1]]

        stats[reg] = {
            "samples": len(numeric),
            "min": min(numeric),
            "max": max(numeric),
            "first": numeric[0],
            "last": numeric[-1],
            "net_change": numeric[-1] - numeric[0],
            "changes": changes,
            "change_rate_hz": round(changes / duration, 3) if duration > 0 else 0,
            "unique_values": len(set(numeric)),
            "deltas": deltas[:50],
        }
    return stats


def _compute_correlations(registers: list[str], timeline: list[dict]) -> list[dict]:
    """Find registers that change at the same time.

    Args:
        registers: Register names observed.
        timeline: List of timestamped snapshots.

    Returns:
        List of correlation dicts with register pairs and co-change counts.
    """
    correlations: list[dict] = []
    for i, reg_a in enumerate(registers):
        for reg_b in registers[i + 1:]:
            co_changes = 0
            for j in range(1, len(timeline)):
                a_changed = (timeline[j]["values"].get(reg_a) !=
                             timeline[j - 1]["values"].get(reg_a))
                b_changed = (timeline[j]["values"].get(reg_b) !=
                             timeline[j - 1]["values"].get(reg_b))
                if a_changed and b_changed:
                    co_changes += 1
            if co_changes > 0:
                correlations.append({
                    "registers": [reg_a, reg_b],
                    "co_changes": co_changes,
                })
    return correlations


# ─────────────────────────────────────────────────────────────
#  Result printing
# ─────────────────────────────────────────────────────────────

def print_final_map(labeled: dict, all_registers: list[dict],
                    GREEN: str = "", YELLOW: str = "", DIM: str = "",
                    BOLD: str = "", RESET: str = "") -> None:
    """Pretty-print the final labeled register map.

    Args:
        labeled: Dict mapping register name to label string.
        all_registers: List of register dicts with 'name' and 'initial_value'.
        GREEN: ANSI green escape code.
        YELLOW: ANSI yellow escape code.
        DIM: ANSI dim escape code.
        BOLD: ANSI bold escape code.
        RESET: ANSI reset escape code.
    """
    print(f"  {BOLD}Labeled Registers ({len(labeled)}):{RESET}\n")
    for reg in sorted(labeled.keys()):
        print(f"    {GREEN}{reg:<20}{RESET} {labeled[reg]}")

    unlabeled = [r["name"] for r in all_registers if r["name"] not in labeled]
    if unlabeled:
        print(f"\n  {YELLOW}Still Unknown ({len(unlabeled)}):{RESET}\n")
        for reg in sorted(unlabeled):
            initial = next((r["initial_value"] for r in all_registers if r["name"] == reg), "?")
            print(f"    {DIM}{reg:<20}{RESET} initial={initial}")
    print()
