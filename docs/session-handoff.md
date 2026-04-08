# Session Handoff: Pi Consolidation, Self-Healing & Field Test Prep

**Date**: 2026-04-08
**Branch**: `claude/plan-tasks-mbASf` (latest)
**Status**: Pi 5 consolidation complete. Self-healing system built. Dev mode with sensor diagnostics. Per-truck sim. Network auto-negotiation. Field test logging. Ready for merge and first field test.

## Team Chat System (Added 2026-04-07)

Contextual team chat anchored to domain entities. Branch: `claude/add-chat-feature-Uzld3`.

**What's working in v1:**
- Entity-anchored threads (truck, work order, DTC, direct message)
- Auto-thread creation when opening truck panel or DTC
- Sensor snapshot attachment on messages (auto-attached from truck panel)
- @ai mention in any thread triggers AI diagnostic response
- Domain-specific reactions (thumbs_up, wrench, checkmark, eyes)
- Full CRUD: send, edit, soft-delete messages
- Thread membership management
- Unread count tracking
- Push notifications to thread members
- Dashboard: /chat page with split layout, TruckChatTab in TruckPanel, Chat nav link
- Mobile: Chat tab, ChatListScreen, ThreadScreen, NewDMScreen, Zustand store
- 21 unit tests, Playwright E2E test suite

**Known limitations / v2 candidates:**
- Uses polling (3s/5s) — upgrade to Supabase Realtime for true real-time
- No voice messages
- No photo annotation (drawing on images)
- No daily digest emails
- No @role mentions (e.g., @mechanics)
- No unified search across threads
- No file upload (photos are URL references only)
- Work order status change system messages are TODO (noted in chat-system-messages.ts)

## Current State Summary

| Metric | Value |
|--------|-------|
| Python tests | **297 passing** (148 j1939 + 149 plc) |
| Dashboard build | **Clean** (all routes compile) |
| Playwright E2E | 18 tests configured (need `npx playwright install` to run) |
| Files over 500 lines | **4 remaining** (was 20+) |
| Total commits on branch | ~40 |

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

### Priority 1 — Remaining Files Over 500 Lines

| File | Lines | Action |
|------|-------|--------|
| pgn_decoder.py | 871 | Already imports from sub-modules, could extract more PGN groups |
| j1939_sensor.py | 800 | Bitrate negotiation methods (~130 lines) could move to j1939_can.py |
| plc_sensor.py | 706 | Close to target. Could extract Modbus read logic (~200 lines) |
| ironsight-server.py | 638 | 390 Python + 248 HTML template — hard to split further |
| diagnostics.py | 532 | Optional: split into detector plugins per category |

All the major splits are done. These remaining files are close to 500 or have structural reasons for their size.

### Priority 2 — OBD2 Separation
- Create `modules/obd2-sensor/` as separate Viam module
- Move obd2_poller.py + obd2_pids.py + obd2_dtc.py + obd2_diagnostics.py
- Extract shared code to `modules/common/` (vehicle_profiles.py)
- Remove OBD-II routing from j1939_sensor.py (~400 lines)
- Create new run.sh, meta.json, requirements.txt

### Pi 5 Consolidation (Done — 2026-04-08)
- [x] Merged Viam configs (viam-server.json now has all 3 modules)
- [x] Created migration script (scripts/consolidate-to-pi5.sh)
- [x] Updated fleet fragment (config/fragment-tps-truck.json) with all 3 modules
- [x] Updated fleet scripts (fleet-health.sh, fleet-sync.sh) for single-Pi
- [x] Removed top Pi health monitoring boxes from dashboard (PiHealthCard)
- [x] Removed Pi 5 health section from mobile cell tab
- [x] Updated all API routes and libs for single-machine architecture
- [x] Updated DevStatusBar and DevPage for single-Pi
- [x] Updated CLAUDE.md, README, architecture.md for single-Pi
- [x] Pi 5 kernel optimizations (CAN buffer, swappiness)
- [x] can0.service systemd unit for listen-only CAN boot

### Self-Healing System (Done — 2026-04-08)
- [x] scripts/self-heal.py — autonomous healing loop (cron every 2 min)
- [x] Tier 1 offline playbook: 6 checks (viam-server, can-bus, plc-connection, modules, disk, data-flow)
- [x] Tier 2 Claude CLI escalation (rate-limited, creates autofix/ branches)
- [x] Targeted fix mode: --check NAME for single-fix from dashboard
- [x] Heartbeat file for Pi liveness detection on dashboard
- [x] Passwordless sudo for self-heal (sudoers.d/ironsight), with password fallback
- [x] do_command("heal") on plc-sensor module — works even when PLC disconnected
- [x] POST /api/heal-command — dashboard triggers fixes via Viam Cloud WebRTC
- [x] "Fix" buttons next to each FAILED check in DevDiagnostics panel
- [x] "Run All Checks" button for full sweep

### Dev Mode & Sensor Diagnostics (Done — 2026-04-08)
- [x] DEV toggle in dashboard header (developer role only via Clerk)
- [x] DevDiagnostics panel: connection status, flagged values, hardware health
- [x] sensor-ranges.ts: value validation from J1939-71 specs and PLC hardware manual
- [x] Special 32°F/0°C default detection when engine is running
- [x] Pi heartbeat display ("Pi alive 1m ago" vs "Pi stale 10m ago")

### Per-Truck Sim & Offline Messaging (Done — 2026-04-08)
- [x] Truck 00 = Demo (always simulated), Truck 01 = Production (always live)
- [x] Removed global SIM ON/OFF toggle button
- [x] "Truck Off" connection status (gray dot) instead of red errors
- [x] Clean messaging: "Truck off — waiting for data" vs scary error states
- [x] Cell Network device sort fix (cards no longer shuffle every poll)

### Network Auto-Negotiation (Done — 2026-04-08)
- [x] plc-subnet.service reads saved state instead of hardcoded IP
- [x] Dispatcher restores last-known PLC subnet on link-up
- [x] Discovery link-up wait reduced from 3s to 1s
- [x] Discovery saves state to ~/.ironsight/plc-network.conf

### Field Test Logging (Done — 2026-04-08)
- [x] scripts/lib/field_logger.py — structured JSONL logger
- [x] scripts/health-snapshot.sh — per-minute cron for field testing
- [x] scripts/analyze-field-test.py — post-test report with recommendations
- [x] docs/pi-troubleshooting.md — SSH quick-reference for Claude CLI

### Priority 3 — Features
- **Auth**: Install @clerk/nextjs, uncomment middleware, wrap layout
- **Dev diagnostics + Claude Dev AI**: Register Inspector, /api/ai-dev-chat
- **Logging**: JSON structured logging, remaining request timing

## Research Decisions (Reference)
- **OBD2**: Separate module in same repo (`modules/obd2-sensor/`)
- **iOS**: PWA first, Capacitor wrap later if App Store needed
- **Auth**: Clerk with 4 roles (admin/mechanic/driver/viewer)
- **Fleet**: One Vercel app, FLEET_TRUCKS env var, Vercel KV caching (future)
- **Pi**: Consolidated to Pi 5 only (DONE — April 2026). CAN HAT + all modules on one Pi.
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

# 3. Major splits are DONE. Remaining work:
#    - pgn_decoder.py (871 lines) — extract more PGN decode groups
#    - j1939_sensor.py (800 lines) — bitrate negotiation to j1939_can.py
#    - OBD2 separation into modules/obd2-sensor/
#    - Auth activation (install @clerk/nextjs)
#    - iOS Capacitor wrap when needed
```
