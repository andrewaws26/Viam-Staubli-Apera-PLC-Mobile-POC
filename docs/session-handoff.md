# Session Handoff: Code Review & Architecture Overhaul

**Date**: 2026-04-05
**Branch**: `claude/code-review-suggestions-RiQah`
**Status**: In progress — Wave 2 (file splits) running, Waves 3-4 pending

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
1. **Docs**: Updated ~55 to ~100+ in 4 doc files (9 instances)
2. **TypeScript types**: Fixed active_dtcs mismatch, vin phantom, added sync health fields, per-ECU lamp fields
3. **plc_sensor.py logging**: Added exc_info=True to 4 LOGGER.error + 5 LOGGER.warning calls
4. **j1939_sensor.py DTC fix**: 
   - Added `_SA_SUFFIX` mapping for 6 ECU source addresses
   - Added `_dtc_by_source` dict for per-ECU DTC tracking
   - Created `_apply_namespaced_dtcs()` method — namespaces DTCs by source, maintains combined count
   - Refactored lamp tracking to use suffix map (handles all 6 SAs)
   - Added older truck tolerance notes
   - Added exc_info=True to LOGGER.error calls
5. **API error logging**: Added console.error to all API route catch blocks (9+ routes)
6. **Lamp indicators**: Added check engine/MIL/amber/red/protect badges to TruckPanel header
7. **AGENTS.md**: Created comprehensive agent development guide

### Wave 2 — File Splits (In Progress)
Agents launched for:
- [ ] `pgn_decoder.py` (1,018 lines) → pgn_utils.py + pgn_dm1.py + pgn_decoder.py
- [ ] `shift-report/page.tsx` (1,111 lines) → types.ts + utils/ + components/
- [ ] `DevTPSPanel.tsx` (999 lines) → TPS/ directory with sub-components
- [ ] `plc_sensor.py` (1,827 lines) → plc_utils.py + plc_offline.py + plc_metrics.py + plc_weather.py

## What's NOT Done Yet

### Wave 2 Remaining Splits
- [ ] `j1939_sensor.py` (2,175 lines) — Split into: j1939_can.py (CAN I/O), j1939_dtc.py (DTC handling), j1939_discovery.py (vehicle profile discovery), j1939_sensor.py (orchestrator)
- [ ] `ironsight-touch.py` (2,085 lines) — Split into touch_ui/ with screens/, widgets/
- [ ] `ironsight-discover.py` (1,281 lines) — Split into discovery/ package
- [ ] `plc-autodiscover.py` (951 lines) — Split into autodiscover/ package
- [ ] `obd2_poller.py` (918 lines) — Split into obd2_pids.py + obd2_dtc.py + obd2_diagnostics.py
- [ ] `ironsight-server.py` (787 lines) — Split prompts into ai_analysis/prompts.py
- [ ] `DevTruckPanel.tsx` (767 lines) — Extract debug controls
- [ ] `voice_chat.py` (724 lines) — Split into voice/ package (STT, TTS, AI)
- [ ] `ironsight-analyze.py` (721 lines) — Extract unknown PLC discovery
- [ ] `ironsight-display.py` (631 lines) — Extract pages into display_ui/
- [ ] `ironsight-discovery-daemon.py` (628 lines) — Extract config updater
- [ ] `shift-report/route.ts` (614 lines) — Extract aggregation utilities
- [ ] `Dashboard.tsx` (512 lines) — Extract audio, polling, fault history
- [ ] `diagnostics.py` (532 lines) — Optional: split into detector plugins

### Wave 3 — OBD2 Separation
- [ ] Create `modules/obd2-sensor/` as separate Viam module
- [ ] Move obd2_poller.py and related code from j1939-sensor
- [ ] Extract shared code to `modules/common/` (vehicle_profiles.py)
- [ ] Remove OBD-II routing from j1939_sensor.py (~400 lines)
- [ ] Create new run.sh, meta.json, requirements.txt for obd2-sensor
- [ ] Update AGENTS.md file map

### Wave 4 — Features

#### Auth (Clerk) — ~1 week total
1. `npm install @clerk/nextjs`
2. Create `dashboard/middleware.ts` with Clerk auth
3. Wrap layout.tsx with `<ClerkProvider>`
4. Create `dashboard/lib/auth.ts` with role checking helpers
5. Add auth checks to all 14 API routes
6. Define 4 roles: admin, mechanic, driver, viewer
7. Add truck-scoped access for drivers
8. Add audit logging to command routes

#### DTC Clearing Fix
1. In j1939_sensor.py `_clear_dtcs()`:
   - Change source address from 0xFE to 0xF9 (service tool)
   - Add interface toggle wrapper: down → normal mode → send DM11 → down → listen-only
   - Wrap in try/finally to guarantee listen-only restoration
   - Add DM12 response listening (1-2s timeout)
   - Log active DTCs before clearing for audit trail
2. Test on truck with known DTCs

#### Fleet Overview
1. Create `/dashboard/app/fleet/page.tsx` — card view of all trucks
2. Add truck selector dropdown to nav
3. Implement fleet summary API route
4. Add Vercel KV caching (3s TTL per truck)
5. Add alert routing with Resend email

#### Dev Diagnostics + Claude Dev AI
1. Register Inspector component — live searchable table of 478 PLC registers
2. `/api/ai-dev-chat/route.ts` — engineering AI with full register map in system prompt
3. System Health Panel — combined Pi health + CAN stats + logs
4. Optional: SSE endpoint for real-time streaming

#### PWA
1. Add `dashboard/public/manifest.json` with app icon
2. Create service worker with cache-first (static) + stale-while-revalidate (API)
3. Add Web Push subscription for check engine alerts
4. Test on iOS Safari (16.4+ required for push)

#### Logging Improvements
1. Switch Python to JSON structured logging
2. Add request duration timing to all API routes (partially done)
3. Set up Vercel log drains
4. Add alerting on system health thresholds (CPU temp, disk, sync queue)

### Pi Consolidation (Physical Work Required)
1. Move CAN HAT from Pi Zero to Pi 5 (same dtoverlay config)
2. Copy j1939-sensor module to Pi 5
3. Merge Viam config (both components on one machine)
4. Verify can0 listen-only on Pi 5
5. Delete touch/voice files (9 files in scripts/)
6. Remove hotspot/dispatcher configs
7. Update Vercel env vars (remove TRUCK_VIAM_* duplicates)
8. Decommission Pi Zero from Viam Cloud and Tailscale

## Research Findings (Saved for Reference)

All research reports are in the conversation history. Key decisions:
- **OBD2**: Separate module in same repo (`modules/obd2-sensor/`)
- **iOS**: PWA first, Capacitor wrap later if App Store needed
- **Auth**: Clerk with 4 roles (admin/mechanic/driver/viewer)
- **Fleet**: One Vercel app, Vercel KV caching, Resend email alerts
- **Pi**: Consolidate to Pi 5 only, CAN HAT works with zero config changes
- **DTC clearing**: DM11 is safe, needs interface toggle + 0xF9 source address
- **DTC capture**: Found overwrite bug (FIXED), missing ECU sources (FIXED), need header lamp indicator (DONE)
- **Logging**: Need exc_info=True (DONE), console.error on API routes (DONE), JSON logging (TODO)

## How to Pick Up

1. Check branch status: `git log --oneline -10` on `claude/code-review-suggestions-RiQah`
2. Check if Wave 2 split agents completed: look for new files in modules/plc-sensor/src/, modules/j1939-sensor/src/models/, dashboard/components/TPS/, dashboard/app/shift-report/
3. Run `cd dashboard && npx next build` to verify dashboard compiles
4. Run `python3 -m pytest modules/plc-sensor/tests/ -v` to verify Python tests pass
5. Continue with remaining Wave 2 splits, then Wave 3 (OBD2), then Wave 4 (features)
6. Priority order: j1939_sensor.py split → OBD2 separation → Auth → DTC clearing → Fleet overview
