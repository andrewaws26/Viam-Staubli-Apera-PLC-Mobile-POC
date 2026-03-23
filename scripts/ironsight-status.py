#!/usr/bin/env python3
"""
IronSight Status Bus — Shared status file that all IronSight components write to.

Every component (watchdog, plc_sensor, auto-discovery, Claude fixes) writes
its status here. The display script reads it to show what's happening.

Status file: /tmp/ironsight-status.json

Usage from Python:
    from ironsight_status import post
    post("watchdog", "checking", "Running health checks...")
    post("discovery", "scanning", "Scanning 192.168.1.0/24...", progress=45)
    post("claude", "fixing", "Restarting viam-server...")
    post("plc", "connected", "Reading DS registers", plc_ip="169.168.10.21")

Usage from bash:
    python3 scripts/ironsight-status.py watchdog checking "Running health checks..."
    python3 scripts/ironsight-status.py discovery scanning "Found PLC at 192.168.1.2" --progress 100
"""

import json
import os
import sys
import time
from pathlib import Path

STATUS_FILE = Path("/tmp/ironsight-status.json")
HISTORY_FILE = Path("/tmp/ironsight-history.json")
MAX_HISTORY = 50  # keep last 50 events


def _read_status() -> dict:
    """Read current status file."""
    try:
        return json.loads(STATUS_FILE.read_text())
    except Exception:
        return {"components": {}, "history": []}


def _read_history() -> list:
    """Read event history."""
    try:
        return json.loads(HISTORY_FILE.read_text())
    except Exception:
        return []


def post(component: str, phase: str, message: str,
         progress: int = -1, plc_ip: str = None,
         success: bool = None, level: str = "info",
         extra: dict = None):
    """Post a status update from any IronSight component.

    Args:
        component: Who is posting (watchdog, discovery, claude, plc, display, system)
        phase: Current phase/state (checking, scanning, fixing, connected, error, etc.)
        message: Human-readable status message
        progress: 0-100 progress bar, -1 to hide
        plc_ip: PLC IP if relevant
        success: True/False/None for status dot
        level: info, warning, error, success
        extra: Any additional key-value data
    """
    status = _read_status()
    history = _read_history()

    now = time.time()
    now_str = time.strftime("%H:%M:%S")

    entry = {
        "ts": now,
        "time": now_str,
        "phase": phase,
        "message": message,
        "level": level,
    }
    if progress >= 0:
        entry["progress"] = progress
    if plc_ip:
        entry["plc_ip"] = plc_ip
    if success is not None:
        entry["success"] = success
    if extra:
        entry.update(extra)

    # Update component status
    if "components" not in status:
        status["components"] = {}
    status["components"][component] = entry
    status["last_update"] = now
    status["last_update_str"] = now_str

    # Add to history (deduplicate rapid-fire same messages)
    hist_entry = {
        "ts": now,
        "time": now_str,
        "component": component,
        "message": message,
        "level": level,
    }

    if not history or history[-1].get("message") != message or history[-1].get("component") != component:
        history.append(hist_entry)
        # Trim
        if len(history) > MAX_HISTORY:
            history = history[-MAX_HISTORY:]

    try:
        STATUS_FILE.write_text(json.dumps(status, indent=2))
    except Exception:
        pass
    try:
        HISTORY_FILE.write_text(json.dumps(history))
    except Exception:
        pass


# CLI interface for bash scripts
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Post IronSight status update")
    parser.add_argument("component", help="Component name (watchdog, discovery, claude, plc)")
    parser.add_argument("phase", help="Current phase")
    parser.add_argument("message", help="Status message")
    parser.add_argument("--progress", type=int, default=-1)
    parser.add_argument("--plc-ip", default=None)
    parser.add_argument("--success", default=None, choices=["true", "false"])
    parser.add_argument("--level", default="info", choices=["info", "warning", "error", "success"])
    args = parser.parse_args()

    success_val = None
    if args.success == "true":
        success_val = True
    elif args.success == "false":
        success_val = False

    post(args.component, args.phase, args.message,
         progress=args.progress, plc_ip=args.plc_ip,
         success=success_val, level=args.level)
