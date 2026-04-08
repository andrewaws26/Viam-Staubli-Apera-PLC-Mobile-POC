# IronSight — Fleet Monitoring for TPS Railroad Trucks

Production monitoring system for Tie Plate Systems (TPS) deployed on 30+ railroad trucks. Each truck has a single **Raspberry Pi 5** running three sensor modules: PLC registers via Modbus TCP, J1939 CAN bus truck diagnostics (via CAN HAT), and robot cell monitoring. Data syncs to Viam Cloud at 1 Hz, and a Next.js dashboard on Vercel provides live status, AI-powered diagnostics, shift reports, and fleet overview.

**Designed for fleet deployment** — plug in, power on, starts observing. Self-healing connections, offline buffering, zero manual configuration per truck.

## What It Monitors

### TPS Production (PLC Sensor — Pi 5)

All data from a Click PLC C0-10DD2E-D via Modbus TCP:

| Signal Type | Details |
|---|---|
| **Encoder** (SICK DBS60E) | Pulse count, distance (ft), speed (ft/min), direction, revolutions |
| **Discrete Inputs** (X1-X8) | TPS power loop, camera signal, Air Eagle feedback |
| **Output Coils** (Y1-Y3) | Eject TPS-1, Eject Left/Right TPS-2 |
| **DS Registers** (DS1-DS25) | Tie spacing, plate count, detector offset, HMI control |
| **Diagnostics** | 19-rule engine across 5 categories (camera, encoder, eject, PLC, operation) |

### Truck Diagnostics (J1939 Sensor — Pi 5 CAN HAT)

Passive CAN bus monitoring of heavy-duty trucks (2013+ Mack/Volvo):

| Signal Type | Details |
|---|---|
| **Engine** | RPM, coolant temp (°F), oil pressure (PSI), fuel rate (gal/hr) |
| **Vehicle** | Speed (mph), odometer (mi), battery voltage |
| **Transmission** | Gear, oil temp (°F), oil pressure (PSI) |
| **DTCs** | Per-ECU fault codes (engine, trans, ABS, body, ACM, instrument) |
| **Lamps** | MIL, amber warning, red stop, protect — per ECU source |
| **Aftertreatment** | DPF pressure, DEF level, SCR catalyst temp |

15 PGNs decoded. All readings in US imperial units.

### OBD-II Support (Future — Separate Device)

33 PIDs, DTC read/clear, freeze frame, readiness monitors, VIN. Code is in-repo and validated (6.6M CAN frames, zero drops on 2013 Nissan Altima) but will deploy on a dedicated OBD-II device, not the Pi Zero.

## Architecture

```
Click PLC ──Modbus TCP──▶ Pi 5 ──Viam Cloud──▶ Vercel Dashboard
                           │                         │
CAN Bus (J1939) ──CAN HAT─┤                         ├─ Live monitoring
                           ├─ plc-sensor (1 Hz)       ├─ AI diagnostics (Claude)
                           ├─ j1939-sensor (1 Hz)     ├─ Shift reports
                           ├─ cell-sensor (0.5 Hz)    ├─ Fleet overview
                           ├─ offline buffer (JSONL)  └─ PWA (iOS/Android)
                           ├─ touch display (pygame)
                           └─ health-check (:8081)
```

## Project Structure

```
├── modules/
│   ├── plc-sensor/                    # TPS PLC monitoring via Modbus TCP
│   │   ├── src/
│   │   │   ├── plc_sensor.py          # Main Viam Sensor class
│   │   │   ├── plc_utils.py           # Helpers: serialise, uint16, chat queue
│   │   │   ├── plc_offline.py         # OfflineBuffer JSONL persistence
│   │   │   ├── plc_metrics.py         # ConnectionQualityMonitor + SignalMetrics
│   │   │   ├── plc_weather.py         # Location weather cache
│   │   │   ├── diagnostics.py         # 19-rule diagnostic engine
│   │   │   └── system_health.py       # Pi health metrics
│   │   └── tests/                     # 149 tests passing
│   │
│   └── j1939-sensor/                  # J1939 CAN bus truck diagnostics
│       ├── src/models/
│       │   ├── j1939_sensor.py        # Main sensor (orchestrator)
│       │   ├── pgn_decoder.py         # PGN decode registry (15 PGNs)
│       │   ├── pgn_utils.py           # Byte extraction, CAN ID parsing
│       │   ├── pgn_dm1.py             # DM1/DM2 DTC + lamp decoding
│       │   ├── obd2_poller.py         # OBD-II orchestrator
│       │   ├── obd2_pids.py           # 40 PID definitions + decode lambdas
│       │   ├── obd2_dtc.py            # DTC read/clear Mode 03/04
│       │   ├── obd2_diagnostics.py    # Freeze frame, readiness, VIN
│       │   └── vehicle_profiles.py    # Vehicle profile data
│       └── tests/                     # 148 tests passing
│
├── dashboard/                         # Next.js 14 on Vercel
│   ├── app/
│   │   ├── page.tsx                   # Landing page
│   │   ├── dev/page.tsx               # Dev mode diagnostics
│   │   ├── fleet/page.tsx             # Fleet overview with truck cards
│   │   ├── shift-report/             # Shift reports with time presets
│   │   ├── sign-in/                  # Auth placeholder (Clerk)
│   │   └── api/
│   │       ├── sensor-readings/      # Live PLC data proxy
│   │       ├── truck-readings/       # Live J1939 data proxy
│   │       ├── sensor-history/       # Historical data (Viam Data API)
│   │       ├── shift-report/         # Shift report aggregation
│   │       ├── fleet/status/         # Fleet status (Promise.allSettled)
│   │       ├── ai-chat/             # Claude AI mechanic chat
│   │       ├── ai-diagnose/         # Claude AI one-shot diagnosis
│   │       ├── plc-command/         # PLC do_command proxy
│   │       ├── truck-command/       # J1939 do_command proxy
│   │       └── pi-health/           # Pi system health proxy
│   │
│   ├── components/
│   │   ├── TruckPanel.tsx            # Truck monitoring orchestrator
│   │   ├── GaugeGrid.tsx             # Gauge field definitions + rendering
│   │   ├── DTCPanel.tsx              # DTC display + clearing
│   │   ├── AIChatPanel.tsx           # AI chat + diagnosis UI
│   │   ├── Dashboard.tsx             # TPS dashboard orchestrator
│   │   ├── DashboardAudio.tsx        # Alarm hook + flash overlay
│   │   ├── TPS/                      # TPS sub-components (5 modules)
│   │   └── DevTruck/                 # Dev truck sub-components (3 modules)
│   │
│   ├── hooks/useSensorPolling.ts     # Polling, sim mode, fault detection
│   ├── lib/
│   │   ├── sensor-types.ts           # TypeScript interfaces (100+ fields each)
│   │   ├── machines.ts               # Fleet truck registry (FLEET_TRUCKS env)
│   │   ├── auth.ts                   # RBAC role definitions + route permissions
│   │   └── truck-data.ts             # Truck data utilities
│   ├── public/
│   │   ├── manifest.json             # PWA manifest
│   │   └── sw.js                     # Service worker (cache-first + SWR)
│   ├── middleware.ts                  # No-op until Clerk installed
│   └── tests/                        # 18 Playwright E2E tests
│
├── scripts/
│   ├── ironsight-touch.py            # Touch display launcher → touch_ui/
│   ├── ironsight-discover.py         # Discovery launcher → discovery/
│   ├── ironsight-server.py           # AI analysis HTTP server
│   ├── ironsight-display.py          # Headless Pi display
│   ├── ironsight-analyze.py          # PLC analysis CLI
│   ├── ironsight-discovery-daemon.py # Discovery daemon
│   ├── plc-autodiscover.py           # Auto-discovery
│   ├── touch_ui/                     # Touch display package (8 screens)
│   ├── discovery/                    # Network/PLC discovery package
│   └── lib/                          # Shared utilities (6 modules)
│
├── config/                           # Viam server and fragment configs
├── docs/                             # Documentation
├── CLAUDE.md                         # AI agent instructions
└── AGENTS.md                         # Agent development guide
```

## Quick Start

### Dashboard — Mock mode (no hardware)

```bash
cd dashboard
cp .env.local.example .env.local
# .env.local already has NEXT_PUBLIC_MOCK_MODE=true
npm install && npm run dev
```

Open http://localhost:3000 for TPS monitoring, http://localhost:3000/fleet for fleet overview.

### Dashboard — Live mode

1. **Deploy the Pi** — follow [docs/deploy-rpi5.md](docs/deploy-rpi5.md)
2. **Set Vercel env vars:**
   - `VIAM_API_KEY` / `VIAM_API_KEY_ID` — Organization API key (reads all machines)
   - `VIAM_MACHINE_ADDRESS` / `VIAM_PART_ID` — Pi 5 machine (all components)
   - `ANTHROPIC_API_KEY` — For AI diagnostics
   - `FLEET_TRUCKS` — JSON array of truck configs (fleet page)
   - `NEXT_PUBLIC_MOCK_MODE=false`
3. **Push to main** — Vercel auto-deploys

### Run tests

```bash
# Python tests (297 total)
python3 -m pytest modules/plc-sensor/tests/ -v    # 149 tests
python3 -m pytest modules/j1939-sensor/tests/ -v   # 148 tests

# Dashboard build verification
cd dashboard && npx next build

# Playwright E2E (requires browser install)
cd dashboard && npx playwright install && npx playwright test
```

## Key Features

- **Triple-sensor monitoring** — PLC production, J1939 truck diagnostics, and robot cell monitoring on every truck
- **AI-powered diagnostics** — Claude-based mechanic chat and one-shot diagnosis from live readings
- **19-rule diagnostic engine** — Real-time fault detection across camera, encoder, eject, PLC, and operation categories
- **Fleet overview** — All trucks on one page with status cards and health indicators
- **Shift reports** — Historical data aggregation with time presets and timezone support
- **DTC management** — View per-ECU fault codes with lamp indicators, clear via DM11
- **PWA** — Installable on iOS/Android home screen, offline-capable with service worker
- **Offline buffering** — JSONL files on Pi, auto-pruned at 50 MB, zero data loss
- **Self-healing** — Exponential backoff (1s → 30s), auto-reconnect on both Modbus and CAN
- **Secure** — All Viam and API credentials stay server-side (Vercel serverless functions)
- **Fleet-ready** — Viam Fragments for per-truck config, FLEET_TRUCKS env var for dashboard

## Fleet Deployment

Each truck runs a single Pi 5 with all three modules:

| Module | Role | Connection |
|--------|------|------------|
| `modules/plc-sensor/` | TPS production monitoring | Modbus TCP to PLC |
| `modules/j1939-sensor/` | J1939 truck diagnostics (passive) | CAN bus via HAT (listen-only, 250kbps) |
| `modules/cell-sensor/` | Robot cell monitoring | REST/Socket to Staubli/Apera |

The Pi 5 syncs to Viam Cloud. The dashboard reads from all machines using an organization-level API key.

For 30+ trucks:
1. Create a Viam Fragment from `config/fragment-tps-truck.json`
2. Add fragment to each truck machine, override PLC IP
3. Set `FLEET_TRUCKS` env var in Vercel with truck registry
4. See [docs/fleet-deployment-plan.md](docs/fleet-deployment-plan.md)

## Auth (Scaffold — Clerk Not Yet Installed)

RBAC with 4 roles defined in `dashboard/lib/auth.ts`:
- **Admin** — Full access, DTC clearing, PLC commands
- **Mechanic** — Diagnostics, DTC viewing/clearing, AI chat
- **Driver** — Read-only dashboard, shift reports
- **Viewer** — Read-only, no commands

Middleware is a no-op until `@clerk/nextjs` is installed.

## Troubleshooting

```bash
# PLC sensor logs
sudo journalctl -u viam-server -f | grep plc

# J1939 sensor logs
sudo journalctl -u viam-server -f | grep truck-engine

# CAN bus status
ip link show can0
systemctl status can0

# Test PLC connectivity
python3 scripts/test_plc_modbus.py --host 169.168.10.21 --watch

# Full health report
curl http://localhost:8081/health | python3 -m json.tool

# Fleet health (from Pi 5)
/usr/local/bin/fleet-health.sh
```

## Test Infrastructure

| Suite | Count | Coverage |
|-------|-------|----------|
| PLC sensor (pytest) | 149 | Diagnostics (86), utils (36), integration (25), chat queue |
| J1939 sensor (pytest) | 148 | PGN decoder (69), integration (31), sensor (24), OBD2 (24) |
| Playwright E2E | 18 | Dashboard, truck panel, fleet page |
| **Total** | **315** | |

All Python tests verify imperial units (°F, PSI, mph) per project conventions.

## Contributing

See [AGENTS.md](AGENTS.md) for the complete file map, ownership boundaries, data flow, conventions, and instructions for adding new features. See [docs/session-handoff.md](docs/session-handoff.md) for current development status and next priorities.

**Rules:**
- Branch and PR for all code changes (docs excepted)
- Files must stay under 500 lines — split if approaching
- All readings in US imperial units
- Viam credentials stay server-side, never in browser
- Mobile-friendly, dark theme, Tailwind CSS only in dashboard
