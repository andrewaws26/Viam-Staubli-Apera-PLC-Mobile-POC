#!/usr/bin/env python3
"""Watch DD1 and DS10 live to understand reverse behavior.

Run this, then roll the encoder forward and backward.
Prints every 200ms so we can see exactly what happens.

Usage: python3 scripts/test_dd1_reverse.py
"""

import time
import struct
from pymodbus.client import ModbusTcpClient

PLC_HOST = "169.168.10.21"
PLC_PORT = 502

client = ModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=1)
if not client.connect():
    print(f"Cannot connect to PLC at {PLC_HOST}:{PLC_PORT}")
    exit(1)

print(f"Connected to PLC at {PLC_HOST}:{PLC_PORT}")
print(f"{'Time':>8}  {'DD1':>8}  {'DS10':>6}  {'DS3':>5}  {'Note'}")
print("-" * 50)

prev_dd1 = None
prev_ds10 = None

try:
    while True:
        # Read DD1 (address 16384, 2 registers, 32-bit signed)
        enc = client.read_holding_registers(address=16384, count=2)
        if enc.isError():
            print("  DD1 read error")
            time.sleep(0.2)
            continue
        lo = enc.registers[0] & 0xFFFF
        hi = enc.registers[1] & 0xFFFF
        dd1 = (hi << 16) | lo
        if dd1 > 0x7FFFFFFF:
            dd1 -= 0x100000000

        # Read DS registers (DS10 = index 9, DS3 = index 2)
        ds = client.read_holding_registers(address=0, count=11)
        if ds.isError():
            print("  DS read error")
            time.sleep(0.2)
            continue
        ds10 = ds.registers[9]
        ds3 = ds.registers[2]

        # Annotate
        notes = []
        if dd1 < 0:
            notes.append("NEGATIVE")
        if prev_dd1 is not None:
            delta = dd1 - prev_dd1
            if delta != 0:
                notes.append(f"Δdd1={delta:+d}")
        if prev_ds10 is not None and ds10 != prev_ds10:
            notes.append(f"Δds10={ds10 - prev_ds10:+d}")

        ts = time.strftime("%H:%M:%S")
        note_str = "  ".join(notes)
        print(f"{ts:>8}  {dd1:>8}  {ds10:>6}  {ds3:>5}  {note_str}")

        prev_dd1 = dd1
        prev_ds10 = ds10
        time.sleep(0.2)

except KeyboardInterrupt:
    print("\nDone.")
finally:
    client.close()
