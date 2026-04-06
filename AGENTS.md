# Agent Development Guide

This document helps AI coding agents understand the codebase structure, ownership boundaries, and conventions so they can work correctly on first attempt.

## Quick Rules

1. **Never use DD1 for distance** -- use DS10 countdown (see CLAUDE.md)
2. **Never disable listen-only mode** on the J1939 CAN bus Pi
3. **Pi Zero CAN = 250kbps J1939 only** -- do not change bitrate or protocol
4. **All Viam credentials stay server-side** -- never expose in browser/client code
5. **Files must stay under 500 lines** -- split if approaching this limit
6. **All readings are US imperial** -- temperatures in F, pressures in PSI, speed in mph
7. **Branch and PR, never push to main** (docs excepted)

## Repository Structure

```
Viam-Staubli-Apera-PLC-Mobile-POC/
|
|-- modules/                    # Viam sensor modules (Python, run on Raspberry Pi)
|   |-- plc-sensor/             # TPS PLC monitoring via Modbus TCP
|   |   |-- src/
|   |   |   |-- plc_sensor.py       # Main Viam Sensor class (1300 lines, needs further split)
|   |   |   |-- plc_utils.py        # Helpers: _serialise, _uint16, _read_chat_queue (59 lines)
|   |   |   |-- plc_offline.py      # OfflineBuffer JSONL persistence (72 lines)
|   |   |   |-- plc_metrics.py      # ConnectionQualityMonitor + SignalMetrics (365 lines)
|   |   |   |-- plc_weather.py      # _LocationWeatherCache (90 lines)
|   |   |   |-- diagnostics.py      # 19-rule diagnostic engine (532 lines)
|   |   |   +-- system_health.py    # Pi health metrics (166 lines)
|   |   +-- tests/                   # 149 tests passing
|   |       |-- test_diagnostics.py  # 86 tests + 25 integration tests
|   |       +-- test_plc_utils.py    # 36 tests for utils + offline buffer + chat queue
|   |
|   +-- j1939-sensor/           # J1939 CAN bus truck diagnostics
|       |-- src/
|       |   |-- models/
|       |   |   |-- j1939_sensor.py      # Main sensor orchestrator (2268 lines — NEEDS WIRING to sub-modules below)
|       |   |   |-- j1939_can.py         # CAN bus mgmt, listener, bitrate negotiation (649 lines, NEW)
|       |   |   |-- j1939_dtc.py         # DTC namespacing, DM11 clearing (214 lines, NEW)
|       |   |   |-- j1939_discovery.py   # Protocol detect, VIN, vehicle profiles (489 lines, NEW)
|       |   |   |-- pgn_decoder.py       # PGN decode registry (871 lines, imports from sub-modules)
|       |   |   |-- pgn_utils.py         # Byte extraction, CAN ID parsing, dataclasses (150 lines)
|       |   |   |-- pgn_dm1.py           # DM1/DM2 DTC + lamp decoding (67 lines)
|       |   |   |-- obd2_poller.py       # OBD-II orchestrator (398 lines, imports sub-modules)
|       |   |   |-- obd2_pids.py         # 40 PID definitions + decode lambdas (234 lines)
|       |   |   |-- obd2_dtc.py          # DTC read/clear Mode 03/04 (117 lines)
|       |   |   |-- obd2_diagnostics.py  # Freeze frame, readiness, VIN (243 lines)
|       |   |   +-- vehicle_profiles.py  # Vehicle profile data (286 lines)
|       |   +-- system_health.py         # Pi health metrics (166 lines)
|       +-- tests/                   # 148 tests passing
|           |-- test_j1939_sensor.py     # 24 tests (config, readings, commands, resilience)
|           |-- test_obd2_poller.py      # 24 tests (PID formulas, bus tracking, integration)
|           |-- test_pgn_decoder.py      # 69 tests (all PGNs, DM1, edge cases)
|           +-- test_pgn_integration.py  # 31 tests (multi-PGN scenarios, malformed data)
|
|-- dashboard/                  # Next.js 14 app on Vercel
|   |-- app/
|   |   |-- page.tsx                 # Landing/home page
|   |   |-- dev/page.tsx             # Dev mode diagnostics page
|   |   |-- fleet/page.tsx           # Fleet overview with truck status cards (378 lines)
|   |   |-- sign-in/                 # Auth placeholder (Clerk not yet installed)
|   |   |-- shift-report/
|   |   |   |-- page.tsx             # Shift reports UI (415 lines)
|   |   |   |-- types.ts             # Shared types
|   |   |   |-- utils/               # timezone.ts, time-presets.ts
|   |   |   +-- components/          # Extracted sub-components
|   |   +-- api/                     # Server-side API routes (credentials stay here)
|   |       |-- sensor-readings/     # Live PLC data proxy
|   |       |-- truck-readings/      # Live J1939 data proxy
|   |       |-- sensor-history/      # Historical data via Viam Data API
|   |       |-- shift-report/
|   |       |   |-- route.ts         # Thin orchestrator (165 lines)
|   |       |   |-- aggregation.ts   # Pure data transformation functions (399 lines)
|   |       |   +-- types.ts         # Request/response types (146 lines)
|   |       |-- fleet/status/        # Fleet status with Promise.allSettled (334 lines)
|   |       |-- ai-chat/             # Claude AI mechanic chat
|   |       |-- ai-diagnose/         # Claude AI one-shot diagnosis
|   |       |-- plc-command/         # PLC do_command proxy
|   |       |-- truck-command/       # J1939 do_command proxy
|   |       +-- pi-health/           # Pi system health proxy
|   |
|   |-- components/
|   |   |-- TruckPanel.tsx           # Main truck monitoring orchestrator (811 lines, needs split)
|   |   |-- GaugeGrid.tsx            # Gauge field definitions + rendering (382 lines)
|   |   |-- DTCPanel.tsx             # DTC display + clearing (396 lines)
|   |   |-- AIChatPanel.tsx          # AI chat + diagnosis UI (231 lines)
|   |   |-- Dashboard.tsx            # TPS dashboard orchestrator (185 lines)
|   |   |-- DashboardAudio.tsx       # Alarm hook + flash overlay (70 lines)
|   |   |-- DevTPSPanel.tsx          # Re-exports from TPS/ (3 lines)
|   |   |-- DevTruckPanel.tsx        # Dev truck panel orchestrator (222 lines)
|   |   |-- TPS/                     # TPS sub-components
|   |   |   |-- index.tsx            # TPS orchestrator (459 lines)
|   |   |   |-- TPSFields.ts         # Types, constants, register groups (240 lines)
|   |   |   |-- TPSSimulator.tsx     # Simulator controls (97 lines)
|   |   |   |-- TPSRegisterTable.tsx # Register display (66 lines)
|   |   |   |-- TPSDiagnosticsPanel.tsx # Diagnostics display (43 lines)
|   |   |   +-- TPSRemoteControl.tsx # PLC remote commands (182 lines)
|   |   +-- DevTruck/                # Dev truck sub-components
|   |       |-- BusStatsPanel.tsx    # Connection + health display (216 lines)
|   |       |-- CommandPanel.tsx     # DTC + command interface (191 lines)
|   |       +-- DebugControls.tsx    # Live readings + raw JSON (148 lines)
|   |
|   |-- hooks/
|   |   +-- useSensorPolling.ts      # Polling, sim mode, fault detection (330 lines)
|   |
|   |-- lib/
|   |   |-- sensor-types.ts          # TypeScript interfaces for all sensor readings
|   |   |-- machines.ts              # Fleet truck registry (FLEET_TRUCKS env var)
|   |   |-- auth.ts                  # RBAC role definitions + route permissions
|   |   +-- truck-data.ts            # Truck data utilities
|   |
|   |-- public/
|   |   |-- manifest.json            # PWA manifest
|   |   +-- sw.js                    # Service worker (cache-first + stale-while-revalidate)
|   |
|   |-- middleware.ts                # No-op until Clerk installed
|   +-- tests/                       # 18 Playwright E2E tests configured
|       |-- e2e/                     # dashboard, truck-panel, fleet specs
|       +-- mocks/                   # Realistic sensor data factories
|
|-- scripts/                    # CLI tools and Pi display apps
|   |-- ironsight-touch.py           # Thin launcher (18 lines) → touch_ui/
|   |-- ironsight-discover.py        # Thin launcher (18 lines) → discovery/
|   |-- ironsight-server.py          # AI analysis HTTP server (638 lines, imports ai_prompts)
|   |-- ironsight-display.py         # Headless display (104 lines, imports display_pages)
|   |-- ironsight-analyze.py         # PLC analysis CLI (451 lines, imports plc_discovery)
|   |-- ironsight-discovery-daemon.py # Discovery daemon (431 lines, imports config_updater)
|   |-- plc-autodiscover.py          # Auto-discovery (414 lines, imports modbus/network_scanner)
|   |-- touch_ui/                    # Touch display package
|   |   |-- app.py                   # Main event loop (417 lines)
|   |   |-- constants.py             # Layout/timing constants
|   |   |-- screens/                 # 8 screen modules (home, live, commands, logs, etc.)
|   |   +-- widgets/                 # Button, status bar, common drawing
|   |-- discovery/                   # Network/PLC discovery package
|   |   |-- network.py              # IP/port/ARP scanning (301 lines)
|   |   |-- modbus.py               # Modbus TCP probing (484 lines)
|   |   |-- plc.py                  # PLC identification + reports (494 lines)
|   |   +-- cli.py                  # CLI entry point (81 lines)
|   +-- lib/                         # Shared script utilities
|       |-- ai_prompts.py           # AI analysis prompt templates (194 lines)
|       |-- plc_discovery.py        # Unknown PLC register discovery (340 lines)
|       |-- display_pages.py        # Display page renderers (487 lines)
|       |-- config_updater.py       # Config file updater (264 lines)
|       |-- modbus_scanner.py       # Modbus scanning utilities (193 lines)
|       +-- network_scanner.py      # Network scanning utilities (474 lines)
|
|-- config/                     # Viam server and fragment configs
|-- docs/                       # Documentation files
|   +-- session-handoff.md      # Detailed handoff for next agent session
+-- CLAUDE.md                   # Primary agent instructions (READ THIS FIRST)
```

## File Ownership Rules

When modifying code, respect these boundaries:

| Area | Owner | Key constraint |
|------|-------|---------------|
| `modules/plc-sensor/` | PLC/Modbus team | Must not import from j1939-sensor |
| `modules/j1939-sensor/` | CAN bus team | Must stay listen-only on truck bus |
| `dashboard/app/api/` | Backend team | Credentials server-side only, never in client |
| `dashboard/components/` | Frontend team | Mobile-friendly, dark theme, Tailwind only |
| `dashboard/lib/` | Shared | Types and utilities used by components and API routes |
| `scripts/` | Pi tooling | Runs on Raspberry Pi, minimal dependencies |
| `docs/` | Anyone | Keep accurate, update when code changes |

## Data Flow

```
PLC (Modbus TCP) --> Pi 5 (plc_sensor.py @ 1Hz) --> Viam Cloud (6s sync)
CAN Bus (J1939)  --> Pi 5 (j1939_sensor.py @ 1Hz) --> Viam Cloud (6s sync)
                                                           |
Dashboard (Vercel) <-- API routes <-- Viam SDK (server-side) <--+
     |
     +--> AI Chat/Diagnosis --> Claude API (server-side)
```

## Key Interfaces

### PLC Sensor Readings (~100+ fields)
See `dashboard/lib/sensor-types.ts` → `PlcSensorReadings` for the full interface.
Key fields: `ds1`-`ds25`, `dd1_encoder_count`, `encoder_speed_ftpm`, `plate_count`, `operating_mode`, all C-bit coils, diagnostics array, system health metrics.

### Truck Sensor Readings (~100+ fields)
See `dashboard/lib/sensor-types.ts` → `TruckSensorReadings` for the full interface.
Key fields: `engine_rpm`, `coolant_temp_f`, `oil_pressure_psi`, `vehicle_speed_mph`, `active_dtc_count`, per-ECU DTCs (`dtc_engine_0_spn`, `dtc_trans_0_spn`, etc.), lamp states (`mil_engine`, `amber_lamp_trans`, etc.), `_protocol` (j1939/obd2).

### DTC Namespacing Convention
DTCs are namespaced by ECU source address to prevent overwrite:
- `dtc_engine_count`, `dtc_engine_0_spn/fmi/occurrence` (SA 0x00)
- `dtc_trans_count`, `dtc_trans_0_spn/fmi/occurrence` (SA 0x03)
- `dtc_abs_count`, `dtc_abs_0_spn/fmi/occurrence` (SA 0x0B)
- `dtc_acm_count`, `dtc_acm_0_spn/fmi/occurrence` (SA 0x3D)
- `dtc_body_count`, `dtc_body_0_spn/fmi/occurrence` (SA 0x21)
- `dtc_inst_count`, `dtc_inst_0_spn/fmi/occurrence` (SA 0x17)
- `active_dtc_count` = sum across all sources
- Flat `dtc_0_*` keys are backward-compat aliases populated from engine (SA 0x00)

### Older Trucks (pre-2013)
Pre-2013 Mack/Volvo trucks may:
- Broadcast fewer PGNs (only engine + aftertreatment)
- Use different source addresses
- Have no transmission or ABS CAN nodes
- Code must be tolerant of missing data -- readings only populate when frames arrive

## Conventions

### Python
- Use `viam.logging.getLogger(__name__)` for logging
- Use `exc_info=True` on all `LOGGER.error()` inside except blocks
- Use `LOGGER.debug()` for silenced exceptions (not `pass`)
- Type hints on public methods
- Tests in `modules/*/tests/` using pytest

### TypeScript/React
- "use client" directive on components with hooks/state
- Tailwind CSS only (no CSS modules, no styled-components)
- Dark theme: gray-900 backgrounds, purple accents
- Mobile-first: min-h-[44px] touch targets, responsive text sizes
- Props interfaces defined and exported for all components
- All sensor reading fields are optional (`?`) for connection failure resilience

### API Routes
- All routes log errors: `console.error("[API-ERROR]", path, error)`
- Command routes log actions: `console.log("[COMMAND-LOG]", ...)`
- AI routes log conversations: `console.log("[AI-CHAT-LOG]", ...)`
- Never expose Viam credentials to the client

### Git
- Branch and PR for all code changes
- Commit messages: imperative mood, explain why not what
- One concern per commit when possible

## Adding New Features

### Adding a new sensor field
1. Add to Python `get_readings()` in the appropriate sensor module
2. Add to TypeScript interface in `dashboard/lib/sensor-types.ts`
3. Add to gauge field definitions in the appropriate component
4. Update `docs/plc-register-map.md` if it's a PLC register

### Adding a new dashboard component
1. Create under `dashboard/components/` -- keep under 500 lines
2. Define and export a props interface
3. Use TypeScript types from `dashboard/lib/sensor-types.ts`
4. Mobile-friendly, dark theme, Tailwind only
5. Add to the appropriate page/panel

### Adding a new API route
1. Create under `dashboard/app/api/<name>/route.ts`
2. Use server-side Viam credentials (never expose to client)
3. Add `console.error("[API-ERROR]", ...)` in all catch blocks
4. Add timing: `const start = Date.now(); ... console.log("[API-TIMING]", ...)`
5. Return JSON with `{ success: boolean, ... }` pattern

### Adding a new diagnostic rule
1. Add to `modules/plc-sensor/src/diagnostics.py` in the appropriate `_check_*` method
2. Follow the existing pattern: severity, category, rule name, title, detail, operator actions, evidence
3. Add tests in `modules/plc-sensor/tests/test_diagnostics.py` (positive trigger + negative + edge cases)

## Planned Architecture Changes

Implemented:
- **Fleet overview** -- `/fleet/page.tsx` + `/api/fleet/status` with truck status cards (DONE)
- **PWA** -- manifest.json + service worker with cache-first + stale-while-revalidate (DONE)
- **Auth scaffold** -- middleware.ts (no-op), lib/auth.ts (RBAC matrix), sign-in placeholder (DONE)

Not yet implemented:
1. **j1939_sensor.py wiring** -- Sub-modules exist (j1939_can/dtc/discovery.py) but parent still duplicates all code. Wire imports + delete duplication. HIGHEST PRIORITY.
2. **OBD2 separation** -- `modules/obd2-sensor/` as separate Viam module (currently embedded in j1939-sensor)
3. **Pi consolidation** -- Both modules will run on Pi 5 only (Pi Zero being retired)
4. **Auth activation** -- Install @clerk/nextjs, uncomment middleware, wrap layout
5. **Dev AI** -- Engineering-focused Claude AI at `/api/ai-dev-chat/` with tool-use capability
6. **iOS app** -- Capacitor wrap of existing dashboard when App Store distribution needed
