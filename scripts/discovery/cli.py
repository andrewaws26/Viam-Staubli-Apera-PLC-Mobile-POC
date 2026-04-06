"""
CLI argument parsing and main entry point for IronSight Discovery.
"""

import argparse
import sys

from discovery.network import banner, scan_network
from discovery.plc import (
    full_discovery,
    probe_single,
    sweep_single,
    watch_registers,
)


def main() -> None:
    """Parse CLI arguments and dispatch to the appropriate discovery command."""
    parser = argparse.ArgumentParser(
        description="IronSight Discovery — Find and reverse-engineer unknown PLCs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  scan               Scan the local network for devices
  probe <ip>         Probe industrial protocol ports on a target
  sweep <ip>         Full register sweep (find all populated addresses)
  watch <ip>         Live register monitoring (identifies counters, flags, etc.)

Examples:
  ironsight discover                            # Auto-discover everything
  ironsight discover scan                       # Just find devices
  ironsight discover probe 192.168.3.39         # Probe a specific IP
  ironsight discover sweep 192.168.3.39         # Map all registers
  ironsight discover watch 192.168.3.39         # Monitor live changes
  ironsight discover watch 192.168.3.39 --protocol mc --port 5000
        """,
    )
    parser.add_argument("command", nargs="?", default="auto",
                        choices=["auto", "scan", "probe", "sweep", "watch"],
                        help="Command to run (default: auto)")
    parser.add_argument("target", nargs="?", help="Target IP address")
    parser.add_argument("--subnet", help="Subnet to scan (e.g., 192.168.3.0/24)")
    parser.add_argument("--port", type=int, default=502, help="Port (default: 502)")
    parser.add_argument("--protocol", default="modbus", choices=["modbus", "mc"],
                        help="Protocol for watch mode (default: modbus)")
    parser.add_argument("--duration", type=int, default=60,
                        help="Watch duration in seconds (default: 60)")
    parser.add_argument("--interval", type=float, default=0.5,
                        help="Watch interval in seconds (default: 0.5)")

    args = parser.parse_args()

    if args.command == "scan":
        banner()
        scan_network(args.subnet)

    elif args.command == "probe":
        if not args.target:
            print("ERROR: probe requires a target IP. "
                  "Usage: ironsight-discover.py probe <ip>")
            sys.exit(1)
        probe_single(args.target)

    elif args.command == "sweep":
        if not args.target:
            print("ERROR: sweep requires a target IP. "
                  "Usage: ironsight-discover.py sweep <ip>")
            sys.exit(1)
        sweep_single(args.target)

    elif args.command == "watch":
        if not args.target:
            print("ERROR: watch requires a target IP. "
                  "Usage: ironsight-discover.py watch <ip>")
            sys.exit(1)
        banner()
        watch_registers(args.target, port=args.port, protocol=args.protocol,
                        duration=args.duration, interval=args.interval)

    elif args.command == "auto":
        full_discovery(args.subnet)
