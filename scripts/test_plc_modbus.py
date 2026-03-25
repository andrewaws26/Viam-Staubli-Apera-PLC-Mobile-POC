#!/usr/bin/env python3
"""
Modbus TCP connectivity test for the Click PLC C0-10DD2E-D.

Run this from the Pi 5 to verify the real PLC is reachable and its registers
match the layout expected by the plc-sensor Viam module.

Usage:
    python3 scripts/test_plc_modbus.py
    python3 scripts/test_plc_modbus.py --watch
    python3 scripts/test_plc_modbus.py --host 169.168.10.21 --port 502

Requires: pip3 install pymodbus>=3.5
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.plc_constants import PLC_HOST, PLC_PORT

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    print("ERROR: pymodbus not installed. Run: pip3 install pymodbus")
    sys.exit(1)

# ──────────────────────────────────────────────────────────────────────
# Click PLC DS register map — TPS (Tie Plate System) ladder logic
# DS1-DS25, Modbus holding register addresses 0-24
# ──────────────────────────────────────────────────────────────────────
_DS_REGISTER_NAMES = [
    "ds1",                  # DS1  / addr 0
    "ds2",                  # DS2  / addr 1
    "ds3",                  # DS3  / addr 2
    "ds4",                  # DS4  / addr 3
    "ds5",                  # DS5  / addr 4
    "ds6",                  # DS6  / addr 5
    "ds7",                  # DS7  / addr 6
    "ds8",                  # DS8  / addr 7
    "ds9",                  # DS9  / addr 8
    "ds10",                 # DS10 / addr 9
    "ds11",                 # DS11 / addr 10
    "ds12",                 # DS12 / addr 11
    "ds13",                 # DS13 / addr 12
    "ds14",                 # DS14 / addr 13
    "ds15",                 # DS15 / addr 14
    "ds16",                 # DS16 / addr 15
    "ds17",                 # DS17 / addr 16
    "ds18",                 # DS18 / addr 17
    "ds19",                 # DS19 / addr 18
    "ds20",                 # DS20 / addr 19
    "ds21",                 # DS21 / addr 20
    "ds22",                 # DS22 / addr 21
    "ds23",                 # DS23 / addr 22
    "ds24",                 # DS24 / addr 23
    "ds25",                 # DS25 / addr 24
]


def _uint16(v: int) -> int:
    return v & 0xFFFF


def read_snapshot(client: ModbusTcpClient) -> dict:
    """Read all PLC registers and return a dict of named values."""
    result = {}

    # ── DS holding registers (DS1-DS25) — addresses 0-24 ──
    r = client.read_holding_registers(address=0, count=25)
    if r.isError():
        raise RuntimeError(f"Failed to read DS registers (0-24): {r}")
    for i, name in enumerate(_DS_REGISTER_NAMES):
        result[name] = _uint16(r.registers[i])

    # ── DD1 Encoder — addresses 16384-16385 (32-bit signed) ──
    enc_lo, enc_hi = 0, 0
    try:
        r2 = client.read_holding_registers(address=16384, count=2)
        if not r2.isError():
            enc_lo = _uint16(r2.registers[0])
            enc_hi = _uint16(r2.registers[1])
    except Exception:
        pass
    encoder_count = (enc_hi << 16) | enc_lo
    if encoder_count > 0x7FFFFFFF:
        encoder_count -= 0x100000000
    result["encoder_count"] = encoder_count

    # ── Discrete inputs X1-X8 — FC02, addresses 0-7 ──
    di_names = ["x1", "x2", "x3_camera_signal", "x4_tps_power_loop",
                "x5_air_eagle_1", "x6_air_eagle_2", "x7_air_eagle_3", "x8"]
    try:
        r3 = client.read_discrete_inputs(address=0, count=8)
        if not r3.isError():
            for i, name in enumerate(di_names):
                result[name] = bool(r3.bits[i])
    except Exception as e:
        print(f"  Warning: Could not read discrete inputs: {e}")

    # ── Output coils Y1-Y3 — FC01, addresses 8192-8194 ──
    coil_names = ["y1_eject_tps_1", "y2_eject_left_tps_2", "y3_eject_right_tps_2"]
    try:
        r4 = client.read_coils(address=8192, count=3)
        if not r4.isError():
            for i, name in enumerate(coil_names):
                result[name] = bool(r4.bits[i])
    except Exception as e:
        print(f"  Warning: Could not read output coils: {e}")

    # ── Internal coils C1999-C2000 — FC01, addresses 1998-1999 ──
    try:
        r5 = client.read_coils(address=1998, count=2)
        if not r5.isError() and len(r5.bits) >= 2:
            result["c1999_encoder_reset"] = bool(r5.bits[0])
            result["c2000_floating_zero"] = bool(r5.bits[1])
    except Exception as e:
        print(f"  Warning: Could not read internal coils: {e}")

    return result


def print_snapshot(snap: dict, highlight_nonzero: bool = True) -> None:
    """Print the register snapshot in a readable format."""
    # DS registers
    print("\n  ── DS Holding Registers (DS1-DS25 / Modbus addr 0-24) ──")
    for name in _DS_REGISTER_NAMES:
        if name in snap:
            val = snap[name]
            flag = " ◀" if highlight_nonzero and val != 0 else ""
            print(f"    {name:<20s} = {val}{flag}")

    # Encoder
    if "encoder_count" in snap:
        print(f"\n  ── DD1 Encoder (addr 16384-16385) ──")
        print(f"    encoder_count        = {snap['encoder_count']}")

    # Discrete inputs
    di_keys = [k for k in snap if k.startswith("x")]
    if di_keys:
        print(f"\n  ── Discrete Inputs X1-X8 ──")
        for k in sorted(di_keys):
            val = snap[k]
            flag = " ◀" if highlight_nonzero and val else ""
            print(f"    {k:<24s} = {val}{flag}")

    # Output coils
    coil_keys = [k for k in snap if k.startswith("y")]
    if coil_keys:
        print(f"\n  ── Output Coils Y1-Y3 ──")
        for k in sorted(coil_keys):
            val = snap[k]
            flag = " ◀" if highlight_nonzero and val else ""
            print(f"    {k:<28s} = {val}{flag}")

    # Internal coils
    ic_keys = [k for k in snap if k.startswith("c")]
    if ic_keys:
        print(f"\n  ── Internal Coils C1999-C2000 ──")
        for k in sorted(ic_keys):
            val = snap[k]
            flag = " ◀" if highlight_nonzero and val else ""
            print(f"    {k:<28s} = {val}{flag}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Click PLC Modbus TCP connectivity test — TPS")
    parser.add_argument("--host", default=PLC_HOST, help=f"PLC IP address (default {PLC_HOST})")
    parser.add_argument("--port", type=int, default=PLC_PORT, help=f"Modbus TCP port (default {PLC_PORT})")
    parser.add_argument(
        "--watch", action="store_true",
        help="Poll every second and print changes (Ctrl+C to stop)"
    )
    args = parser.parse_args()

    print(f"Connecting to {args.host}:{args.port}...")
    client = ModbusTcpClient(args.host, port=args.port, timeout=3)
    if not client.connect():
        print(f"ERROR: Could not connect to {args.host}:{args.port}")
        print("  - Is the PLC powered on (PWR and RUN LEDs green)?")
        print(f"  - Is the PLC IP set to {args.host}? (check with Click Programming Software)")
        print(f"  - Is the Pi on the same subnet? (try: ping {args.host})")
        sys.exit(1)

    print("Connected OK")

    try:
        if args.watch:
            print("Watching for changes — press Ctrl+C to stop\n")
            prev = None
            while True:
                snap = read_snapshot(client)
                if snap != prev:
                    print(f"\n{'='*50}  {time.strftime('%H:%M:%S')}")
                    print_snapshot(snap)
                    prev = snap
                time.sleep(1.0)
        else:
            snap = read_snapshot(client)
            print_snapshot(snap)
            print("\nAll reads successful. PLC Modbus TCP is working.")
    except RuntimeError as e:
        print(f"\nERROR: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
