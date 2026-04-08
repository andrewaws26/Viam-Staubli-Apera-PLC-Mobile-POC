#!/usr/bin/env python3
"""
IronSight Field Test Analyzer — summarize structured logs after a test run.

Reads /var/log/ironsight-field.jsonl and produces a human-readable report
covering uptime, failures, discovery performance, CAN bus health, and more.

Usage:
    python3 scripts/analyze-field-test.py
    python3 scripts/analyze-field-test.py /path/to/ironsight-field.jsonl
    python3 scripts/analyze-field-test.py --since "2026-04-08T10:00"
"""

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

DEFAULT_LOG = Path("/var/log/ironsight-field.jsonl")


def load_events(path: Path, since: Optional[str] = None) -> list[dict]:
    """Load JSON-lines events, optionally filtering by timestamp."""
    events = []
    try:
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
                if since and ev.get("ts", "") < since:
                    continue
                events.append(ev)
            except json.JSONDecodeError:
                continue
    except FileNotFoundError:
        print(f"Log file not found: {path}")
        sys.exit(1)
    return events


def analyze(events: list[dict]) -> None:
    """Print a comprehensive field-test analysis report."""
    if not events:
        print("No events found in log file.")
        return

    first_ts = events[0].get("ts", "?")
    last_ts = events[-1].get("ts", "?")
    duration_min = 0
    try:
        t0 = events[0].get("epoch", 0)
        t1 = events[-1].get("epoch", 0)
        duration_min = round((t1 - t0) / 60, 1)
    except (TypeError, KeyError):
        pass

    print("=" * 70)
    print("  IRONSIGHT FIELD TEST REPORT")
    print("=" * 70)
    print(f"  Period:    {first_ts} → {last_ts}")
    print(f"  Duration:  {duration_min} minutes ({len(events)} events)")
    print()

    # ── Category breakdown ──
    cats = Counter(ev.get("cat") for ev in events)
    print("── Event Categories ──")
    for cat, count in cats.most_common():
        print(f"  {cat:<15} {count:>6} events")
    print()

    # ── System Health Summary ──
    health = [ev for ev in events if ev.get("event") == "health_snapshot"]
    if health:
        temps = [ev.get("cpu_temp_c", 0) for ev in health if ev.get("cpu_temp_c")]
        mems = [ev.get("mem_pct", 0) for ev in health if ev.get("mem_pct")]
        disks = [ev.get("disk_pct", 0) for ev in health if ev.get("disk_pct")]
        throttled = [ev for ev in health if ev.get("throttled", "0x0") != "0x0"]

        print("── System Health ──")
        if temps:
            print(f"  CPU Temp:     avg {sum(temps)/len(temps):.1f}°C, "
                  f"max {max(temps):.1f}°C, min {min(temps):.1f}°C")
        if mems:
            print(f"  Memory:       avg {sum(mems)/len(mems):.1f}%, max {max(mems):.1f}%")
        if disks:
            print(f"  Disk:         avg {sum(disks)/len(disks):.1f}%, max {max(disks):.1f}%")
        if throttled:
            print(f"  THROTTLED:    {len(throttled)} snapshots showed throttling!")
            for ev in throttled[:3]:
                print(f"    {ev.get('ts')}: {ev.get('throttled')}")
        else:
            print(f"  Throttling:   None detected (good power supply)")
        print()

    # ── Service Uptime ──
    svc_events = [ev for ev in events if ev.get("event") == "service_status"]
    if svc_events:
        print("── Service Availability ──")
        for svc in ["viam", "can0", "plc_subnet", "tailscale"]:
            states = [ev.get(svc, "unknown") for ev in svc_events]
            active = sum(1 for s in states if s == "active")
            total = len(states)
            pct = (active / total * 100) if total else 0
            print(f"  {svc:<15} {pct:>5.1f}% uptime ({active}/{total} checks)")
        print()

    # ── PLC Connection ──
    plc = [ev for ev in events if ev.get("cat") == "plc" and ev.get("event") == "connection_check"]
    if plc:
        ok = sum(1 for ev in plc if ev.get("ok"))
        fail = len(plc) - ok
        latencies = [ev.get("ms") for ev in plc if ev.get("ms") is not None and ev.get("ok")]
        print("── PLC Connection ──")
        print(f"  Checks:       {len(plc)} total, {ok} OK, {fail} FAILED")
        if latencies:
            print(f"  Latency:      avg {sum(latencies)/len(latencies):.0f}ms, "
                  f"max {max(latencies)}ms, min {min(latencies)}ms")
        if fail:
            pct = (ok / len(plc) * 100) if plc else 0
            print(f"  Availability: {pct:.1f}%")
            # Show first few failures
            fails = [ev for ev in plc if not ev.get("ok")]
            for ev in fails[:3]:
                print(f"    FAIL @ {ev.get('ts')}: {ev.get('error', 'timeout')}")
        print()

    # ── CAN Bus ──
    can = [ev for ev in events if ev.get("cat") == "can" and ev.get("event") == "status_check"]
    if can:
        up = sum(1 for ev in can if ev.get("ok"))
        listen_violations = [ev for ev in can if not ev.get("listen_only", True)]
        rx_counts = [ev.get("rx_frames", 0) for ev in can]
        print("── CAN Bus (J1939) ──")
        print(f"  Interface:    {up}/{len(can)} checks UP ({up/len(can)*100:.1f}% uptime)")
        if rx_counts and len(rx_counts) > 1:
            # Calculate frame rate from consecutive readings
            deltas = [rx_counts[i] - rx_counts[i-1] for i in range(1, len(rx_counts))
                      if rx_counts[i] >= rx_counts[i-1]]
            if deltas:
                print(f"  RX frames:    {rx_counts[-1]} total, ~{sum(deltas)//len(deltas)} per interval")
        if listen_violations:
            print(f"  WARNING:      {len(listen_violations)} checks showed listen-only OFF!")
        else:
            print(f"  Listen-only:  Always ON (correct)")
        print()

    # ── Network ──
    net = [ev for ev in events if ev.get("cat") == "network" and ev.get("event") == "status_check"]
    if net:
        eth0_up = sum(1 for ev in net if ev.get("eth0_carrier", 0) == 1)
        inet_up = sum(1 for ev in net if ev.get("internet"))
        print("── Network ──")
        print(f"  Ethernet:     {eth0_up}/{len(net)} checks with carrier ({eth0_up/len(net)*100:.1f}%)")
        print(f"  Internet:     {inet_up}/{len(net)} checks connected ({inet_up/len(net)*100:.1f}%)")
        print()

    # ── Discovery Events ──
    disc = [ev for ev in events if ev.get("cat") == "discovery"]
    if disc:
        print("── PLC Discovery ──")
        for ev in disc:
            ts = ev.get("ts", "?")
            event = ev.get("event", "?")
            ok = ev.get("ok")
            ms = ev.get("ms")
            method = ev.get("method", "")
            plc_ip = ev.get("plc_ip", "")
            detail = f"  {ts}: {event}"
            if ok is not None:
                detail += f" ok={ok}"
            if ms:
                detail += f" ({ms:.0f}ms)"
            if method:
                detail += f" via {method}"
            if plc_ip:
                detail += f" → {plc_ip}"
            print(detail)
        print()

    # ── Module Errors ──
    mod_logs = [ev for ev in events if ev.get("event") == "log_activity"]
    if mod_logs:
        total_errors = sum(ev.get("error_count", 0) for ev in mod_logs)
        if total_errors > 0:
            print("── Module Errors ──")
            print(f"  Total errors in viam-server logs: {total_errors}")
            high_error = [ev for ev in mod_logs if ev.get("error_count", 0) > 5]
            for ev in high_error[:5]:
                print(f"    {ev.get('ts')}: {ev.get('error_count')} errors")
            print()

    # ── Recommendations ──
    print("── Recommendations ──")
    issues = []

    if health:
        max_temp = max(ev.get("cpu_temp_c", 0) for ev in health)
        if max_temp > 75:
            issues.append(f"CPU reached {max_temp:.0f}°C — consider improving airflow or heatsink")
        throttled_count = len([ev for ev in health if ev.get("throttled", "0x0") != "0x0"])
        if throttled_count:
            issues.append(f"Throttling detected {throttled_count} times — upgrade power supply to 5V/5A")

    if plc:
        plc_fail_pct = (sum(1 for ev in plc if not ev.get("ok")) / len(plc) * 100) if plc else 0
        if plc_fail_pct > 5:
            issues.append(f"PLC connection failed {plc_fail_pct:.0f}% of the time — check Ethernet cable/switch")

    if can:
        can_down_pct = (sum(1 for ev in can if not ev.get("ok")) / len(can) * 100) if can else 0
        if can_down_pct > 5:
            issues.append(f"CAN bus down {can_down_pct:.0f}% of the time — check HAT seating and boot overlay")

    if not issues:
        print("  No issues detected — system looks healthy for deployment!")
    else:
        for i, issue in enumerate(issues, 1):
            print(f"  {i}. {issue}")

    print()
    print("=" * 70)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="IronSight Field Test Analyzer")
    parser.add_argument("logfile", nargs="?", default=str(DEFAULT_LOG),
                        help="Path to ironsight-field.jsonl")
    parser.add_argument("--since", help="Only include events after this timestamp")
    args = parser.parse_args()

    events = load_events(Path(args.logfile), args.since)
    analyze(events)


if __name__ == "__main__":
    main()
