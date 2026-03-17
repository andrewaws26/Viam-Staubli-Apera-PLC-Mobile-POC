#!/usr/bin/env python3
"""
Modbus TCP connectivity test for the Click PLC C0-10DD2E-D.

Run this from the Pi 5 to verify the real PLC is reachable and its registers
match the layout expected by the plc-sensor Viam module.

Usage:
    python3 scripts/test_plc_modbus.py --host 192.168.0.10
    python3 scripts/test_plc_modbus.py --host 192.168.0.10 --watch
    python3 scripts/test_plc_modbus.py --host 192.168.0.10 --port 502 --unit 1

Install dependency if needed:
    pip3 install pymodbus
"""

import argparse
import sys
import time

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    print("ERROR: pymodbus not installed. Run: pip3 install pymodbus")
    sys.exit(1)

# Register map — must match plc-sensor/src/plc_sensor.py and the Click PLC ladder logic
_ECAT_NAMES = [
    "servo_power_on",   # DS1  / addr 0
    "servo_disable",    # DS2  / addr 1
    "plate_cycle",      # DS3  / addr 2
    "abort_stow",       # DS4  / addr 3
    "speed",            # DS5  / addr 4
    "gripper_lock",     # DS6  / addr 5
    "clear_position",   # DS7  / addr 6
    "belt_forward",     # DS8  / addr 7
    "belt_reverse",     # DS9  / addr 8
    "lamp_servo_power", # DS10 / addr 9
    "lamp_servo_disable",
    "lamp_plate_cycle",
    "lamp_abort_stow",
    "lamp_speed",
    "lamp_gripper_lock",
    "lamp_clear_position",
    "lamp_belt_forward",
    "lamp_belt_reverse",
    "emag_status",      # DS19 / addr 18
    "emag_on",
    "emag_part_detect",
    "emag_malfunction",
    "poe_status",       # DS23 / addr 22
    "estop_enable",     # DS24 / addr 23
    "estop_off",        # DS25 / addr 24
]

_STATE_NAMES = {0: "idle", 1: "running", 2: "fault", 3: "e-stopped"}
_FAULT_NAMES = {0: "none", 1: "vibration", 2: "temperature", 3: "pressure", 4: "estop_triggered"}


def _uint16(v: int) -> int:
    return v & 0xFFFF


def _int16(v: int) -> int:
    v = _uint16(v)
    return v - 65536 if v > 32767 else v


def read_snapshot(client: ModbusTcpClient, unit: int) -> dict:
    """Read all registers and return a dict of named values."""
    result = {}

    # E-Cat block: DS1-DS25 → addresses 0-24
    r = client.read_holding_registers(address=0, count=25, slave=unit)
    if r.isError():
        raise RuntimeError(f"Failed to read E-Cat registers (0-24): {r}")
    for i, name in enumerate(_ECAT_NAMES):
        result[name] = _uint16(r.registers[i])

    # Sensor/state block: DS101-DS118 → addresses 100-117
    r = client.read_holding_registers(address=100, count=18, slave=unit)
    if r.isError():
        raise RuntimeError(f"Failed to read sensor registers (100-117): {r}")
    regs = [_uint16(v) for v in r.registers]

    result.update({
        "vibration_x":              _int16(regs[0]) / 100.0,   # DS101
        "vibration_y":              _int16(regs[1]) / 100.0,   # DS102
        "vibration_z":              _int16(regs[2]) / 100.0,   # DS103
        "gyro_x":                   _int16(regs[3]) / 100.0,
        "gyro_y":                   _int16(regs[4]) / 100.0,
        "gyro_z":                   _int16(regs[5]) / 100.0,
        "temperature_f":            _int16(regs[6]) / 10.0,    # DS107
        "humidity_pct":             _int16(regs[7]) / 10.0,    # DS108
        "pressure_simulated":       regs[8],                    # DS109
        "servo1_position":          regs[9],                    # DS110
        "servo2_position":          regs[10],                   # DS111
        "cycle_count":              regs[11],                   # DS112
        "system_state":             _STATE_NAMES.get(regs[12], f"unknown({regs[12]})"),  # DS113
        "last_fault":               _FAULT_NAMES.get(regs[13], f"unknown({regs[13]})"),  # DS114
        "servo_power_press_count":  regs[14],                   # DS115
        "estop_activation_count":   regs[15],                   # DS116
        "current_uptime_seconds":   regs[16],                   # DS117
        "last_estop_duration_seconds": regs[17],                # DS118
    })

    return result


def print_snapshot(snap: dict, highlight_nonzero: bool = True) -> None:
    """Print the register snapshot in a readable format."""
    # E-Cat block
    print("\n  ── E-Cat registers (DS1-DS25 / Modbus addr 0-24) ──")
    for name in _ECAT_NAMES:
        val = snap[name]
        flag = " ◀" if highlight_nonzero and val != 0 else ""
        print(f"    {name:<28} = {val}{flag}")

    # State / sensor block
    print("\n  ── State registers (DS113+ / Modbus addr 112+) ──")
    for key in [
        "system_state", "last_fault", "servo_power_press_count",
        "estop_activation_count", "current_uptime_seconds", "last_estop_duration_seconds",
    ]:
        val = snap[key]
        is_notable = val not in (0, "idle", "none", "released")
        flag = " ◀" if highlight_nonzero and is_notable else ""
        print(f"    {key:<36} = {val}{flag}")

    # Sensor block (usually all 0 on real PLC)
    print("\n  ── Sensor registers (DS101-DS112, 0 on real PLC) ──")
    for key in [
        "vibration_x", "vibration_y", "vibration_z",
        "gyro_x", "gyro_y", "gyro_z",
        "temperature_f", "humidity_pct", "pressure_simulated",
        "servo1_position", "servo2_position", "cycle_count",
    ]:
        print(f"    {key:<28} = {snap[key]}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Click PLC Modbus TCP connectivity test")
    parser.add_argument("--host", required=True, help="PLC IP address (e.g. 192.168.0.10)")
    parser.add_argument("--port", type=int, default=502, help="Modbus TCP port (default 502)")
    parser.add_argument("--unit", type=int, default=1, help="Modbus unit/slave ID (default 1)")
    parser.add_argument(
        "--watch", action="store_true",
        help="Poll every second and print changes (Ctrl+C to stop)"
    )
    args = parser.parse_args()

    print(f"Connecting to {args.host}:{args.port} (unit_id={args.unit})...")
    client = ModbusTcpClient(args.host, port=args.port, timeout=3)
    if not client.connect():
        print(f"ERROR: Could not connect to {args.host}:{args.port}")
        print("  • Is the PLC powered on?")
        print("  • Is the PLC IP set correctly? (check with Click Programming Software)")
        print("  • Is the Pi on the same subnet? (ping the PLC first)")
        sys.exit(1)

    print("Connected OK")

    try:
        if args.watch:
            print("Watching for changes — press Ctrl+C to stop\n")
            prev = None
            while True:
                snap = read_snapshot(client, args.unit)
                if snap != prev:
                    print(f"\n{'='*50}  {time.strftime('%H:%M:%S')}")
                    print_snapshot(snap)
                    prev = snap
                time.sleep(1.0)
        else:
            snap = read_snapshot(client, args.unit)
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
