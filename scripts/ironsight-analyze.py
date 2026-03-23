#!/usr/bin/env python3
"""
IronSight AI Analysis Loop — Autonomous PLC reverse-engineering via Claude.

Takes the output of ironsight-discover.py (phases 1-3: scan, probe, sweep)
and runs an iterative AI observation loop. Claude examines unknown registers,
designs 60-second observation tests, interprets the results, and progressively
builds a complete register map — even when you can't pull the ladder logic.

Architecture:
    1. Load register map from discovery sweep (or run a fresh sweep)
    2. Load any prior knowledge from IronSight Memory
    3. Loop until all registers are labeled:
       a. Claude picks the most promising unknown register(s)
       b. Claude designs a focused observation test
       c. We run the observation (watch specific registers for N seconds)
       d. Claude interprets the results and labels what it can
       e. Findings are saved to persistent memory
    4. Generate a final labeled register map

Usage:
    ironsight-analyze <ip>                     # Analyze with fresh sweep
    ironsight-analyze <ip> --report <file>     # Use existing discovery report
    ironsight-analyze <ip> --rounds 20         # Run up to 20 analysis rounds
    ironsight-analyze <ip> --duration 120      # 120s observation per round

Requires:
    pip3 install pymodbus>=3.5 anthropic
"""

import argparse
import json
import os
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

try:
    import anthropic
except ImportError:
    print("ERROR: anthropic not installed. Run: pip3 install anthropic")
    sys.exit(1)

# Import from sibling modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
from ironsight_memory import IronSightMemory

# Also import watch/sweep functions from discovery
sys.path.insert(0, os.path.dirname(__file__))
from importlib import import_module

# We can't import ironsight-discover directly (hyphen in name), so load it
_discover_path = os.path.join(os.path.dirname(__file__), "ironsight-discover.py")
import importlib.util
_spec = importlib.util.spec_from_file_location("ironsight_discover", _discover_path)
_discover = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_discover)

sweep_modbus = _discover.sweep_modbus
watch_registers = _discover.watch_registers
log = _discover.log
banner = _discover.banner
BOLD = _discover.BOLD
GREEN = _discover.GREEN
YELLOW = _discover.YELLOW
RED = _discover.RED
CYAN = _discover.CYAN
DIM = _discover.DIM
RESET = _discover.RESET

# ─────────────────────────────────────────────────────────────
#  Claude Headless Interface
# ─────────────────────────────────────────────────────────────

MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS = 4096


def claude_headless(prompt: str, system: str = None) -> str:
    """Send a prompt to Claude and return the text response.

    Uses the Anthropic API directly. Requires ANTHROPIC_API_KEY env var.
    """
    client = anthropic.Anthropic()  # picks up ANTHROPIC_API_KEY from env

    messages = [{"role": "user", "content": prompt}]
    kwargs = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "messages": messages,
    }
    if system:
        kwargs["system"] = system

    response = client.messages.create(**kwargs)
    return response.content[0].text


# ─────────────────────────────────────────────────────────────
#  Targeted Register Watcher
# ─────────────────────────────────────────────────────────────

def watch_specific_registers(ip: str, registers: list, duration: int = 60,
                             interval: float = 0.5, port: int = 502) -> dict:
    """Watch a specific set of registers and return detailed observations.

    Args:
        ip: PLC IP address
        registers: List of register names like ["HR_7", "HR_10", "COIL_20"]
        duration: How long to observe in seconds
        interval: Sample interval in seconds
        port: Modbus TCP port

    Returns:
        Dict with per-register statistics and raw timeline
    """
    client = ModbusTcpClient(ip, port=port, timeout=3)
    if not client.connect():
        return {"error": "Cannot connect to PLC"}

    # Parse register names to figure out what to read
    holding_addrs = set()
    coil_addrs = set()
    discrete_addrs = set()
    input_addrs = set()

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

    # Build read plan — group contiguous addresses
    def _read_range(addrs):
        if not addrs:
            return 0, 0
        mn, mx = min(addrs), max(addrs)
        return mn, mx - mn + 1

    timeline = []  # list of (timestamp, {reg: val}) snapshots
    start_time = time.time()

    try:
        while (time.time() - start_time) < duration:
            snap = {}
            ts = time.time() - start_time

            # Read holding registers
            if holding_addrs:
                start, count = _read_range(holding_addrs)
                # Read extra context around the target registers
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
    stats = {}
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
        deltas = [numeric[i] - numeric[i - 1] for i in range(1, len(numeric)) if numeric[i] != numeric[i - 1]]

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
            "deltas": deltas[:50],  # First 50 deltas for pattern analysis
        }

    # Find correlations — registers that change at the same time
    correlations = []
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

    return {
        "duration_seconds": round(time.time() - start_time, 1),
        "total_samples": len(timeline),
        "register_stats": stats,
        "correlations": correlations,
        "timeline_sample": timeline[:10] + timeline[-10:],  # First/last 10 for context
    }


# ─────────────────────────────────────────────────────────────
#  AI Analysis Loop
# ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are IronSight, an AI that reverse-engineers PLC (Programmable Logic Controller) \
programs by observing register behavior over Modbus TCP.

You CANNOT read the PLC's ladder logic program — it's locked inside the PLC. But you \
CAN read every register, coil, and input at 1Hz+ and watch how they change over time. \
By correlating inputs, outputs, timers, and counters, you can reconstruct what the \
program does.

Your approach:
1. Look at the register map and any prior observations
2. Pick the most promising unknown registers to investigate
3. Design a focused observation test (which registers to watch, what to look for)
4. After observing, interpret the results — what does each register do?
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


def analyze_unknown_plc(ip: str, port: int = 502, max_rounds: int = 10,
                        observation_duration: int = 60,
                        existing_report: str = None):
    """Run the AI analysis loop on an unknown PLC.

    This is the main entry point. It:
    1. Loads or runs a register sweep
    2. Iteratively asks Claude to design observation tests
    3. Runs the observations
    4. Has Claude interpret results and label registers
    5. Saves everything to IronSight Memory
    """
    print(f"""
{CYAN}╔══════════════════════════════════════════════════════════════╗
║  {BOLD}🧠 IronSight AI Analysis Loop{RESET}{CYAN}                               ║
║  Autonomous PLC reverse-engineering via Claude                ║
╚══════════════════════════════════════════════════════════════╝{RESET}
""")

    memory = IronSightMemory()

    # ── Step 1: Get the register map ──────────────────────────
    if existing_report:
        log(f"Loading existing discovery report: {existing_report}")
        with open(existing_report, "r") as f:
            report = json.load(f)
        reg_map = report.get("register_map", {})
        log(f"Loaded {sum(len(v) for v in reg_map.values())} registers from report", "ok")
    else:
        log(f"Running fresh register sweep on {ip}:{port}...")
        reg_map = sweep_modbus(ip, port)
        if not reg_map:
            log("Sweep returned no registers. Is the PLC connected?", "error")
            return

    # Build flat list of all known registers
    all_registers = []
    for space, regs in reg_map.items():
        prefix_map = {
            "holding_registers": "HR",
            "input_registers": "IR",
            "coils": "COIL",
            "discrete_inputs": "DI",
        }
        prefix = prefix_map.get(space, space)
        for addr, val in regs.items():
            all_registers.append({
                "name": f"{prefix}_{addr}",
                "initial_value": val,
                "space": space,
            })

    log(f"Total registers to analyze: {len(all_registers)}", "ok")

    # ── Step 2: Load prior knowledge ──────────────────────────
    known_labels = memory.read("register-labels.md")
    prior_observations = memory.read("observations.md")

    labeled = {}  # reg_name -> label
    unknowns = [r["name"] for r in all_registers]

    # Parse any existing labels from memory
    if known_labels:
        for line in known_labels.split("\n"):
            line = line.strip()
            if line.startswith("- ") and ":" in line:
                parts = line[2:].split(":", 1)
                reg_name = parts[0].strip()
                label = parts[1].strip()
                labeled[reg_name] = label
                if reg_name in unknowns:
                    unknowns.remove(reg_name)
        log(f"Loaded {len(labeled)} previously labeled registers from memory", "ok")

    if not unknowns:
        log("All registers are already labeled!", "ok")
        _print_final_map(labeled, all_registers)
        return labeled

    log(f"Unknown registers remaining: {len(unknowns)}")

    # ── Step 3: AI observation loop ───────────────────────────
    for round_num in range(1, max_rounds + 1):
        if not unknowns:
            log("All registers labeled!", "ok")
            break

        print(f"\n{BOLD}{'═' * 60}{RESET}")
        print(f"{BOLD}  Round {round_num}/{max_rounds} — {len(unknowns)} unknown registers{RESET}")
        print(f"{'═' * 60}\n")

        # ── 3a: Ask Claude what to investigate ────────────────
        context = {
            "plc_ip": ip,
            "total_registers": len(all_registers),
            "register_list": [
                {
                    "name": r["name"],
                    "initial_value": r["initial_value"],
                    "status": "unknown" if r["name"] in unknowns else labeled.get(r["name"], "?"),
                }
                for r in all_registers
            ],
            "unknowns": unknowns,
            "already_labeled": labeled,
            "recent_observations": prior_observations[-3000:] if prior_observations else "None yet",
        }

        plan_prompt = (
            f"Here is an unknown PLC at {ip}. I need you to help reverse-engineer it.\n\n"
            f"Current state:\n"
            f"```json\n{json.dumps(context, indent=2, default=str)}\n```\n\n"
            f"Pick the 3-8 most promising unknown registers to investigate next. "
            f"Design a {observation_duration}-second observation test.\n\n"
            f"Respond in this exact JSON format:\n"
            f'{{"registers_to_watch": ["HR_7", "HR_10", ...], '
            f'"hypothesis": "Brief description of what you think these registers might be", '
            f'"what_to_look_for": "What patterns would confirm or deny the hypothesis", '
            f'"include_context_registers": ["HR_0", ...]}}\n\n'
            f"The include_context_registers should be already-labeled registers that "
            f"might correlate with the unknowns (e.g., watch a known counter alongside "
            f"an unknown to see if they're related)."
        )

        log("Asking Claude to design observation test...")
        try:
            plan_response = claude_headless(plan_prompt, system=SYSTEM_PROMPT)
        except Exception as e:
            log(f"Claude API error: {e}", "error")
            log("Retrying in 5 seconds...", "warn")
            time.sleep(5)
            try:
                plan_response = claude_headless(plan_prompt, system=SYSTEM_PROMPT)
            except Exception as e2:
                log(f"Claude API error on retry: {e2}", "error")
                break

        # Parse Claude's plan
        try:
            # Extract JSON from response (Claude may wrap it in markdown)
            json_str = plan_response
            if "```json" in json_str:
                json_str = json_str.split("```json")[1].split("```")[0]
            elif "```" in json_str:
                json_str = json_str.split("```")[1].split("```")[0]
            plan = json.loads(json_str.strip())
        except (json.JSONDecodeError, IndexError):
            log(f"Could not parse Claude's plan, using fallback", "warn")
            # Fallback: watch the first 8 unknowns
            plan = {
                "registers_to_watch": unknowns[:8],
                "hypothesis": "Exploratory scan of unknown registers",
                "what_to_look_for": "Any changes or patterns",
                "include_context_registers": [],
            }

        watch_list = plan.get("registers_to_watch", unknowns[:8])
        context_regs = plan.get("include_context_registers", [])
        all_watch = list(set(watch_list + context_regs))

        print(f"\n  {CYAN}Hypothesis:{RESET} {plan.get('hypothesis', 'N/A')}")
        print(f"  {CYAN}Watching:{RESET}    {', '.join(watch_list)}")
        print(f"  {CYAN}Context:{RESET}     {', '.join(context_regs) if context_regs else 'none'}")
        print(f"  {CYAN}Looking for:{RESET} {plan.get('what_to_look_for', 'N/A')}")
        print()

        # ── 3b: Run the observation ───────────────────────────
        log(f"Observing {len(all_watch)} registers for {observation_duration}s...")
        observation = watch_specific_registers(
            ip, all_watch,
            duration=observation_duration,
            interval=0.5,
            port=port,
        )

        if "error" in observation:
            log(f"Observation failed: {observation['error']}", "error")
            continue

        log(f"Collected {observation['total_samples']} samples over "
            f"{observation['duration_seconds']}s", "ok")

        # Print quick summary
        for reg, stats in observation.get("register_stats", {}).items():
            if "error" in stats:
                continue
            change_info = f"{stats['changes']} changes" if stats.get('changes', 0) > 0 else "static"
            val_info = f"range {stats['min']}-{stats['max']}" if stats.get('min') is not None else ""
            print(f"    {reg:<20} {change_info:<18} {val_info}")

        # ── 3c: Ask Claude to interpret results ───────────────
        interpret_prompt = (
            f"Here are the observation results from round {round_num}.\n\n"
            f"Hypothesis was: {plan.get('hypothesis', 'N/A')}\n"
            f"Looking for: {plan.get('what_to_look_for', 'N/A')}\n\n"
            f"Observation data:\n"
            f"```json\n{json.dumps(observation, indent=2, default=str)}\n```\n\n"
            f"Already labeled registers for context: {json.dumps(labeled, default=str)}\n\n"
            f"Based on this observation, what did we learn? For each register you can "
            f"confidently label, provide the label and confidence.\n\n"
            f"Respond in this exact JSON format:\n"
            f'{{"findings": "Plain English summary of what was observed", '
            f'"labeled": {{"HR_7": {{"label": "Plate Counter", "confidence": "high", '
            f'"evidence": "Monotonically increased from 0 to 15 during observation"}}}}, '
            f'"still_unknown": ["HR_12", ...], '
            f'"next_suggestion": "What to investigate next and why"}}'
        )

        log("Asking Claude to interpret results...")
        try:
            interpret_response = claude_headless(interpret_prompt, system=SYSTEM_PROMPT)
        except Exception as e:
            log(f"Claude API error: {e}", "error")
            continue

        # Parse findings
        try:
            json_str = interpret_response
            if "```json" in json_str:
                json_str = json_str.split("```json")[1].split("```")[0]
            elif "```" in json_str:
                json_str = json_str.split("```")[1].split("```")[0]
            findings = json.loads(json_str.strip())
        except (json.JSONDecodeError, IndexError):
            log(f"Could not parse Claude's findings, saving raw response", "warn")
            findings = {
                "findings": interpret_response[:500],
                "labeled": {},
                "still_unknown": watch_list,
                "next_suggestion": "Retry with longer observation",
            }

        # ── 3d: Update labels and memory ──────────────────────
        newly_labeled = findings.get("labeled", {})
        if newly_labeled:
            print(f"\n  {GREEN}{BOLD}New labels:{RESET}")
            for reg, info in newly_labeled.items():
                if isinstance(info, dict):
                    label = info.get("label", "?")
                    confidence = info.get("confidence", "?")
                    evidence = info.get("evidence", "")
                    full_label = f"{label} [{confidence}] — {evidence}"
                else:
                    label = str(info)
                    full_label = label
                    confidence = "medium"

                labeled[reg] = full_label
                if reg in unknowns:
                    unknowns.remove(reg)
                print(f"    {GREEN}{reg:<20} → {label} ({confidence}){RESET}")

        findings_text = findings.get("findings", "No summary available")
        print(f"\n  {BOLD}Summary:{RESET} {findings_text}")

        if findings.get("next_suggestion"):
            print(f"  {DIM}Next: {findings['next_suggestion']}{RESET}")

        # Save to persistent memory
        round_entry = (
            f"## Round {round_num} — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
            f"**Target:** {ip}\n"
            f"**Watched:** {', '.join(watch_list)}\n"
            f"**Findings:** {findings_text}\n"
        )
        if newly_labeled:
            round_entry += "**Newly labeled:**\n"
            for reg, info in newly_labeled.items():
                if isinstance(info, dict):
                    round_entry += f"- {reg}: {info.get('label', '?')} [{info.get('confidence', '?')}]\n"
                else:
                    round_entry += f"- {reg}: {info}\n"

        memory.append("observations.md", round_entry)

        # Update register labels file
        labels_md = "# Register Labels\n\nLabeled by IronSight AI Analysis Loop.\n\n"
        for reg_name in sorted(labeled.keys()):
            labels_md += f"- {reg_name}: {labeled[reg_name]}\n"
        memory.write("register-labels.md", labels_md)

        # Log the event
        memory.log_event("ai-analysis", "round_complete", {
            "round": round_num,
            "ip": ip,
            "newly_labeled": len(newly_labeled),
            "total_labeled": len(labeled),
            "remaining_unknown": len(unknowns),
        })

        log(f"Round {round_num} complete: {len(newly_labeled)} new labels, "
            f"{len(unknowns)} still unknown", "ok")

        # Brief pause between rounds
        if unknowns and round_num < max_rounds:
            time.sleep(2)

    # ── Step 4: Final report ──────────────────────────────────
    print(f"\n{'═' * 60}")
    print(f"{BOLD}  ANALYSIS COMPLETE{RESET}")
    print(f"{'═' * 60}\n")

    _print_final_map(labeled, all_registers)

    # Save final report
    report_data = {
        "generated": datetime.now().isoformat(),
        "plc_ip": ip,
        "total_registers": len(all_registers),
        "labeled_count": len(labeled),
        "unknown_count": len(unknowns),
        "labels": labeled,
        "unknowns": unknowns,
    }

    report_path = os.path.join(
        os.path.dirname(__file__),
        f"ironsight-analysis-{ip.replace('.', '_')}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    )
    with open(report_path, "w") as f:
        json.dump(report_data, f, indent=2)

    log(f"Final report saved to {report_path}", "ok")
    log(f"Labels saved to IronSight Memory (register-labels.md)", "ok")

    return labeled


def _print_final_map(labeled: dict, all_registers: list):
    """Pretty-print the final labeled register map."""
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


# ─────────────────────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="IronSight AI Analysis — Autonomous PLC reverse-engineering via Claude",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  ironsight-analyze.py 192.168.3.39                    # Fresh sweep + AI analysis
  ironsight-analyze.py 192.168.3.39 --rounds 20        # Up to 20 observation rounds
  ironsight-analyze.py 192.168.3.39 --duration 120     # 2 minute observations
  ironsight-analyze.py 192.168.3.39 --report report.json  # Use existing sweep data

Environment:
  ANTHROPIC_API_KEY    Required — your Anthropic API key
        """,
    )
    parser.add_argument("ip", help="PLC IP address")
    parser.add_argument("--port", type=int, default=502, help="Modbus TCP port (default: 502)")
    parser.add_argument("--rounds", type=int, default=10,
                        help="Max analysis rounds (default: 10)")
    parser.add_argument("--duration", type=int, default=60,
                        help="Observation duration per round in seconds (default: 60)")
    parser.add_argument("--report", help="Path to existing discovery report JSON")

    args = parser.parse_args()

    # Check for API key
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print(f"{RED}ERROR: ANTHROPIC_API_KEY environment variable not set.{RESET}")
        print(f"  export ANTHROPIC_API_KEY=sk-ant-...")
        sys.exit(1)

    analyze_unknown_plc(
        ip=args.ip,
        port=args.port,
        max_rounds=args.rounds,
        observation_duration=args.duration,
        existing_report=args.report,
    )


if __name__ == "__main__":
    main()
