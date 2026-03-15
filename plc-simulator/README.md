# PLC Simulator — Pi Zero W

Simulates a Click PLC via Modbus TCP for the RAIV Digital Twin POC. Runs on a Raspberry Pi Zero W with physical sensors and actuators connected via GPIO/I2C.

## What This Does

- Runs a **Modbus TCP server** on port 502, exposing holding registers that mirror the real RAIV truck's 25-pin E-Cat cable pinout
- Reads physical sensors (GY-521 accelerometer/gyro, DHT22 temperature/humidity) and writes values to Modbus registers
- Drives two SG90 micro servos through an automated work cycle (grinder positioning + clamp actuation)
- Monitors an E-stop button on GPIO with immediate halt capability
- Detects faults via configurable thresholds (vibration, temperature, pressure)
- Drives LED status indicators (green=running, yellow=fault, red=e-stopped, blue=client connected)

## Hardware

| Component | Connection | GPIO Pin (BCM) | Notes |
|---|---|---|---|
| Servo 1 (grinder) | PWM | 12 | SG90, sweeps 0-180° |
| Servo 2 (clamp) | PWM | 13 | SG90, open=90° close=0° |
| GY-521 (MPU6050) | I2C | SDA/SCL | Bus 1, addr 0x68 |
| DHT22 | Digital | 4 | Temperature + humidity |
| E-stop button | Input | 17 | NO contact, pull-down resistor |
| Green LED | Output | 22 | System RUNNING |
| Yellow LED | Output | 23 | System FAULT |
| Red LED | Output | 24 | System E-STOPPED |
| Blue LED | Output | 25 | Modbus client connected |
| Potentiometer | N/A | N/A | See ADC note below |

**ADC Note:** The Pi Zero W has no built-in analog-to-digital converter. The potentiometer value is simulated in software by default (configurable in `config.yaml`). For real analog reads, connect an MCP3008 via SPI and set `adc.enabled: true` in config. On the real RAIV truck, the Click PLC has built-in analog inputs (C0-02DD1-D).

## Setup on Pi Zero W

```bash
# Clone the repo (or copy the plc-simulator directory)
cd /home/pi
git clone https://github.com/andrewaws26/Viam-Staubli-Apera-PLC-Mobile-POC.git
cd Viam-Staubli-Apera-PLC-Mobile-POC/plc-simulator

# Create virtual environment and install dependencies
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Edit config.yaml to match your wiring and thresholds
nano config.yaml

# Run manually for testing
sudo python -m src.main

# Or install as a systemd service for auto-start on boot
sudo cp systemd/plc-simulator.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable plc-simulator
sudo systemctl start plc-simulator

# Check logs
sudo journalctl -u plc-simulator -f
```

## Testing Without Hardware

The simulator runs fine on any machine (Mac, Linux, etc.) without GPIO hardware. It detects missing hardware libraries and falls back to simulated sensor values. This is useful for testing the Modbus register interface:

```bash
# On any machine
pip install pymodbus pyyaml
python -m src.main

# From another terminal, test with a Modbus client
pip install pymodbus
python -c "
from pymodbus.client import ModbusTcpClient
client = ModbusTcpClient('localhost', port=502)
client.connect()
result = client.read_holding_registers(100, 14)
print('Registers 100-113:', result.registers)
client.close()
"
```

## Modbus Register Map

### Registers 0-24: E-Cat Cable Signals (25-pin connector)

| Register | Pin | Signal | Direction |
|---|---|---|---|
| 0 | 1 | Servo Power ON | Command (write) |
| 1 | 2 | Servo Disable/OFF | Command (write) |
| 2 | 3 | Start/Plate Cycle | Command (write) |
| 3 | 4 | Abort/Stow | Command (write) |
| 4 | 5 | Speed | Command (write) |
| 5 | 6 | Gripper Lock | Command (write) |
| 6 | 7 | Clear Position | Command (write) |
| 7 | 8 | Belt Forward | Command (write) |
| 8 | 9 | Belt Reverse | Command (write) |
| 9 | 10 | Servo Power ON Lamp | Status (read) |
| 10 | 11 | Servo Disable Lamp | Status (read) |
| 11 | 12 | Start/Plate Cycle Lamp | Status (read) |
| 12 | 13 | Abort/Stow Lamp | Status (read) |
| 13 | 14 | Speed Lamp | Status (read) |
| 14 | 15 | Gripper Lock Lamp | Status (read) |
| 15 | 16 | Clear Position Lamp | Status (read) |
| 16 | 17 | Belt Forward Lamp | Status (read) |
| 17 | 18 | Belt Reverse Lamp | Status (read) |
| 18 | 19 | E-Mag Status / OFF | System state |
| 19 | 20 | Mag ON | System state |
| 20 | 21 | Mag Part Detection | System state |
| 21 | 22 | E-Mag Malfunction | System state |
| 22 | 23 | POE (system) | System state |
| 23 | 24 | E-stop Enable | System state |
| 24 | 25 | E-stop OFF | System state |

### Registers 100-113: Sensor Data

| Register | Value | Scale | Unit |
|---|---|---|---|
| 100 | Accel X | ÷100 | m/s² |
| 101 | Accel Y | ÷100 | m/s² |
| 102 | Accel Z | ÷100 | m/s² |
| 103 | Gyro X | ÷100 | °/s |
| 104 | Gyro Y | ÷100 | °/s |
| 105 | Gyro Z | ÷100 | °/s |
| 106 | Temperature | ÷10 | °F |
| 107 | Humidity | ÷10 | % |
| 108 | Pressure (simulated) | raw | 0-1023 |
| 109 | Servo 1 position | raw | degrees |
| 110 | Servo 2 position | raw | degrees |
| 111 | Cycle count | raw | count |
| 112 | System state | raw | 0=idle, 1=running, 2=fault, 3=e-stopped |
| 113 | Last fault code | raw | 0=none, 1=vibration, 2=temp, 3=pressure, 4=clamp |

## Configuration

All configurable values are in `config.yaml`:
- GPIO pin assignments (change to match your wiring)
- Fault thresholds (vibration, temperature, pressure)
- Work cycle timing (sweep speed, hold time)
- Modbus server address/port
- Sensor polling rates
- Simulated ADC value for potentiometer
