#!/usr/bin/env bash
# Step 6: Test that registers 100-113 are readable with a pymodbus client script
set -euo pipefail

PI="${RAIV_PLC_SSH:-andrew@raiv-plc.local}"

echo "=== Step 6: Testing Modbus registers 100-113 ==="

# First, write the test script locally, then scp it
cat > /tmp/test_modbus_registers.py << 'PYEOF'
#!/usr/bin/env python3
"""Test script: read Modbus holding registers 100-113 from the PLC simulator."""

from pymodbus.client import ModbusTcpClient

HOST = "127.0.0.1"
PORT = 5020

REGISTER_NAMES = {
    100: "Accel X      (raw int16, /100 = m/s²)",
    101: "Accel Y      (raw int16, /100 = m/s²)",
    102: "Accel Z      (raw int16, /100 = m/s²)",
    103: "Gyro X       (raw int16, /100 = °/s)",
    104: "Gyro Y       (raw int16, /100 = °/s)",
    105: "Gyro Z       (raw int16, /100 = °/s)",
    106: "Temperature  (raw int16, /10 = °F)",
    107: "Humidity     (raw int16, /10 = %)",
    108: "Pressure     (0-1023)",
    109: "Servo 1 Pos  (0-180°)",
    110: "Servo 2 Pos  (0-180°)",
    111: "Cycle Count",
    112: "System State (0=idle,1=run,2=fault,3=estop)",
    113: "Fault Code   (0=none,1=vib,2=temp,3=pres,4=clamp)",
}


def signed_int16(val):
    """Convert unsigned 16-bit to signed int16."""
    return val - 65536 if val >= 32768 else val


def main():
    client = ModbusTcpClient(HOST, port=PORT)
    connected = client.connect()
    if not connected:
        print(f"FAIL: Could not connect to Modbus server at {HOST}:{PORT}")
        return

    print(f"Connected to Modbus server at {HOST}:{PORT}")
    print("=" * 65)

    # Read registers 100-113 (14 registers)
    result = client.read_holding_registers(address=100, count=14)

    if result.isError():
        print(f"FAIL: Error reading registers: {result}")
        client.close()
        return

    registers = result.registers
    print(f"{'Reg':>4}  {'Raw':>7}  {'Decoded':>10}  Description")
    print("-" * 65)

    all_ok = True
    for i, raw_val in enumerate(registers):
        addr = 100 + i
        name = REGISTER_NAMES.get(addr, "Unknown")

        # Decode based on register type
        if addr <= 105:
            # Accel/Gyro: signed int16, scale /100
            signed = signed_int16(raw_val)
            decoded = f"{signed / 100.0:+.2f}"
        elif addr == 106:
            # Temperature: signed int16, scale /10
            signed = signed_int16(raw_val)
            decoded = f"{signed / 10.0:.1f}°F"
        elif addr == 107:
            # Humidity: scale /10
            decoded = f"{raw_val / 10.0:.1f}%"
        else:
            decoded = str(raw_val)

        print(f"{addr:>4}  {raw_val:>7}  {decoded:>10}  {name}")

        # Basic sanity: register should have been written (at least temperature
        # and humidity should be non-zero if simulated values are active)
        if addr == 106 and raw_val == 0:
            print(f"  ⚠  Register {addr} is 0 — sensor data may not be populating yet")

    print("-" * 65)

    # Also read a few E-Cat registers (0-8) to verify broader register space
    ecat_result = client.read_holding_registers(address=0, count=25)
    if not ecat_result.isError():
        print(f"\nE-Cat registers 0-24: {ecat_result.registers}")
    else:
        print(f"\nE-Cat register read error: {ecat_result}")

    print("\nSUCCESS: All 14 sensor registers (100-113) are readable!")
    client.close()


if __name__ == "__main__":
    main()
PYEOF

echo "Copying test script to Pi..."
scp /tmp/test_modbus_registers.py "$PI":~/test_modbus_registers.py

echo ""
echo "Running register test..."
ssh "$PI" 'bash -s' << 'EOF'
set -euo pipefail

cd ~/Viam-Staubli-Apera-PLC-Mobile-POC/plc-simulator
source venv/bin/activate

# Give the work cycle a moment to populate registers with simulated data
sleep 2

python3 ~/test_modbus_registers.py
EOF

echo ""
echo "=== Register test complete ==="
