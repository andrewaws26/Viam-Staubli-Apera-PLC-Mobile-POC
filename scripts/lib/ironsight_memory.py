#!/usr/bin/env python3
"""
IronSight Persistent Memory — Local knowledge base for Claude across sessions.

Stores:
  ~/.ironsight/memory/*.md    — Markdown files Claude reads at startup
  ~/.ironsight/devices/*.json — Discovered device profiles
  ~/.ironsight/logs/events.jsonl — Structured event log

Usage:
    from ironsight_memory import IronSightMemory
    mem = IronSightMemory()
    mem.append("learnings.md", "DS7 is the real travel accumulator, not DS8")
    mem.log_event("watchdog", "plc_reconnected", {"ip": "169.168.10.21"})
    context = mem.get_context()  # Returns all memory as a single string for system prompts
"""

import fcntl
import json
import os
import time
from datetime import datetime, timezone
from typing import Optional


class IronSightMemory:
    """Read/write the ~/.ironsight/ knowledge base."""

    def __init__(self, base_dir: str = "~/.ironsight"):
        self.base_dir = os.path.expanduser(base_dir)
        self.memory_dir = os.path.join(self.base_dir, "memory")
        self.devices_dir = os.path.join(self.base_dir, "devices")
        self.logs_dir = os.path.join(self.base_dir, "logs")
        self.events_file = os.path.join(self.logs_dir, "events.jsonl")

        # Ensure dirs exist
        for d in [self.memory_dir, self.devices_dir, self.logs_dir]:
            os.makedirs(d, exist_ok=True)

    # ─── Memory files (Markdown) ───────────────────────────────

    def read(self, filename: str) -> str:
        """Read a memory file. Returns empty string if not found."""
        path = os.path.join(self.memory_dir, filename)
        try:
            with open(path, "r") as f:
                return f.read()
        except FileNotFoundError:
            return ""

    def write(self, filename: str, content: str):
        """Overwrite a memory file entirely."""
        path = os.path.join(self.memory_dir, filename)
        with open(path, "w") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            f.write(content)
            fcntl.flock(f, fcntl.LOCK_UN)

    def append(self, filename: str, content: str):
        """Append a timestamped entry to a memory file."""
        path = os.path.join(self.memory_dir, filename)
        ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        entry = f"\n### [{ts}]\n{content}\n"
        with open(path, "a") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            f.write(entry)
            fcntl.flock(f, fcntl.LOCK_UN)

    def list_memory_files(self) -> list:
        """List all memory files."""
        try:
            return sorted(f for f in os.listdir(self.memory_dir) if f.endswith(".md"))
        except FileNotFoundError:
            return []

    def get_context(self) -> str:
        """
        Build a single string of all memory for injection into Claude system prompts.
        Returns formatted content from all .md files in memory/.
        """
        sections = []
        for filename in self.list_memory_files():
            content = self.read(filename)
            if content.strip():
                label = filename.replace(".md", "").replace("-", " ").title()
                sections.append(f"## {label}\n{content.strip()}")

        if not sections:
            return ""

        return (
            "# IronSight Memory (persistent across sessions)\n\n"
            + "\n\n---\n\n".join(sections)
        )

    # ─── Device files (JSON) ──────────────────────────────────

    def read_device(self, device_id: str) -> Optional[dict]:
        """Read a device JSON profile. Returns None if not found."""
        path = os.path.join(self.devices_dir, f"{device_id}.json")
        try:
            with open(path, "r") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def write_device(self, device_id: str, data: dict):
        """Write/update a device JSON profile."""
        path = os.path.join(self.devices_dir, f"{device_id}.json")
        data["_last_updated"] = datetime.now(timezone.utc).isoformat()
        with open(path, "w") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            json.dump(data, f, indent=2, default=str)
            f.write("\n")
            fcntl.flock(f, fcntl.LOCK_UN)

    def list_devices(self) -> list:
        """List all known device IDs."""
        try:
            return sorted(
                f.replace(".json", "")
                for f in os.listdir(self.devices_dir)
                if f.endswith(".json")
            )
        except FileNotFoundError:
            return []

    # ─── Event log (JSONL) ────────────────────────────────────

    def log_event(self, source: str, event: str, data: Optional[dict] = None):
        """
        Append a structured event to the event log.

        Args:
            source: What generated the event (e.g., "watchdog", "discovery-daemon", "user")
            event: Event type (e.g., "eth0_up", "plc_found", "incident")
            data: Optional dict of event-specific data
        """
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "source": source,
            "event": event,
        }
        if data:
            entry["data"] = data

        with open(self.events_file, "a") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            f.write(json.dumps(entry, default=str) + "\n")
            fcntl.flock(f, fcntl.LOCK_UN)

    def read_events(
        self,
        source: Optional[str] = None,
        since: Optional[float] = None,
        limit: int = 50,
    ) -> list:
        """
        Read recent events from the log.

        Args:
            source: Filter by source (optional)
            since: Unix timestamp — only return events after this time (optional)
            limit: Max events to return (default 50, newest first)
        """
        events = []
        try:
            with open(self.events_file, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if source and entry.get("source") != source:
                        continue

                    if since:
                        try:
                            ts = datetime.fromisoformat(entry["ts"])
                            if ts.timestamp() < since:
                                continue
                        except (KeyError, ValueError):
                            continue

                    events.append(entry)
        except FileNotFoundError:
            pass

        # Return newest first, limited
        return events[-limit:][::-1]

    def get_recent_events_summary(self, hours: int = 24, limit: int = 20) -> str:
        """Get a human-readable summary of recent events for system prompts."""
        since = time.time() - (hours * 3600)
        events = self.read_events(since=since, limit=limit)
        if not events:
            return "No recent events."

        lines = []
        for e in events:
            ts = e.get("ts", "?")[:19].replace("T", " ")
            source = e.get("source", "?")
            event = e.get("event", "?")
            data_str = ""
            if e.get("data"):
                # Compact data representation
                data_str = " | " + ", ".join(
                    f"{k}={v}" for k, v in e["data"].items()
                    if k != "_last_updated"
                )
            lines.append(f"  [{ts}] {source}: {event}{data_str}")

        return "\n".join(lines)

    # ─── Utilities ────────────────────────────────────────────

    def ensure_seed_files(self):
        """Create seed memory files if they don't exist. Idempotent."""
        seeds = {
            "andrew.md": SEED_ANDREW,
            "projects.md": SEED_PROJECTS,
            "learnings.md": SEED_LEARNINGS,
            "preferences.md": SEED_PREFERENCES,
        }
        for filename, content in seeds.items():
            path = os.path.join(self.memory_dir, filename)
            if not os.path.exists(path):
                with open(path, "w") as f:
                    f.write(content)


# ─── Seed content ─────────────────────────────────────────────

SEED_ANDREW = """\
# Andrew

## Who
- System architect for TPS (Tie Plate System) railroad monitoring
- Deploys Raspberry Pi 5 + Click PLC systems on 30+ railroad trucks
- Hands-on — works on job sites, troubleshoots hardware, writes code
- Thinks in terms of physical systems and practical outcomes

## Communication style
- Direct, no-nonsense — skip the preamble
- Prefers plain English over jargon
- Says "do it" when he means implement, not describe
- Values initiative — wants IronSight to act, not just report

## Work context
- Based in a railroad shop environment
- PLC equipment may be powered off after work hours (explains overnight eth0 down)
- Uses SSH via Tailscale from phone when mobile
- Verizon hotspot as backup connectivity
"""

SEED_PROJECTS = """\
# Active Projects

## TPS Remote Monitoring (primary)
- Raspberry Pi 5 reads Click PLC C0-10DD2E-D via Modbus TCP
- Data flows to Viam Cloud, displayed on Next.js dashboard
- 30+ trucks in the fleet, each getting this setup
- Dashboard: viam-staubli-apera-plc-mobile-poc.vercel.app

## IronSight Watchdog
- Cron job every 5 minutes checks system health
- Calls Claude headless to diagnose and fix issues
- Writes incident reports to scripts/incidents/
- Has been running autonomously for months

## IronSight Discovery
- Tool to scan unknown PLCs on any network
- Supports Modbus TCP, MC Protocol (Mitsubishi), EtherNet/IP
- Generates register maps and briefing reports

## IronSight Portable (new)
- Making the Pi a portable AI partner
- Persistent memory (this system)
- Auto-discovery daemon
- Future: voice interface, general-purpose edge AI

## Pending
- OverflowError backoff fix on branch watchdog/fix-backoff-overflow (needs PR/review)
"""

SEED_LEARNINGS = """\
# Learnings

Things IronSight has figured out from incidents and debugging.

### PLC / Modbus
- DS7 is the real travel accumulator (not DS8)
- DD1 encoder gets reset each PLC scan cycle — useless for raw distance
- Tie plate target spacing is 19.5 inches (was 18, updated)
- Detector offset is 607.5 inches
- Y1 chatters — plate drops need debounce logic
- PLC at 169.168.10.21:502, Click C0-10DD2E-D

### viam-server
- gRPC sessions get stuck sometimes — restart fixes it
- Module restarts via systemctl restart viam-server
- Capture dir: ~/.viam/capture (.prog = active, .capture = completed)
- Grace period after restart: 3 minutes before watchdog alerts

### Networking
- eth0 NO-CARRIER = physical link down (cable or PLC power)
- PLC is powered off after work hours — overnight eth0 down is normal
- WiFi priority: B&B Shop (30) > Verizon (20) > Andrew hotspot (10)
- Tailscale always works: 100.112.68.52

### Watchdog
- 219+ consecutive failures during overnight PLC shutdown is normal
- Backoff overflow bug found and fixed (branch: watchdog/fix-backoff-overflow)
- Never push to main, always branch and PR
"""

SEED_PREFERENCES = """\
# Preferences

## Code
- Python for modules and scripts
- Bash for CLI tools
- TypeScript/Next.js for dashboard
- Always branch and PR, never push to main
- Commit messages: concise, explain the why

## System
- Keep dashboard mobile-friendly (Tailwind responsive)
- Viam credentials server-side only (never in browser)
- Conservative watchdog fixes — log and don't act if unsure
- Clean up disk if >95% full

## IronSight behavior
- Be direct — skip preamble
- Act on clear instructions, ask on ambiguous ones
- When something new is learned, write it to memory
- Incidents go to scripts/incidents/
"""


# ─── CLI for testing ──────────────────────────────────────────

if __name__ == "__main__":
    import sys

    mem = IronSightMemory()
    mem.ensure_seed_files()

    if len(sys.argv) < 2:
        print("IronSight Memory")
        print(f"  Base: {mem.base_dir}")
        print(f"  Memory files: {mem.list_memory_files()}")
        print(f"  Devices: {mem.list_devices()}")
        print()
        print("Usage:")
        print("  python3 ironsight_memory.py seed       # Create seed files")
        print("  python3 ironsight_memory.py context     # Print full context")
        print("  python3 ironsight_memory.py read <file> # Read a memory file")
        print("  python3 ironsight_memory.py events      # Show recent events")
        print("  python3 ironsight_memory.py devices     # List known devices")
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == "seed":
        mem.ensure_seed_files()
        print("Seed files created/verified.")
        for f in mem.list_memory_files():
            print(f"  {mem.memory_dir}/{f}")

    elif cmd == "context":
        ctx = mem.get_context()
        print(ctx if ctx else "No memory files found.")

    elif cmd == "read":
        if len(sys.argv) < 3:
            print("Usage: ironsight_memory.py read <filename>")
            sys.exit(1)
        print(mem.read(sys.argv[2]))

    elif cmd == "events":
        summary = mem.get_recent_events_summary()
        print(summary)

    elif cmd == "devices":
        for d in mem.list_devices():
            info = mem.read_device(d)
            print(f"  {d}: {info.get('vendor', '?')} @ {info.get('ip', '?')}")

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
