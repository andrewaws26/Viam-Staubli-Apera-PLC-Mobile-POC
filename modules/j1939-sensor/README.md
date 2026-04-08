# IronSight J1939 Truck Sensor

Viam sensor module for reading J1939 CAN bus data from heavy-duty trucks via OBD-II.

Runs on the **Raspberry Pi 5** with a **Waveshare Isolated RS485 CAN HAT (B)**, targeting 2013+ Mack/Volvo trucks. Designed for resilience in harsh truck environments — handles vibration, power loss, and intermittent CAN bus connectivity. Previously ran on a separate Pi Zero 2 W; consolidated to the Pi 5 in April 2026.

## Supported Parameters

### Engine (PGN 61444, 61443)
| Parameter | Key | Unit | Description |
|-----------|-----|------|-------------|
| Engine RPM | `engine_rpm` | rpm | Current engine speed |
| Driver Demand Torque | `driver_demand_torque_pct` | % | Requested torque |
| Actual Engine Torque | `actual_engine_torque_pct` | % | Delivered torque |
| Accelerator Pedal | `accel_pedal_pos_pct` | % | Pedal position |
| Engine Load | `engine_load_pct` | % | Load at current speed |

### Temperatures (PGN 65262)
| Parameter | Key | Unit |
|-----------|-----|------|
| Coolant Temperature | `coolant_temp_c` | C |
| Fuel Temperature | `fuel_temp_c` | C |
| Engine Oil Temperature | `oil_temp_c` | C |

### Pressures (PGN 65263)
| Parameter | Key | Unit |
|-----------|-----|------|
| Engine Oil Pressure | `oil_pressure_kpa` | kPa |
| Fuel Delivery Pressure | `fuel_pressure_kpa` | kPa |
| Oil Level | `oil_level_pct` | % |

### Vehicle (PGN 65265, 65266, 65269, 65276)
| Parameter | Key | Unit |
|-----------|-----|------|
| Vehicle Speed | `vehicle_speed_kmh` | km/h |
| Fuel Rate | `fuel_rate_lph` | L/h |
| Fuel Economy | `fuel_economy_km_l` | km/L |
| Fuel Level | `fuel_level_pct` | % |
| Ambient Temperature | `ambient_temp_c` | C |
| Barometric Pressure | `barometric_pressure_kpa` | kPa |

### Electrical (PGN 65271)
| Parameter | Key | Unit |
|-----------|-----|------|
| Battery Voltage | `battery_voltage_v` | V |

### Drivetrain (PGN 61445, 65270, 65272)
| Parameter | Key | Unit |
|-----------|-----|------|
| Current Gear | `current_gear` | — |
| Selected Gear | `selected_gear` | — |
| Boost Pressure | `boost_pressure_kpa` | kPa |
| Intake Manifold Temp | `intake_manifold_temp_c` | C |
| Transmission Oil Temp | `trans_oil_temp_c` | C |

### Engine Totals (PGN 65253, 65257)
| Parameter | Key | Unit |
|-----------|-----|------|
| Total Engine Hours | `engine_hours` | hr |
| Total Fuel Used | `total_fuel_used_l` | L |

### Diagnostics (PGN 65226 — DM1)
| Parameter | Key | Description |
|-----------|-----|-------------|
| Active DTC Count | `active_dtc_count` | Number of active trouble codes |
| DTC details | `dtc_N_spn`, `dtc_N_fmi`, `dtc_N_occurrence` | First 5 DTCs |
| Lamp Status | `malfunction_lamp`, `red_stop_lamp`, `amber_warning_lamp`, `protect_lamp` | Dashboard lamp states |

## Installation

The module is deployed as a local module on the Raspberry Pi.

```bash
cd /home/andrew/j1939-truck-sensor
./setup.sh
```

This creates a Python virtual environment and installs dependencies.

## Viam Configuration

### 1. Add the module

In the Viam app, go to your machine's **CONFIGURE** tab and add a local module:

- **Name**: `j1939-truck-sensor`
- **Executable path**: `/home/andrew/j1939-truck-sensor/exec.sh`

### 2. Add the sensor component

Add a new component:

- **Type**: `sensor`
- **Model**: `ironsight:j1939-truck-sensor:can-sensor`
- **Name**: `truck-engine` (or whatever you prefer)

### 3. Configure attributes

```json
{
    "can_interface": "can0",
    "bitrate": 500000,
    "source_address": 254,
    "include_raw": false,
    "pgn_filter": []
}
```

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `can_interface` | string | `"can0"` | CAN network interface |
| `bitrate` | int | `500000` | CAN bus bitrate (250000, 500000, 1000000) |
| `source_address` | int | `254` | J1939 source address for outgoing messages |
| `include_raw` | bool | `false` | Include raw hex data for each PGN |
| `pgn_filter` | list[int] | `[]` (all) | Only capture these PGNs. Empty = all supported |
| `bus_type` | string | `"socketcan"` | python-can interface type |

### 4. Enable data capture

Add the **Data Management** service, then on your sensor component enable data capture:

- **Method**: `Readings`
- **Frequency**: `1` Hz (adjust based on needs; 1-10 Hz typical)

Data will sync to Viam cloud automatically.

## Custom Commands (do_command)

### Clear Dashboard DTCs
```json
{"command": "clear_dtcs"}
```
Sends a J1939 DM11 message to clear all active diagnostic trouble codes. Use this after confirming a repair to clear the dash lights.

### Request Specific PGN
```json
{"command": "request_pgn", "pgn": 65262}
```
Sends a PGN request to the ECU. Useful for PGNs that aren't broadcast regularly.

### Get Supported PGNs
```json
{"command": "get_supported_pgns"}
```
Returns the full list of PGN numbers and names this module can decode.

### Get Bus Statistics
```json
{"command": "get_bus_stats"}
```
Returns CAN bus connection info, frame count, uptime, and configuration.

### Send Raw CAN Frame
```json
{"command": "send_raw", "can_id": 418119678, "data": "FFFFFFFFFFFFFFFF"}
```
Send an arbitrary CAN frame. Use with caution.

## Running Tests

```bash
cd /home/andrew/j1939-truck-sensor
pip install pytest pytest-asyncio
pytest tests/ -v
```

## Hardware Setup

### Wiring (Waveshare RS485 CAN HAT B to OBD-II)

| HAT Pin | OBD-II Pin | Signal |
|---------|-----------|--------|
| CAN_H | Pin 6 | CAN High |
| CAN_L | Pin 14 | CAN Low |
| GND | Pin 5 | Signal Ground |

**Important**: The Waveshare HAT (B) has galvanic isolation — the CAN side is electrically isolated from the Pi. This protects against ground loops and voltage spikes from the truck's electrical system.

### J1939 on OBD-II

The standard J1939 bitrate on the OBD-II diagnostic port for 2013+ trucks is **500 kbps**. Some older trucks may use 250 kbps — adjust the `bitrate` config if needed.

### Verifying CAN Bus

```bash
# Check interface is up
ip link show can0

# Listen for any CAN traffic
candump can0

# Decode J1939 PGNs
candump can0 | head -20
```

## Resilience

This module is designed for truck deployment where conditions are harsh:

- **Power loss**: The module uses no persistent local state. On restart, viam-server relaunches the module automatically and it reconnects to the CAN bus. No data corruption possible.
- **CAN bus disconnect**: The listener thread handles bus errors gracefully and continues attempting to read. Readings return the last known values plus metadata showing time since last frame.
- **Vibration/intermittent connections**: The CAN bus listener uses a 1-second recv timeout — brief interruptions are transparent. The systemd service restarts the CAN interface if it drops.
- **SD card protection**: Use `overlayroot` to make the rootfs read-only, preventing filesystem corruption from unexpected power loss.

## Architecture

```
j1939-truck-sensor/
├── src/
│   ├── main.py              # Viam module entry point
│   └── models/
│       ├── pgn_decoder.py   # J1939 PGN definitions and byte-level decoding
│       └── j1939_sensor.py  # Viam Sensor component with CAN listener
├── tests/
│   ├── test_pgn_decoder.py  # PGN decoding tests with known byte patterns
│   └── test_j1939_sensor.py # Sensor component tests with mock CAN bus
├── meta.json                # Viam module metadata
├── exec.sh                  # Module entry point (called by viam-server)
├── setup.sh                 # Virtual environment setup
├── requirements.txt         # Python dependencies
└── .env                     # Environment variables
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `can0 not found` | SPI not enabled or overlay not loaded | Check `/boot/firmware/config.txt` for `dtparam=spi=on` and the mcp2515 overlay |
| No data from `candump` | Wrong bitrate or wiring | Try 250000 bitrate; verify CAN_H/CAN_L wiring |
| `_seconds_since_last_frame` increasing | CAN bus disconnected or truck off | Check physical connection; truck ignition must be on |
| `PermissionDenied` on CAN | Need root or `dialout` group | Run viam-server as root or add user to `dialout` group |
| Module won't start | Missing dependencies | Run `./setup.sh` manually and check for errors |
