"""
IronSight Discovery — Find, connect to, and reverse-engineer unknown PLCs.

Plug into any industrial network and IronSight will:
  1. Scan the network for devices
  2. Identify PLCs by MAC vendor + open ports
  3. Try Modbus TCP, MC Protocol (Mitsubishi MELSEC), EtherNet/IP
  4. Sweep all register spaces and map what's populated
  5. Watch registers in real-time to identify counters, timers, setpoints
  6. Generate a register map report

Requires: pip3 install pymodbus>=3.5
Optional: nmap (for network scanning)
"""

from discovery.network import (
    scan_network,
    probe_ports,
    identify_vendor,
    get_local_subnets,
)
from discovery.modbus import (
    try_modbus,
    try_mc_protocol,
    sweep_modbus,
    sweep_mc_protocol,
)
from discovery.plc import (
    watch_registers,
    generate_report,
    full_discovery,
    probe_single,
    sweep_single,
)
from discovery.cli import main

__all__ = [
    "scan_network",
    "probe_ports",
    "identify_vendor",
    "get_local_subnets",
    "try_modbus",
    "try_mc_protocol",
    "sweep_modbus",
    "sweep_mc_protocol",
    "watch_registers",
    "generate_report",
    "full_discovery",
    "probe_single",
    "sweep_single",
    "main",
]
