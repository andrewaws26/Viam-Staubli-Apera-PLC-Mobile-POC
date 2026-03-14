# Robot Cell Remote Monitoring POC

Remote monitoring proof of concept using [Viam Robotics](https://www.viam.com/) for an industrial robot cell. Demonstrates real-time fault detection and alerting across PLCs, vision systems, and robot controllers.

**One-sentence summary:** Pull a wire and watch the dashboard react.

## Current Status

This system is live on a Raspberry Pi 5 connected to Viam Cloud. The vision-health-sensor module is deployed and returning real readings every 2 seconds. A Next.js dashboard running on the Pi connects to Viam Cloud via the TypeScript SDK and displays live component health with audible alarms on fault detection.

The full pipeline is proven working: hardware sensor on Pi reads target, viam-server pushes data to Viam Cloud, browser-based dashboard pulls readings via WebRTC and renders status in real time.

Three of the four dashboard indicators show "Pending" because their backing hardware (Staubli robot arm, PLC, junction box wiring) has not been connected yet. The system is architecturally ready for them. When those sensor modules are deployed and registered in Viam, the dashboard will pick them up automatically with no code changes.

### Module Status

| Module | Status | What It Does |
|---|---|---|
| `vision-health-sensor` | **Live on Pi** | ICMP ping + TCP port probe against a target host. Currently targeting 8.8.8.8:53 (Google DNS) as a stand-in for the Apera vision server. Returns `connected` and `process_running` booleans. Deployed to `/opt/viam-modules/vision-health-sensor/`. |
| `plc-sensor` | Scaffold | Returns placeholder values. Blocked on PLC brand/model confirmation and Modbus register map from hardware lead. Code structure and Viam registration are complete. |
| `robot-arm-sensor` | Scaffold | Returns placeholder values. Blocked on Staubli CS9 protocol confirmation (Modbus TCP vs VAL3 socket). Code structure and Viam registration are complete. |

### Dashboard Status

| Feature | State |
|---|---|
| Vision System indicator | Green, live readings from Viam Cloud |
| Robot Arm indicator | Yellow, "Pending" (sensor not deployed) |
| PLC / Controller indicator | Yellow, "Pending" |
| Wire / Connection indicator | Yellow, "Pending" (derived from PLC) |
| Fault detection + alarm | Working (audible klaxon, red flash, alert banner) |
| Fault history log | Working (last 10 events, timestamped) |
| Mock mode for demos | Working (toggle via env var) |

## What This System Does

Three custom Viam sensor modules monitor hardware state from a robot cell:

- **PLC Sensor** -- Reads digital I/O states (connection health, fault bits, operator button) from a PLC via Modbus TCP.
- **Robot Arm Sensor** -- Monitors a Staubli CS9 controller for connection state, operating mode, and fault codes.
- **Vision Health Sensor** -- Checks network reachability (ICMP ping) and service availability (TCP port probe) of an Apera AI vision server.

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
├── config/
│   ├── viam-server.json              # Full Viam agent config (all three modules)
│   └── test-vision-only.json         # Minimal config for vision sensor testing
├── dashboard/                         # Next.js monitoring dashboard (live)
│   ├── app/                           # Next.js pages and layout
│   ├── components/                    # React components (Dashboard, StatusCard, etc.)
│   ├── lib/                           # Viam SDK wrapper, sensor configs, types
│   ├── .env.local.example             # Template for credentials
│   └── package.json
├── docs/
│   ├── architecture.md                # Full system architecture document
│   ├── deploy-rpi5.md                 # Raspberry Pi 5 deployment guide
│   ├── build-log.md                   # Chronological build narrative
│   └── interview-prep.md             # Technical interview preparation
├── modules/
│   ├── plc-sensor/                    # Scaffold -- pending hardware details
│   ├── robot-arm-sensor/              # Scaffold -- pending protocol confirmation
│   └── vision-health-sensor/          # Live -- deployed on Pi 5
├── DEMO.md                            # How to run the demo
├── requirements.txt                   # Top-level Python dependencies
└── README.md
```

## Hardware

- **Deployed:** Raspberry Pi 5 (Debian Trixie, aarch64) running viam-server v0.116.0
- **Pending:** PLC with Modbus TCP support, Staubli CS9 robot controller, Dell server running Apera AI Vue
- **Network:** Pi on local network with outbound HTTPS to app.viam.com

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

See [DEMO.md](DEMO.md) for the full walkthrough, or [docs/deploy-rpi5.md](docs/deploy-rpi5.md) for the detailed deployment guide.

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full system architecture, including data flow diagrams, phased build plan, privacy constraints, and the list of hardware assumptions requiring validation.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) -- System architecture, privacy design, hardware assessment
- [`docs/deploy-rpi5.md`](docs/deploy-rpi5.md) -- Step-by-step Pi deployment guide
- [`docs/build-log.md`](docs/build-log.md) -- Narrative of what was built and why
- [`docs/interview-prep.md`](docs/interview-prep.md) -- Technical interview preparation
- [`DEMO.md`](DEMO.md) -- How to run the demo for a non-technical audience
