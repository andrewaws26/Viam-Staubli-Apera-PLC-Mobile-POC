"""
PLC-specific identification, live watch mode, report generation, and discovery pipelines.
"""

import json
import os
import socket
import time
from collections import defaultdict
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from pymodbus.client import ModbusTcpClient

from discovery.network import (
    BOLD, GREEN, YELLOW, CYAN, DIM, RED, RESET,
    MITSUB_DEVICES,
    banner, log,
    scan_network, probe_ports,
)
from discovery.modbus import (
    try_modbus, try_mc_protocol,
    sweep_modbus, sweep_mc_protocol,
    read_all_modbus, read_all_mc,
)


def watch_registers(ip: str, port: int = 502, protocol: str = "modbus",
                    duration: int = 60, interval: float = 0.5) -> dict:
    """Watch registers in real-time to identify dynamic behavior.

    Args:
        ip: Target IP address.
        port: Protocol port.
        protocol: "modbus" or "mc".
        duration: Observation duration in seconds.
        interval: Polling interval in seconds.

    Returns:
        Analysis dict with counters, oscillators, setpoints, unknown_dynamic,
        and static_count.
    """
    print(f"\n{BOLD}═══ Phase 4: Live Register Watch — {ip} ({protocol}) ═══{RESET}")
    print(f"  Watching for {duration}s at {interval}s intervals. Press Ctrl+C to stop.\n")

    snapshots: List[dict] = []
    change_counts: Dict[str, int] = defaultdict(int)
    min_vals: dict = {}
    max_vals: dict = {}
    first_vals: dict = {}

    if protocol == "modbus":
        client = ModbusTcpClient(ip, port=port, timeout=3)
        if not client.connect():
            log("Cannot connect", "error")
            return {}
        read_fn = lambda: read_all_modbus(client)
    elif protocol == "mc":
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        sock.connect((ip, port))
        read_fn = lambda: read_all_mc(sock)
    else:
        log(f"Unknown protocol: {protocol}", "error")
        return {}

    prev_snap: Optional[dict] = None
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
                changes: dict = {}
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
    print(f"\n{BOLD}═══ Register Analysis ({elapsed_total:.0f}s, "
          f"{len(snapshots)} samples) ═══{RESET}\n")

    if not change_counts:
        log("No register changes detected during observation period", "warn")
        log("The PLC may be idle. Try again while the machine is running.", "warn")
        return {"counters": [], "oscillators": [], "setpoints": [],
                "unknown_dynamic": [], "static_count": len(first_vals)}

    # Classify registers
    counters: List[dict] = []
    oscillators: List[dict] = []
    setpoints: List[dict] = []
    unknown_dynamic: List[dict] = []

    for reg, count in sorted(change_counts.items(), key=lambda x: -x[1]):
        if reg not in first_vals or not isinstance(first_vals[reg], (int, float)):
            continue

        change_rate = count / elapsed_total
        val_range = max_vals.get(reg, 0) - min_vals.get(reg, 0)
        first = first_vals[reg]
        last = prev_snap.get(reg, first) if prev_snap else first

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
        print(f"  {DIM}+ {static_count} static registers "
              f"(unchanged during observation){RESET}\n")

    return {
        "counters": counters,
        "oscillators": oscillators,
        "setpoints": setpoints,
        "unknown_dynamic": unknown_dynamic,
        "static_count": static_count,
    }


# ── Report Generation ──

def generate_report(ip: str, vendor: str, protocols: dict,
                    register_map: dict, watch_analysis: Optional[dict] = None,
                    output_dir: Optional[str] = None) -> Tuple[str, str]:
    """Generate a JSON report and a plain-English briefing for Claude handoff.

    Args:
        ip: Target IP address.
        vendor: Identified vendor name.
        protocols: Dict of detected protocols {port: name}.
        register_map: Full register map from sweep phase.
        watch_analysis: Optional analysis from watch phase.
        output_dir: Directory for output files (default: script dir).

    Returns:
        Tuple of (json_report_path, briefing_path).
    """
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

    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
    filename = f"ironsight-discovery-{ip.replace('.', '_')}-{ts}.json"
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


def _build_briefing(ip: str, vendor: str, protocols: dict,
                    register_map: dict,
                    watch_analysis: Optional[dict] = None) -> str:
    """Build a plain-text briefing of everything discovery found."""
    lines: List[str] = []
    lines.append(f"DISCOVERY REPORT — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"{'=' * 60}")
    lines.append("")
    lines.append(f"TARGET: {ip}")
    lines.append(f"VENDOR: {vendor}")
    lines.append(f"PROTOCOLS: {', '.join(f'{name} (port {port})' for port, name in protocols.items())}")
    lines.append("")

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
                lines.append(f"  {c['register']}: went from {c['first']} to "
                             f"{c['last']} (changed {c['changes']} times)")
            lines.append("")

        if watch_analysis.get("oscillators"):
            lines.append("--- Likely STATUS FLAGS (values toggling on/off) ---")
            for o in watch_analysis["oscillators"]:
                lines.append(f"  {o['register']}: toggled {o['changes']} times "
                             f"between {o['min']} and {o['max']}")
            lines.append("")

        if watch_analysis.get("setpoints"):
            lines.append("--- Likely SETPOINTS (values that rarely change) ---")
            for s in watch_analysis["setpoints"]:
                lines.append(f"  {s['register']}: was {s['first']}, "
                             f"changed to {s['last']}")
            lines.append("")

        if watch_analysis.get("unknown_dynamic"):
            lines.append("--- UNCLASSIFIED (need more observation) ---")
            for u in watch_analysis["unknown_dynamic"]:
                lines.append(f"  {u['register']}: range {u['min']}-{u['max']}, "
                             f"changed {u['changes']} times")
            lines.append("")

        static = watch_analysis.get("static_count", 0)
        if static:
            lines.append(f"--- {static} registers did not change during observation ---")
            lines.append("")

    return "\n".join(lines)


# ── Discovery Pipelines ──

def full_discovery(subnet: Optional[str] = None) -> Optional[str]:
    """Run full discovery pipeline: scan -> probe -> sweep -> watch -> report."""
    banner()
    print(f"  Scanning network, looking for PLCs...\n")

    # Phase 1: Find devices
    devices = scan_network(subnet)
    if not devices:
        print(f"\n  {RED}{BOLD}No devices found on the network.{RESET}")
        print(f"  Check that the Ethernet cable is plugged in.\n")
        return None

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
        print(f"\n  {YELLOW}No known PLC vendor in MAC table. "
              f"Trying {target['ip']} ({vendor})...{RESET}\n")

    target_ip = target["ip"]

    # Phase 2: Probe protocols
    open_ports = probe_ports(target_ip)

    if not open_ports:
        print(f"\n  {RED}{BOLD}No industrial protocol ports open on {target_ip}.{RESET}")
        print(f"  This device may not be a PLC, or it uses a protocol "
              f"I don't know yet.\n")
        return None

    # Phase 3: Try each detected protocol
    protocol_results: dict = {}
    register_map: dict = {}
    watch_protocol: Optional[str] = None
    watch_port: Optional[int] = None

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
                    print(f"\n  {GREEN}MC Protocol is working. "
                          f"Reading every register...{RESET}\n")
                    register_map = sweep_mc_protocol(target_ip, port)
                watch_protocol = "mc"
                watch_port = port
            break

    if not protocol_results or not any(r["success"] for r in protocol_results.values()):
        print(f"\n  {RED}{BOLD}Could not communicate with {target_ip}.{RESET}")
        print(f"  Ports are open but no protocol responded. "
              f"May need a different approach.\n")
        return None

    # Phase 4: Live watch
    total_regs = sum(len(v) for v in register_map.values())
    print(f"\n  {GREEN}{BOLD}Connected. Found {total_regs} active registers.{RESET}")
    print(f"\n  {BOLD}Now watching the PLC live — every register change shows up here.{RESET}")
    print(f"  {BOLD}Run the machine to see what each register does.{RESET}")
    print(f"  {DIM}Press Ctrl+C when you've seen enough.{RESET}\n")

    watch_analysis = watch_registers(
        target_ip, port=watch_port, protocol=watch_protocol,
        duration=300, interval=0.5,
    )

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


def probe_single(ip: str) -> None:
    """Probe a single known IP for all supported industrial protocols.

    Args:
        ip: Target IP address.
    """
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


def sweep_single(ip: str) -> None:
    """Full register sweep on a known IP.

    Args:
        ip: Target IP address.
    """
    banner()

    # Determine protocol
    open_ports = probe_ports(ip)
    register_map: dict = {}

    if 502 in open_ports:
        register_map = sweep_modbus(ip, 502)

    for port in [5000, 5001, 5002]:
        if port in open_ports:
            mc_map = sweep_mc_protocol(ip, port)
            if mc_map:
                register_map.update(mc_map)
            break

    if register_map:
        generate_report(ip, "Unknown", open_ports, register_map)
