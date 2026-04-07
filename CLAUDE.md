# TPS Remote Monitoring System

## What this is
A fleet monitoring system for 30+ railroad trucks. Each truck has two Raspberry Pis:
- **Pi 5**: Reads a Click PLC C0-10DD2E-D via Modbus TCP (TPS production monitoring)
- **Pi Zero 2 W**: Reads J1939 CAN bus for truck engine/transmission diagnostics (passive, listen-only)

Both sync to Viam Cloud at 1 Hz. A Next.js dashboard on Vercel shows live status, AI diagnostics, shift reports, and fleet overview.

**There is NO E-Cat, NO servo/robot, NO vision in this system.**

## Architecture
- **Pi → PLC**: Modbus TCP (host: 169.168.10.21, port: 502) over Ethernet
- **Pi → Cloud**: Viam SDK, captures at 1 Hz, syncs every 6 seconds
- **Dashboard → Cloud**: Next.js API routes proxy Viam credentials server-side
- **History**: Viam Data API (`exportTabularData`) for shift summaries
- **Offline**: JSONL buffer at `/home/andrew/.viam/offline-buffer/` (50MB cap)

## Key directories
- `packages/shared/src/` — Shared TypeScript types and utilities (sensor-types, auth, work-order, spn-lookup, pcode-lookup, gauge-thresholds, format). Both dashboard and mobile re-export from here.
- `modules/plc-sensor/src/` — PLC sensor module: plc_sensor.py (main), plc_utils.py, plc_offline.py, plc_metrics.py, plc_weather.py, diagnostics.py, system_health.py
- `modules/j1939-sensor/src/models/` — J1939 sensor module: j1939_sensor.py (main), j1939_can.py, j1939_dtc.py, j1939_discovery.py, pgn_decoder.py, pgn_utils.py, pgn_dm1.py, obd2_poller.py, obd2_pids.py, obd2_dtc.py, obd2_diagnostics.py, vehicle_profiles.py
- `dashboard/` — Next.js 14 app on Vercel
- `dashboard/components/` — TruckPanel, GaugeGrid, DTCPanel, AIChatPanel, Dashboard, TPS/, DevTruck/, WorkBoard
- `dashboard/app/api/` — API routes (sensor-readings, truck-readings, fleet/status, ai-chat, ai-diagnose, ai-suggest-steps, shift-report, work-orders, team-members, etc.)
- `dashboard/lib/` — Re-exports from `@ironsight/shared` (sensor-types, auth, spn-lookup, pcode-lookup) + app-specific libs (supabase, audit)
- `dashboard/hooks/useSensorPolling.ts` — Shared polling hook with sim mode + fault detection
- `mobile/` — React Native (Expo) iOS app for fleet diagnostics, work orders, inspections
- `mobile/src/types/` — Re-exports from `@ironsight/shared` (sensor, auth, work-order)
- `mobile/src/utils/` — Re-exports from `@ironsight/shared` (spn-lookup, pcode-lookup, gauge-thresholds) + mobile-specific (format with date-fns)
- `scripts/` — Pi tooling: touch UI, discovery, AI server, display, autodiscover
- `scripts/lib/` — Shared utilities: ai_prompts, plc_discovery, display_pages, config_updater, modbus_scanner, network_scanner
- `config/` — Viam server config + fleet fragment template
- `docs/plc-register-map.md` — Complete PLC register map (478 registers decoded)
- `docs/session-handoff.md` — Current dev status and next priorities for agents

## Running tests
```bash
# Python (run separately — conftest collision if combined)
python3 -m pytest modules/plc-sensor/tests/ -v     # 149 tests
python3 -m pytest modules/j1939-sensor/tests/ -v    # 148 tests

# Dashboard build check
cd dashboard && npx next build

# Playwright E2E (needs browser install first)
cd dashboard && npx playwright install && npx playwright test
```

## Monorepo & Shared Package

This is a monorepo with a shared TypeScript package at `packages/shared/`.

**Structure:**
```
packages/shared/src/   — Single source of truth for shared types & utilities
  sensor-types.ts      — PlcSensorReadings, TruckSensorReadings, DiagnosticResult, GaugeThreshold
  auth.ts              — UserRole, AppUser, ROUTE_PERMISSIONS, role helpers
  work-order.ts        — WorkOrder, WorkOrderSubtask, WorkOrderNote, payloads, labels
  spn-lookup.ts        — J1939 SPN/FMI lookup (200+ SPNs)
  pcode-lookup.ts      — OBD-II P-code lookup (47 codes)
  gauge-thresholds.ts  — Warn/crit thresholds + getGaugeStatus/getGaugeColor
  format.ts            — Date/number formatters (requires date-fns)
  index.ts             — Barrel export (excludes format.ts due to date-fns dep)
```

**How it works:** Both `dashboard/lib/` and `mobile/src/types/` + `mobile/src/utils/` contain thin re-export shims (`export * from '@ironsight/shared/...'`). Existing imports across both apps continue to work unchanged. The path alias `@ironsight/shared` is configured in both tsconfigs and resolves to `../packages/shared/src`.

**Dashboard config:** `next.config.mjs` has `transpilePackages` and webpack alias for the shared package.
**Mobile config:** `metro.config.js` has `watchFolders` pointing to the shared package.

**When adding shared types/utilities:** Add to `packages/shared/src/`, then add a re-export shim in both `dashboard/lib/` and `mobile/src/` so existing import paths keep working.

**format.ts note:** Excluded from the barrel export because it depends on `date-fns`. Mobile imports it directly. Dashboard has its own inline `timeAgo` in WorkBoard.tsx.

## ⚠️ CRITICAL: Encoder Distance Calculation
**DO NOT use DD1 for distance.** DD1 is NOT a cumulative counter.

The PLC resets DD1 every ~10 counts at its 0.1ms scan rate (Rung 0 in ladder logic).
The Pi reads at 1Hz and misses thousands of reset cycles. DD1 oscillates 0-13 continuously.
Using DD1 for distance produces garbage data.

**Distance MUST come from DS10 (Encoder Next Tie):**
- DS10 counts down from DS3 (typically 195 = 19.5") to 0 in 0.1-inch units
- Each full countdown cycle = one tie spacing of travel
- Track the countdown and accumulate distance from deltas
- 1 DS10 unit = 0.1 inch = 2.54mm
- This is reliable at any sample rate because DS10 changes slowly (~20 counts/sec at typical speeds)

DD1 is still read and reported as `encoder_count` for raw display, but is NOT used for distance, speed, or revolutions.

See `docs/encoder-distance.md` for the full explanation.

## PLC Register Map (decoded from .ckp project file)
478 registers fully decoded. Key registers:

**DS Registers (Holding 0-24):**
- DS1: Encoder Ignore (threshold)
- DS2: Adjustable Tie Spacing (×0.5", so 39 = 19.5")
- DS3: Tie Spacing (×0.1", so 195 = 19.5")
- DS5: Detector Offset Bits
- DS6: Detector Offset (×0.1", so 6070 = 607.0")
- DS7: Plate Count
- DS8: AVG Plates per Min
- DS9: Detector Next Tie
- DS10: **Encoder Next Tie** — THE distance source (see above)
- DS19: HMI screen control

**DD1**: Raw HSC encoder count (NOT usable for distance — see warning above)

**C-bits**: 34 application coils including operating modes (C20-C27), drop pipeline (C16/C17/C29/C30/C32), detection (C3/C12/C7)

**Full map**: `docs/plc-register-map.md`

## Diagnostic Engine
19 rules in `diagnostics.py` across 5 categories (camera, encoder, eject, PLC, operation). Each diagnostic includes severity, plain-English title, and step-by-step operator actions. Runs on every 1Hz reading after 60-second warmup.

Rolling signal metrics in `SignalMetrics` class: camera detection rate, eject rate, camera trend (stable/declining/dead/intermittent), encoder noise, Modbus response time, state durations.

## Deployed module location
- Symlink: `/opt/viam-modules/plc-sensor/src/plc_sensor.py` → repo
- Copies (must manually update): `/opt/viam-modules/plc-sensor/run.sh`, `requirements.txt`
- After editing plc_sensor.py: `sudo systemctl restart viam-server`

## Dashboard
- Production: viam-staubli-apera-plc-mobile-poc.vercel.app
- Dev mode: viam-staubli-apera-plc-mobile-poc.vercel.app/dev
- Env vars: VIAM_API_KEY, VIAM_API_KEY_ID, VIAM_MACHINE_ADDRESS, VIAM_PART_ID (server-side) + NEXT_PUBLIC_ variants (client-side)
- Push to git triggers Vercel redeploy

## WiFi priority (NetworkManager)
1. B&B Shop (priority 30) — primary
2. Verizon_X6JPH6 (priority 20) — fallback
3. Andrew hotspot (priority 10) — last resort

## SSH access
- Tailscale IP: 100.112.68.52 (works from any network)

## Rules
- **Never use DD1 for distance** — use DS10 countdown (see above)
- **Never disable listen-only mode on the Pi Zero CAN bus** — normal mode ACKs truck frames and triggers DTCs/warning lights. OBD-II (which needs transmit) goes on a separate device.
- **Pi Zero CAN = 250kbps J1939 only** — do not change bitrate to 500kbps or set protocol to obd2 on this device
- Never add E-Cat, servo, robot, or vision code
- Keep dashboard mobile-friendly
- All Viam credentials stay server-side (Next.js API route), never in browser
- Always branch and PR, never push directly to main (docs excepted)
- Test with: `python3 scripts/test_plc_modbus.py` (reads live PLC)
- Build dashboard with: `cd dashboard && npm run build`

## Fleet Architecture

This repo serves a fleet of trucks. Each truck has two Raspberry Pis forming one unit:

| Pi | Hostname | Tailscale IP | Role | Module |
|----|----------|-------------|------|--------|
| Pi 5 | viam-pi | 100.112.68.52 | TPS monitoring, uploads, touch display | `modules/plc-sensor/` |
| Pi Zero 2 W | truck-diagnostics | 100.113.196.68 | J1939 CAN bus truck diagnostics (passive, listen-only) | `modules/j1939-sensor/` |

**Repo locations:**
- Pi 5: `/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC` (origin)
- Pi Zero: `/home/andrew/repo` (clone)
- Both track `origin/main`. Auto-sync runs every 10 min via cron.

**Viam machines** (same org & location `djgpitarpm`):
- Pi 5 machine: `staubli-pi` → component `plc-monitor`
- Pi Zero machine: `truck-diagnostic` → component `truck-engine`

**Dashboard** is on Vercel (not the Pis). Push to `main` triggers Vercel auto-deploy.

## Viam Data API Payload Structure

**CRITICAL**: When querying `exportTabularData()`, results have nested payload structure:
```
row.payload = {
  readings: {
    engine_rpm: 1200,
    coolant_temp_f: 195,
    _protocol: "j1939",
    ...
  }
}
```
Always unwrap to `row.payload.readings` -- NOT `row.payload` directly.

## Credential Architecture (Fleet Scale)

```
Organization API Key (VIAM_API_KEY / VIAM_API_KEY_ID)
  |-- Used by ALL dashboard Data API queries (exportTabularData)
  |-- Single key reads data from ANY machine in the organization
  +-- Set once in Vercel env vars -- never changes per truck

Machine API Keys (TRUCK_VIAM_API_KEY / TRUCK_VIAM_API_KEY_ID)
  |-- Per-machine, used ONLY for direct commands (do_command)
  |-- Required for: DTC clear, PGN requests, bus stats
  +-- Needs WebRTC connection to specific machine

Part IDs:
  |-- VIAM_PART_ID: Pi 5 TPS machine (plc-monitor component)
  |-- TRUCK_VIAM_PART_ID: Pi Zero truck machine (truck-engine component)
  +-- Each truck in the fleet has a unique Part ID
```

For 30+ truck fleet, the dashboard will need a truck registry (database or config)
mapping truck identifiers to their Part IDs. The org-level API key queries all of them.

## Fleet Orchestration Rules

Claude is the fleet orchestrator. When making ANY change:

1. **Code changes go to git first, then deploy.** Never edit files on a Pi without committing.
2. **Both Pis must stay on the same commit.** After pushing, verify both pulled.
3. **Service restarts are safe.** Viam-server, CAN service, and all IronSight services auto-recover.
4. **Dashboard changes** — push to git, Vercel auto-deploys. No action needed on Pis.
5. **Module changes on Pi 5** — `sudo systemctl restart viam-server` after code change.
6. **Module changes on Pi Zero** — `cd ~/repo && git pull && sudo systemctl restart viam-server`.
7. **Health check** — run `/usr/local/bin/fleet-health.sh` to get JSON status of entire fleet.
8. **Fleet sync** — `/usr/local/bin/fleet-sync.sh` runs on cron; can also be triggered manually.
9. **If a Pi is unreachable**, check: WiFi (nmcli), Tailscale (tailscale status), power (PiSugar).
10. **If Viam is down**, check: `sudo journalctl -u viam-server -n 30`. Common fixes: restart service, check credentials, check network.

## AI Diagnostic System

The dashboard includes an AI-powered diagnostic system that uses Claude to help mechanics analyze vehicle data. Two endpoints:

**Chat (`dashboard/app/api/ai-chat/route.ts`):**
- Conversational AI mechanic that receives live vehicle readings with every message
- Maintains conversation history per session (client-side state)
- Uses claude-sonnet-4-20250514, 1500 max tokens

**Full Diagnosis (`dashboard/app/api/ai-diagnose/route.ts`):**
- One-shot comprehensive diagnosis from current readings
- Structured output: Data Summary, Trouble Codes, Engine Health, Questions for Mechanic, Maintenance Recommendations, Fleet Note
- Uses claude-sonnet-4-20250514, 2000 max tokens

**Critical prompt design rules:**
- AI is a **diagnostic partner**, not an oracle — present possibilities, not certainties
- NEVER make safety/liability judgments — that's the mechanic's professional call
- NEVER blame previous mechanic work without full context
- Always ask about vehicle history, recent repairs, symptoms BEFORE diagnosing
- End every response with 2-3 suggested follow-up questions for mechanics new to AI
- Say "this COULD indicate" not "this IS caused by"

**Logging:**
- All AI conversations logged via `console.log("[AI-CHAT-LOG]", ...)` — viewable in Vercel Functions logs
- All diagnoses logged via `console.log("[AI-DIAGNOSIS-LOG]", ...)`
- DTC clears and diagnostic commands logged via `console.log("[COMMAND-LOG]", ...)` in `dashboard/app/api/truck-command/route.ts`

**Env vars needed:** `ANTHROPIC_API_KEY`, `TRUCK_VIAM_MACHINE_ADDRESS`, `TRUCK_VIAM_API_KEY`, `TRUCK_VIAM_API_KEY_ID`

## OBD-II Passenger Vehicle Support (FUTURE — SEPARATE DEVICE)

**The Pi Zero is J1939-only.** OBD-II support will live on a separate physical device and potentially a separate repo. Do NOT configure the Pi Zero for OBD-II — it must stay in listen-only mode at 250kbps for J1939 truck safety.

The OBD-II code remains in this repo for future use on a dedicated OBD-II device. The module auto-detects J1939 vs OBD-II based on CAN frame IDs when configured for the appropriate protocol.

**Tested and validated (on separate vehicle):** 2013 Nissan Altima — 6.6M CAN frames, zero drops, remote DTC clear successful (2026-03-29). SPI CAN HAT (MCP2515) confirmed production-ready.

**OBD-II features:** 33 PIDs (all imperial units), DTC read/clear, freeze frame, readiness monitors, VIN, pending/permanent DTCs.

**The full OBD-II poller lives in `modules/j1939-sensor/src/models/obd2_poller.py`.**
This file contains ALL 33 PIDs, the OBD2DTCReader class (Mode 03/04), and the OBD2AdvancedDiag class
(freeze frame, readiness, VIN, pending/permanent DTCs). The do_command routing in j1939_sensor.py
forwards OBD-II commands to these classes. Keep this code intact for the future OBD-II device.

**All readings are US imperial:** temperatures in °F, pressures in PSI, speed in mph, distances in miles, fuel in gallons. Conversion happens in the decode lambdas, not in the dashboard.

## J1939 Truck Sensor (modules/j1939-sensor/)

Reads J1939 CAN bus data from heavy-duty trucks (2013+ Mack/Volvo) via Waveshare CAN HAT (B).
Decodes 15 PGNs: engine RPM, temperatures, pressures, vehicle speed, fuel, battery, transmission, DTCs.

**⚠️ CRITICAL: CAN Bus Safety — Listen-Only Mode Required**

The Pi Zero MUST operate in **listen-only mode** on the J1939 truck bus. In normal mode, the MCP2515 ACKs every CAN frame, which adds an unauthorized node to the truck's bus. This disrupts ECU-to-ECU communication and triggers dashboard warning lights (DTCs). Listen-only mode makes the MCP2515 completely invisible on the bus.

**All CAN interface commands must include `listen-only on`:**
```bash
ip link set can0 up type can bitrate 250000 listen-only on
```

**Never use normal mode on the truck bus.** OBD-II (which requires transmit) will use a separate physical device.

**Key commands (via Viam do_command):**
- `{"command": "get_bus_stats"}` — CAN bus connection stats

**CAN HAT config** (`/boot/firmware/config.txt`):
- `dtparam=spi=on`
- `dtoverlay=mcp2515-can0,oscillator=12000000,interrupt=25,spimaxfrequency=2000000`
- 12MHz crystal (NOT 8MHz), GPIO25 interrupt, 250kbps bitrate, listen-only mode

**Data capture** is enabled on the `truck-diagnostic` Viam machine:
- Capture: `Readings` method at 1 Hz on `truck-engine` component
- Sync: every 6 seconds (0.1 min) to Viam Cloud
- Capture dir: `/home/andrew/.viam/capture` (persistent, survives reboot)
- Tags: `truck-diagnostics`, `ironsight`
- Config note: Viam requires `api` field only — do NOT include `type`/`namespace` alongside `api` on components or services

**SSH:** `ssh andrew@100.113.196.68` (password: 1111, test only)

## Truck Networking (Field Deployment)

When on a truck (away from shop WiFi), the Pi 5 provides internet for the Pi Zero:

```
Cellular dongle/HAT → Pi 5 (internet)
Pi 5 WiFi AP "IronSight-Truck" → Pi Zero (gets internet from Pi 5)
Both Pis → Tailscale → Viam Cloud → Dashboard
```

**Pre-configured and ready:**
- Pi 5 hotspot: SSID `IronSight-Truck`, password `ironsight2026`, subnet `10.42.0.0/24`
- Pi Zero auto-connects to `IronSight-Truck` at priority 200 (highest)
- Cellular profile on Pi 5: auto-connects when USB modem/HAT is plugged in
- Dispatcher script auto-activates hotspot when cellular comes up
- IP forwarding enabled for NAT

**Manual control:** `hotspot on/off/status` on the Pi 5

**What happens when you plug in the cellular dongle:**
1. ModemManager detects modem, NetworkManager activates "Cellular" profile
2. Dispatcher detects cellular up, activates IronSight-Hotspot
3. Pi Zero sees hotspot, auto-connects (priority 200 > home WiFi 100)
4. Both Pis get internet through cellular, Tailscale reconnects, Viam syncs

**WiFi priorities (Pi Zero):**
- IronSight-Truck: 200 (truck/field)
- Verizon_X6JPH6: 100 (home)

**WiFi priorities (Pi 5):**
- Andrew-Hotspot: 40
- BB-Shop: 30 (work)
- Verizon_X6JPH6: 20 (home)
