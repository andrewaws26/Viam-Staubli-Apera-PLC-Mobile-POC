# Robot Cell Remote Monitoring POC

Remote monitoring proof of concept using [Viam Robotics](https://www.viam.com/) for an industrial robot cell. Demonstrates real-time fault detection and alerting across PLCs, vision systems, and robot controllers.

**One-sentence summary:** Pull a wire and watch the dashboard react.

## What This System Does

Three custom Viam sensor modules monitor hardware state from a robot cell:

- **PLC Sensor** — Reads digital I/O states (connection health, fault bits, operator button) from a PLC via Modbus TCP.
- **Robot Arm Sensor** — Monitors a Stäubli CS9 controller for connection state, operating mode, and fault codes.
- **Vision Health Sensor** — Checks network reachability (ICMP ping) and service availability (TCP port probe) of an Apera AI vision server.

Sensor readings flow through Viam's data management service to Viam Cloud, where a remote dashboard displays live status and triggers alerts on faults.

## What This System Does NOT Collect

This system is scoped strictly to machine and component state. By design, it does **not** collect:

- Camera feeds or images from the work area
- Operator identity, badge scans, or login information
- Cycle time, throughput, or production counts per operator or shift
- Audio from the work area
- Any data that could be used to track, identify, or evaluate personnel

Each sensor module has a fixed return schema defined in its `get_readings()` method. Expanding the data collected requires writing new module code, reviewing it, building it, and deploying it — not a configuration change. See `docs/architecture.md` section 6 for the full privacy architecture.

## Project Structure

```
.
├── config/
│   └── viam-server.json          # Viam agent configuration (all three modules)
├── dashboard/                     # Monitoring dashboard (placeholder, Phase 1)
├── docs/
│   └── architecture.md           # Full system architecture document
├── modules/
│   ├── plc-sensor/               # Phase 1 priority — PLC Modbus integration
│   │   ├── meta.json
│   │   ├── requirements.txt
│   │   ├── setup.sh
│   │   └── src/
│   │       └── plc_sensor.py
│   ├── robot-arm-sensor/         # Scaffold only — pending hardware details
│   │   ├── meta.json
│   │   ├── requirements.txt
│   │   ├── setup.sh
│   │   └── src/
│   │       └── robot_arm_sensor.py
│   └── vision-health-sensor/     # Functional — ICMP ping + TCP port check
│       ├── meta.json
│       ├── requirements.txt
│       ├── setup.sh
│       └── src/
│           └── vision_health_sensor.py
├── requirements.txt              # Top-level Python dependencies
└── README.md
```

## Hardware Prerequisites

- **Viam agent host:** Raspberry Pi 5 running Raspberry Pi OS (or any Linux SBC/PC on the cell network)
- **PLC:** Any model supporting Modbus TCP (brand/model TBD — confirm register map with hardware lead)
- **Robot arm:** Stäubli CS9 controller with Modbus TCP enabled or VAL3 socket server deployed
- **Vision server:** Dell server running Apera AI Vue with a known IP address and listening TCP port
- **Network:** All devices on the same subnet or routable to each other; Viam agent needs outbound HTTPS to `app.viam.com`

## Setup

### 1. Install viam-server on the Raspberry Pi

Follow the [Viam installation guide](https://docs.viam.com/operate/get-started/) for Raspberry Pi OS.

### 2. Clone this repository

```bash
git clone <repo-url>
cd Viam-Staubli-Apera-PLC-Mobile-POC
```

### 3. Install Python dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 4. Configure the Viam agent

1. Create a machine in the [Viam app](https://app.viam.com/).
2. Copy the machine's cloud credentials (`id` and `secret`) into `config/viam-server.json`.
3. Update the IP addresses in the component attributes to match your cell network.
4. Copy modules to the Viam agent host (paths in config default to `/opt/viam-modules/`).

### 5. Run

```bash
viam-server -config config/viam-server.json
```

Sensor readings will appear in the Viam app under the machine's **Control** tab. The dashboard (Phase 1 deliverable) will provide a dedicated monitoring view.

## Module Status

| Module | Status | Notes |
|---|---|---|
| `plc-sensor` | Placeholder values | Replace with real Modbus reads after PLC register map is confirmed |
| `robot-arm-sensor` | Scaffold only | Blocked on hardware protocol confirmation (see architecture doc section 8) |
| `vision-health-sensor` | Functional | Works against any IP:port — no Apera-specific integration needed yet |

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full system architecture, including data flow diagrams, phased build plan, privacy constraints, and the list of hardware assumptions requiring validation.
