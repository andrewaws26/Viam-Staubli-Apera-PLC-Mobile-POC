# Robot Cell Remote Monitoring POC

Remote monitoring proof of concept using [Viam Robotics](https://www.viam.com/) for an industrial robot cell. Demonstrates real-time fault detection and alerting across PLCs, vision systems, and robot controllers.

**One-sentence summary:** Unplug the Pi and watch the dashboard react.

## Current Status

This system is live. A Raspberry Pi 5 runs viam-server as a systemd service, connected to Viam Cloud at `staubli-pi-main.djgpitarpm.viam.cloud`. The vision-health-sensor module is deployed and returns real readings every 2 seconds. A Next.js dashboard is deployed to Vercel and accessible from any browser with an internet connection. The dashboard connects to Viam Cloud via the TypeScript SDK over WebRTC and displays live component health with audible alarms on fault detection.

A Pi Zero W runs the PLC simulator — a standalone Modbus TCP server that mirrors the real RAIV truck's Click PLC register map (25-pin E-Cat cable). It reads physical sensors (GY-521 accelerometer, DHT22 temperature/humidity) and drives servos through an automated work cycle with fault detection. The plc-sensor Viam module on the Pi 5 connects to the Pi Zero W via Modbus TCP and reads all registers, surfacing them on the dashboard as live sensor data.

### Module Status

| Module | Viam Component | Status | What It Does |
|---|---|---|---|
| `vision-health-sensor` | `vision-health` | **Working** | ICMP ping + TCP port probe against a target host. Currently targeting 8.8.8.8:53 (Google DNS) as a stand-in for the Apera vision server. Returns `connected` and `process_running` booleans. Deployed to `/opt/viam-modules/vision-health-sensor/`. Data capture configured, readings sync to Viam Cloud. |
| `plc-sensor` | `plc-monitor` | **Working** | Reads PLC state via Modbus TCP from the Pi Zero W PLC simulator. Returns 25-pin E-Cat cable signals, vibration, temperature, humidity, pressure, servo positions, cycle count, system state, and fault codes. Data capture at 1 Hz. Deployed and returning real Modbus data. |
| `robot-arm-sensor` | `robot-arm-monitor` | Pending hardware | Returns placeholder values. Blocked on Staubli CS9 protocol confirmation (Modbus TCP vs VAL3 socket). Code structure and Viam registration are complete. |

### Dashboard Status

| Feature | State |
|---|---|
| Vision System indicator | Green OK, live readings from Viam Cloud |
| PLC / Controller indicator | Green OK, live Modbus data from Pi Zero W |
| Wire / Connection indicator | Green OK, derived from PLC readings |
| Robot Arm indicator | Yellow "Pending" (hardware not available) |
| PLC Sensor Data panel | Live — vibration, temperature, humidity, servo positions, cycle count, system state |
| Fault detection + alarm | Working (audible klaxon, red flash, alert banner) |
| Fault history log | Working (last 10 events, timestamped) |
| Mock mode for demos | Working (toggle via env var) |
| Vercel deployment | Live, accessible from any browser |

## What This System Does

Three custom Viam sensor modules monitor hardware state from a robot cell:

- **PLC Sensor** -- Reads the full Modbus register map from the PLC (25-pin E-Cat cable signals + sensor data) via Modbus TCP.
- **Robot Arm Sensor** -- Monitors a Staubli CS9 controller for connection state, operating mode, and fault codes.
- **Vision Health Sensor** -- Checks network reachability (ICMP ping) and service availability (TCP port probe) of an Apera AI vision server.

Additionally:
- **PLC Simulator** -- Runs on a Pi Zero W, simulating the Click PLC with real sensors and actuators. Exposes the same Modbus register map as the real truck.
- **Status API** -- Flask HTTP server on the Pi 5, exposing PLC state as JSON for the LED matrix display and touchscreen.
- **LED Matrix Display** -- CircuitPython code for the Matrix Portal S3, rendering 6 subsystem status blocks on a 64x32 RGB LED panel.

Sensor readings flow through viam-server to Viam Cloud, where a browser-based dashboard displays live status and triggers alerts on faults.

## What This System Does NOT Collect

This system is scoped strictly to machine and component state. By design, it does **not** collect:

- Camera feeds or images from the work area
- Operator identity, badge scans, or login information
- Cycle time, throughput, or production counts per operator or shift
- Audio from the work area
- Any data that could be used to track, identify, or evaluate personnel

Each sensor module has a fixed return schema defined in its `get_readings()` method. Expanding the data collected requires writing new module code, reviewing it, building it, and deploying it. This is not a configuration change. See `docs/architecture.md` section 6 for the full privacy architecture.

## Project Structure

```
.
├── api/                                  # Status API (Flask, runs on Pi 5)
│   ├── src/status_api.py                 # HTTP endpoints: /status, /health
│   ├── systemd/status-api.service        # systemd unit file
│   └── requirements.txt
├── config/
│   ├── viam-server.json                  # Full Viam agent config
│   └── test-vision-only.json             # Minimal config for vision sensor testing
├── dashboard/                            # Next.js monitoring dashboard (deployed to Vercel)
│   ├── app/                              # Next.js pages and layout
│   ├── components/                       # React components (Dashboard, StatusCard, PlcDetailPanel)
│   ├── lib/                              # Viam SDK wrapper, sensor configs, types
│   ├── .env.local.example                # Template for credentials
│   └── package.json
├── display/                              # Matrix Portal S3 LED display (CircuitPython)
│   ├── code.py                           # Main entry point
│   ├── config.py                         # WiFi, API endpoint, thresholds
│   └── status_renderer.py               # Status block rendering + scrolling text
├── docs/
│   ├── architecture.md                   # Full system architecture document
│   ├── deploy-rpi5.md                    # Raspberry Pi 5 deployment guide
│   ├── build-log.md                      # Chronological build narrative
│   └── technical-overview.md             # Technical overview and design rationale
├── modules/
│   ├── plc-sensor/                       # Modbus TCP reader — connects to PLC simulator
│   ├── robot-arm-sensor/                 # Scaffold — pending protocol confirmation
│   └── vision-health-sensor/             # Live — deployed on Pi 5
├── pi-zero-setup/                        # Automated setup scripts for Pi Zero W
│   ├── 01-install-packages.sh            # System packages and Python deps
│   ├── 02-clone-and-setup.sh             # Clone repo and create venv
│   ├── 03-configure-and-run.sh           # Configure and start simulator
│   ├── 04-test-registers.sh              # Verify Modbus registers via pymodbus
│   └── run-all.sh                        # Run all setup scripts in sequence
├── plc-simulator/                        # Pi Zero W PLC simulator
│   ├── src/                              # Modbus server, sensors, actuators, work cycle
│   ├── tests/                            # Unit tests (fault detection, register map)
│   ├── config.yaml                       # GPIO pins, thresholds, polling rates
│   ├── systemd/plc-simulator.service     # systemd unit file for boot startup
│   └── requirements.txt
├── DEMO.md                               # How to run the demo
├── requirements.txt                      # Top-level Python dependencies
└── README.md
```

## Hardware

- **Pi 5:** Raspberry Pi 5 (Raspberry Pi OS Lite 64-bit, aarch64) running viam-server v0.116.0 as a systemd service. Also runs the Status API (Flask).
- **Pi Zero W:** Runs the PLC simulator — Modbus TCP server with GY-521, DHT22, servos, E-stop button, LEDs.
- **Matrix Portal S3:** Adafruit Matrix Portal S3 driving a 64x32 RGB LED matrix for at-a-glance status.
- **Pending:** Staubli CS9 robot controller, Dell server running Apera AI Vue
- **Network:** Both Pis on the same WiFi network. Pi 5 has outbound HTTPS to app.viam.com.

## Quick Start

### Run with mock data (no hardware needed)

```bash
cd dashboard
cp .env.local.example .env.local
# .env.local already has NEXT_PUBLIC_MOCK_MODE=true
npm install
npm run dev
```

Open http://localhost:3000. Faults fire randomly every 15-20 seconds. Use the Demo Controls buttons to trigger faults manually.

### Run with live Viam data

The dashboard is deployed to Vercel. Open the Vercel URL in any browser. No local setup needed.

For local development against live data, see [DEMO.md](DEMO.md) for the full walkthrough, or [docs/deploy-rpi5.md](docs/deploy-rpi5.md) for the detailed deployment guide.

### Run the PLC simulator (Pi Zero W)

The PLC simulator runs on a Pi Zero W at `raiv-plc.local` (192.168.1.74), exposing Modbus TCP on port 502. It starts automatically on boot via systemd.

**First-time setup** (from a fresh Pi Zero W):

```bash
# Copy setup scripts to the Pi
scp -r pi-zero-setup/ pi@raiv-plc.local:~/

# SSH in and run
ssh pi@raiv-plc.local
chmod +x ~/pi-zero-setup/*.sh
~/pi-zero-setup/run-all.sh
```

This installs packages, clones the repo, creates a venv, installs the systemd service, and starts the simulator. See [`plc-simulator/README.md`](plc-simulator/README.md) for the full register map and manual operation.

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full system architecture, including data flow diagrams, phased build plan, privacy constraints, and the list of hardware assumptions requiring validation.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) -- System architecture, privacy design, hardware assessment
- [`docs/deploy-rpi5.md`](docs/deploy-rpi5.md) -- Step-by-step Pi deployment guide
- [`docs/build-log.md`](docs/build-log.md) -- Narrative of what was built and why
- [`docs/technical-overview.md`](docs/technical-overview.md) -- Technical overview and design rationale
- [`plc-simulator/README.md`](plc-simulator/README.md) -- PLC simulator setup and register map
- [`api/README.md`](api/README.md) -- Status API setup
- [`display/README.md`](display/README.md) -- LED matrix display setup
- [`DEMO.md`](DEMO.md) -- How to run the demo
