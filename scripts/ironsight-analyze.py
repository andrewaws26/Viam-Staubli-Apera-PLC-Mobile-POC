#!/usr/bin/env python3
"""
IronSight AI Analysis Loop -- Autonomous PLC reverse-engineering via Claude.

Takes the output of ironsight-discover.py (phases 1-3: scan, probe, sweep)
and runs an iterative AI observation loop. Claude examines unknown registers,
designs 60-second observation tests, interprets the results, and progressively
builds a complete register map -- even when you can't pull the ladder logic.

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
    pip3 install pymodbus>=3.5
    Claude Code CLI (claude) must be installed and authenticated

Requires a Claude Pro/Team/Enterprise subscription -- no API key needed.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime

# Import from sibling modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "lib"))
from ironsight_memory import IronSightMemory
from plc_discovery import (
    claude_headless,
    watch_specific_registers,
    print_final_map,
    CLAUDE_CLI,
    SYSTEM_PROMPT,
)

# Also import sweep functions from discovery
sys.path.insert(0, os.path.dirname(__file__))
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
#  AI Analysis Loop
# ─────────────────────────────────────────────────────────────

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
║  {BOLD}IronSight AI Analysis Loop{RESET}{CYAN}                                  ║
║  Autonomous PLC reverse-engineering via Claude                ║
╚══════════════════════════════════════════════════════════════╝{RESET}
""")

    memory = IronSightMemory()

    # -- Step 1: Get the register map --
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

    # -- Step 2: Load prior knowledge --
    known_labels = memory.read("register-labels.md")
    prior_observations = memory.read("observations.md")

    labeled = {}  # reg_name -> label
    unknowns = [r["name"] for r in all_registers]

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
        print_final_map(labeled, all_registers, GREEN, YELLOW, DIM, BOLD, RESET)
        return labeled

    log(f"Unknown registers remaining: {len(unknowns)}")

    # -- Step 3: AI observation loop --
    for round_num in range(1, max_rounds + 1):
        if not unknowns:
            log("All registers labeled!", "ok")
            break

        print(f"\n{BOLD}{'=' * 60}{RESET}")
        print(f"{BOLD}  Round {round_num}/{max_rounds} -- {len(unknowns)} unknown registers{RESET}")
        print(f"{'=' * 60}\n")

        # -- 3a: Ask Claude what to investigate --
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
            json_str = plan_response
            if "```json" in json_str:
                json_str = json_str.split("```json")[1].split("```")[0]
            elif "```" in json_str:
                json_str = json_str.split("```")[1].split("```")[0]
            plan = json.loads(json_str.strip())
        except (json.JSONDecodeError, IndexError):
            log(f"Could not parse Claude's plan, using fallback", "warn")
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

        # -- 3b: Run the observation --
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

        for reg, stats in observation.get("register_stats", {}).items():
            if "error" in stats:
                continue
            change_info = f"{stats['changes']} changes" if stats.get('changes', 0) > 0 else "static"
            val_info = f"range {stats['min']}-{stats['max']}" if stats.get('min') is not None else ""
            print(f"    {reg:<20} {change_info:<18} {val_info}")

        # -- 3c: Ask Claude to interpret results --
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

        # -- 3d: Update labels and memory --
        newly_labeled = findings.get("labeled", {})
        if newly_labeled:
            print(f"\n  {GREEN}{BOLD}New labels:{RESET}")
            for reg, info in newly_labeled.items():
                if isinstance(info, dict):
                    label = info.get("label", "?")
                    confidence = info.get("confidence", "?")
                    evidence = info.get("evidence", "")
                    full_label = f"{label} [{confidence}] -- {evidence}"
                else:
                    label = str(info)
                    full_label = label
                    confidence = "medium"

                labeled[reg] = full_label
                if reg in unknowns:
                    unknowns.remove(reg)
                print(f"    {GREEN}{reg:<20} -> {label} ({confidence}){RESET}")

        findings_text = findings.get("findings", "No summary available")
        print(f"\n  {BOLD}Summary:{RESET} {findings_text}")

        if findings.get("next_suggestion"):
            print(f"  {DIM}Next: {findings['next_suggestion']}{RESET}")

        # Save to persistent memory
        round_entry = (
            f"## Round {round_num} -- {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
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

        labels_md = "# Register Labels\n\nLabeled by IronSight AI Analysis Loop.\n\n"
        for reg_name in sorted(labeled.keys()):
            labels_md += f"- {reg_name}: {labeled[reg_name]}\n"
        memory.write("register-labels.md", labels_md)

        memory.log_event("ai-analysis", "round_complete", {
            "round": round_num,
            "ip": ip,
            "newly_labeled": len(newly_labeled),
            "total_labeled": len(labeled),
            "remaining_unknown": len(unknowns),
        })

        log(f"Round {round_num} complete: {len(newly_labeled)} new labels, "
            f"{len(unknowns)} still unknown", "ok")

        if unknowns and round_num < max_rounds:
            time.sleep(2)

    # -- Step 4: Final report --
    print(f"\n{'=' * 60}")
    print(f"{BOLD}  ANALYSIS COMPLETE{RESET}")
    print(f"{'=' * 60}\n")

    print_final_map(labeled, all_registers, GREEN, YELLOW, DIM, BOLD, RESET)

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


# ─────────────────────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="IronSight AI Analysis -- Autonomous PLC reverse-engineering via Claude",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  ironsight-analyze.py 192.168.3.39                    # Fresh sweep + AI analysis
  ironsight-analyze.py 192.168.3.39 --rounds 20        # Up to 20 observation rounds
  ironsight-analyze.py 192.168.3.39 --duration 120     # 2 minute observations
  ironsight-analyze.py 192.168.3.39 --report report.json  # Use existing sweep data

Environment:
  CLAUDE_CLI           Override claude binary path (default: "claude")
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

    # Check that claude CLI is available
    try:
        result = subprocess.run(
            [CLAUDE_CLI, "--version"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            raise FileNotFoundError
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print(f"{RED}ERROR: Claude CLI not found. Install it first:{RESET}")
        print(f"  npm install -g @anthropic-ai/claude-code")
        print(f"  Then run: claude login")
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
