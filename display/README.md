# LED Matrix Status Display — Matrix Portal S3

Drives a 64x32 RGB LED matrix via an Adafruit Matrix Portal S3, showing real-time subsystem status for the RAIV Digital Twin POC.

## What It Shows

6 colored status blocks, one per subsystem:

| Row | Subsystem | Green | Yellow | Red |
|---|---|---|---|---|
| 1 | GRINDER | Running, low vibration | Fault state | E-stop or high vibration |
| 2 | CLAMP | Running, servo at target | — | Fault or E-stop |
| 3 | TEMP | Below 100°F | 100-120°F | Above 120°F |
| 4 | PRESSURE | Above minimum | — | Below minimum |
| 5 | NETWORK | API reachable | — | API unreachable |
| 6 | POWER | POE system on | POE off (future: UPS) | — |

When a fault is active, the bottom 2 rows scroll a fault description (e.g., "FAULT: VIBRATION" or "E-STOP ACTIVE").

## Setup

1. Flash the Matrix Portal S3 with CircuitPython 9.x
2. Install required libraries via `circup`:
   ```
   circup install adafruit_matrixportal adafruit_display_text adafruit_requests
   ```
3. Edit `config.py` with your WiFi credentials and Pi 5 IP address
4. Copy all files in this directory to the CIRCUITPY drive
5. The display will start automatically

## Hardware

- Adafruit Matrix Portal S3
- 64x32 RGB LED matrix panel (HUB75 connector)
- USB-C power supply (5V 4A recommended for full brightness)

## Data Flow

```
Pi Zero W (PLC simulator)
    ↓ Modbus TCP
Pi 5 (viam-server + status API)
    ↓ HTTP JSON
Matrix Portal S3 (this code)
    ↓ HUB75
64x32 LED Matrix
```

The Matrix Portal polls `http://<pi5-ip>:8080/status` every second.
