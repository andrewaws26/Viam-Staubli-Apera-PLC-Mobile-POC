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
|   |   |   |-- plc_sensor.py       # Main Viam Sensor class (~1800 lines, NEEDS SPLIT)
|   |   |   |-- diagnostics.py      # 19-rule diagnostic engine (532 lines)
|   |   |   +-- system_health.py    # Pi health metrics (166 lines)
|   |   +-- tests/
|   |       |-- test_diagnostics.py  # 86 tests for diagnostic rules
|   |       +-- test_plc_utils.py    # 36 tests for utilities
|   |
|   +-- j1939-sensor/           # J1939 CAN bus truck diagnostics
|       |-- src/
|       |   |-- models/
|       |   |   |-- j1939_sensor.py      # Main sensor (~2100 lines, NEEDS SPLIT)
|       |   |   |-- pgn_decoder.py       # PGN decode functions (~1018 lines, BEING SPLIT)
|       |   |   |   +-- pgn_utils.py     # Byte extraction utilities (NEW)
|       |   |   |   +-- pgn_dm1.py       # DM1/DM2 DTC decoding (NEW)
|       |   |   |-- obd2_poller.py       # OBD-II polling (918 lines, FUTURE: separate module)
|       |   |   +-- vehicle_profiles.py  # Vehicle profile data (286 lines)
|       |   +-- system_health.py         # Pi health metrics (166 lines)
|       +-- tests/
|           |-- test_j1939_sensor.py
|           |-- test_obd2_poller.py
|           +-- test_pgn_decoder.py
|
|-- dashboard/                  # Next.js 14 app on Vercel
|   |-- app/
|   |   |-- page.tsx                 # Landing/home page
|   |   |-- dev/page.tsx             # Dev mode diagnostics page
|   |   |-- shift-report/page.tsx    # Shift summary reports (BEING SPLIT)
|   |   +-- api/                     # Server-side API routes (credentials stay here)
|   |       |-- sensor-readings/     # Live PLC data proxy
|   |       |-- truck-readings/      # Live J1939 data proxy
|   |       |-- sensor-history/      # Historical data via Viam Data API
|   |       |-- shift-report/        # Shift summary aggregation
|   |       |-- ai-chat/             # Claude AI mechanic chat
|   |       |-- ai-diagnose/         # Claude AI one-shot diagnosis
|   |       |-- plc-command/         # PLC do_command proxy
|   |       |-- truck-command/       # J1939 do_command proxy
|   |       +-- pi-health/           # Pi system health proxy
|   |
|   |-- components/
|   |   |-- TruckPanel.tsx           # Main truck monitoring orchestrator (773 lines)
|   |   |-- GaugeGrid.tsx            # Gauge field definitions + rendering (382 lines)
|   |   |-- DTCPanel.tsx             # DTC display + clearing (396 lines)
|   |   |-- AIChatPanel.tsx          # AI chat + diagnosis UI (231 lines)
|   |   |-- Dashboard.tsx            # TPS dashboard (512 lines)
|   |   |-- DevTPSPanel.tsx          # Dev TPS panel (999 lines, BEING SPLIT)
|   |   |-- DevTruckPanel.tsx        # Dev truck panel (767 lines)
|   |   +-- TPS/                     # Extracted TPS sub-components (NEW)
|   |
|   +-- lib/
|       |-- sensor-types.ts          # TypeScript interfaces for all sensor readings
|       |-- machines.ts              # Fleet truck registry
|       +-- truck-data.ts            # Truck data utilities
|
|-- scripts/                    # CLI tools and Pi display apps
|   |-- ironsight-touch.py           # Touch display app (2085 lines, NEEDS SPLIT)
|   |-- ironsight-discover.py        # Network/PLC discovery (1281 lines, NEEDS SPLIT)
|   |-- ironsight-server.py          # AI analysis HTTP server (787 lines)
|   |-- ironsight-display.py         # Headless display (631 lines)
|   |-- plc-autodiscover.py          # Auto-discovery daemon (951 lines, NEEDS SPLIT)
|   +-- lib/                         # Shared script utilities
|
|-- config/                     # Viam server and fragment configs
|-- docs/                       # 19 documentation files
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

These are approved but not yet implemented:

1. **OBD2 separation** -- `modules/obd2-sensor/` will be a separate Viam module (currently embedded in j1939-sensor)
2. **Pi consolidation** -- Both modules will run on Pi 5 only (Pi Zero being retired)
3. **Auth** -- Clerk RBAC with 4 roles: admin, mechanic, driver, viewer
4. **Fleet overview** -- `/fleet/page.tsx` with multi-truck map and alerts
5. **PWA** -- Service worker + manifest for iOS home screen install
6. **Dev AI** -- Engineering-focused Claude AI at `/api/ai-dev-chat/` with tool-use capability
