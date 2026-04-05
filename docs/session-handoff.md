# Session Handoff: Code Review & Architecture Overhaul

**Date**: 2026-04-05
**Branch**: `claude/code-review-suggestions-RiQah`
**Status**: Waves 1-4 complete. File splits ~85% done. All tests passing. Dashboard builds clean. README fully updated.

## Current State Summary

| Metric | Value |
|--------|-------|
| Python tests | **297 passing** (148 j1939 + 149 plc) |
| Dashboard build | **Clean** (all routes compile) |
| Playwright E2E | 18 tests configured (need `npx playwright install` to run) |
| Files over 500 lines | **8 remaining** (was 20+) |
| Total commits on branch | ~30 |

## What's Done (Committed & Pushed)

### Wave 0 — Earlier Session
- Created `dashboard/lib/sensor-types.ts` (TypeScript interfaces for all sensor readings)
- Extracted `AIChatPanel.tsx`, `DTCPanel.tsx`, `GaugeGrid.tsx` from TruckPanel.tsx
- Refactored TruckPanel.tsx from 1,671 to 773 lines
- Added 122 Python tests (test_diagnostics.py + test_plc_utils.py)
- Made system_health.py identical across both modules
- Updated docs/architecture.md with Mermaid diagram
- Added .claude/ to .gitignore

### Wave 1 — Quick Fixes (All Complete)
1. **Docs**: Updated ~55 to ~100+ in 4 doc files
2. **TypeScript types**: Fixed active_dtcs mismatch, vin phantom, added sync health fields, per-ECU lamp fields
3. **plc_sensor.py logging**: Added exc_info=True to all error/warning calls
4. **j1939_sensor.py DTC fix**: Per-ECU namespace tracking via `_SA_SUFFIX` mapping, `_apply_namespaced_dtcs()`
5. **API error logging**: Added console.error to all API route catch blocks
6. **Lamp indicators**: CHECK ENGINE/WARNING/STOP/PROTECT badges in TruckPanel header
7. **AGENTS.md**: Comprehensive agent development guide

### Wave 2 — File Splits (Completed)
- [x] `shift-report/page.tsx` (1,111 → 415 lines) + 10 extracted sub-modules
- [x] `DevTPSPanel.tsx` (999 → 3 lines) re-exports from TPS/index.tsx orchestrator
- [x] `Dashboard.tsx` (512 → 185 lines) extracted DashboardAudio + useSensorPolling hook
- [x] `DevTruckPanel.tsx` (767 → 222 lines) extracted DevTruck/ (BusStats, Command, Debug)
- [x] `obd2_poller.py` (918 → 398 lines) extracted obd2_pids, obd2_dtc, obd2_diagnostics
- [x] `plc_sensor.py` (1827 → 1300 lines) imports from plc_utils/offline/metrics/weather
- [x] `shift-report/route.ts` (618 → 165 lines) extracted aggregation.ts + types.ts
- [x] `ironsight-discover.py` (1281 → 18 lines) extracted to discovery/ package
- [x] `ironsight-touch.py` extracted to touch_ui/ package (screens + widgets)
- [x] `plc_sensor.py` sub-modules: plc_utils.py, plc_offline.py, plc_metrics.py, plc_weather.py
- [x] `pgn_decoder.py` (1018 → 871 lines) imports from pgn_utils.py + pgn_dm1.py
- [x] `scripts/lib/` additions: ai_prompts.py, plc_discovery.py, display_pages.py, config_updater.py, modbus_scanner.py, network_scanner.py
- [x] `ironsight-server.py` (787 → 638 lines) imports from ai_prompts.py
- [x] `ironsight-analyze.py` (721 → 451 lines) imports from plc_discovery.py
- [x] `ironsight-display.py` (631 → 104 lines) imports from display_pages.py
- [x] `ironsight-discovery-daemon.py` (628 → 431 lines) imports from config_updater.py
- [x] `plc-autodiscover.py` (951 → 414 lines) imports from modbus_scanner.py + network_scanner.py
- [x] `j1939_sensor.py` sub-modules CREATED: j1939_can.py (649), j1939_dtc.py (214), j1939_discovery.py (489)

### Wave 4 — Features (Done)
- [x] **PWA**: manifest.json + service worker (cache-first static, stale-while-revalidate API) + iOS meta tags
- [x] **Auth scaffold**: middleware.ts (no-op until Clerk installed), lib/auth.ts (RBAC matrix), sign-in placeholder
- [x] **Fleet overview**: /fleet page with truck status cards + /api/fleet/status route
- [x] **DTC clearing fix**: Interface toggle (listen-only → normal → send DM11 → restore), 0xF9 SA, DM12 confirmation
- [x] **Middleware fix**: No-op until @clerk/nextjs installed
- [x] **Fleet registry**: dashboard/lib/machines.ts with FLEET_TRUCKS env var support

### Documentation (Done)
- [x] **README.md**: Comprehensive rewrite — covers both sensors, fleet architecture, AI diagnostics, PWA, auth, 315 tests, all modules
- [x] **AGENTS.md**: Complete file map with every file, line count, test count, ownership rules
- [x] **session-handoff.md**: This file — accurate status for next session

### Test Infrastructure (Done)
- [x] **Playwright E2E**: 18 tests across 3 suites (dashboard, truck-panel, fleet) with route interception
- [x] **Python tests**: 297 total — all passing
  - 86 diagnostic rule tests
  - 36 plc_utils tests (serialise, uint16, offline buffer, chat queue)
  - 25 diagnostic integration tests
  - 69 PGN decoder tests (all imperial units verified)
  - 24 j1939_sensor tests (config, readings, do_command, resilience)
  - 24 OBD2 poller tests (PID formulas, bus tracking, integration)
  - 31 PGN integration tests
- [x] **Test fixes applied**:
  - All PGN decoder tests updated from metric (°C, kPa, km/h) to imperial (°F, PSI, mph)
  - DM1 lamp bit ordering corrected to match J1939 standard
  - OBD2 tests updated for imperial field names
  - Mock fixtures fixed for `can` module (FakeMsg, tx_bus mock)
  - Import paths updated after module splits (plc_utils, plc_offline)
- [x] **Test runner**: scripts/run-all-tests.sh
- [x] **Dashboard build**: verified clean after all changes

## What's NOT Done Yet

### Priority 1 — Wire j1939_sensor.py to Sub-Modules (HIGHEST PRIORITY)

The sub-modules exist but j1939_sensor.py (2268 lines) has NOT been updated to import from them. The code is still duplicated. This is the single most important remaining task:

| Sub-module | Lines | Contains |
|-----------|-------|----------|
| j1939_can.py | 649 | CAN bus management, listener, bitrate negotiation, _start_listener, _listen_loop |
| j1939_dtc.py | 214 | _SA_SUFFIX, _apply_namespaced_dtcs, _clear_dtcs |
| j1939_discovery.py | 489 | Protocol auto-detect, VIN reading/caching, vehicle profiles, PGN/PID discovery |

**How to wire it:**
1. Read j1939_sensor.py and each sub-module carefully
2. Replace duplicated methods in j1939_sensor.py with imports/calls to sub-modules
3. Run `python3 -m pytest modules/j1939-sensor/tests/ -v` — all 148 tests must pass
4. Target: j1939_sensor.py under 500 lines (orchestrator only)

### Priority 2 — Remaining Files Over 500 Lines

| File | Lines | Action |
|------|-------|--------|
| j1939_sensor.py | 2,268 | Wire to sub-modules (Priority 1 above) |
| plc_sensor.py | 1,300 | Extract more methods to plc_utils/plc_offline/new sub-modules |
| pgn_decoder.py | 871 | Already imports from sub-modules, could extract more PGN groups |
| TruckPanel.tsx | 811 | Extract gauge sections, header, connection status into sub-components |
| ironsight-server.py | 638 | 390 Python + 248 HTML template — may be hard to split further |
| diagnostics.py | 532 | Optional: split into detector plugins per category |

### Priority 3 — OBD2 Separation
- Create `modules/obd2-sensor/` as separate Viam module
- Move obd2_poller.py + obd2_pids.py + obd2_dtc.py + obd2_diagnostics.py
- Extract shared code to `modules/common/` (vehicle_profiles.py)
- Remove OBD-II routing from j1939_sensor.py (~400 lines)
- Create new run.sh, meta.json, requirements.txt

### Priority 4 — Features
- **Auth**: Install @clerk/nextjs, uncomment middleware, wrap layout
- **Dev diagnostics + Claude Dev AI**: Register Inspector, /api/ai-dev-chat
- **Logging**: JSON structured logging, remaining request timing
- **Pi consolidation**: Move CAN HAT to Pi 5, merge configs

## Research Decisions (Reference)
- **OBD2**: Separate module in same repo (`modules/obd2-sensor/`)
- **iOS**: PWA first, Capacitor wrap later if App Store needed
- **Auth**: Clerk with 4 roles (admin/mechanic/driver/viewer)
- **Fleet**: One Vercel app, FLEET_TRUCKS env var, Vercel KV caching (future)
- **Pi**: Consolidate to Pi 5 only, CAN HAT works with zero config changes
- **DTC clearing**: DM11 is safe, needs interface toggle + 0xF9 source address
- **All readings**: US imperial (°F, PSI, mph, miles, gallons)

## How to Pick Up

```bash
# 1. Check branch status
git checkout claude/code-review-suggestions-RiQah
git log --oneline -5

# 2. Verify everything works
cd dashboard && npx next build
cd .. && python3 -m pytest modules/plc-sensor/tests/ -v
python3 -m pytest modules/j1939-sensor/tests/ -v

# 3. FIRST: Wire j1939_sensor.py to import from sub-modules
#    - Read j1939_sensor.py (2268 lines)
#    - Read j1939_can.py, j1939_dtc.py, j1939_discovery.py
#    - Replace duplicated code with imports
#    - Run tests: python3 -m pytest modules/j1939-sensor/tests/ -v (148 must pass)
#    - Target: j1939_sensor.py under 500 lines

# 4. Then: plc_sensor.py further extraction, TruckPanel.tsx split
# 5. Then: OBD2 separation, then remaining features
```
