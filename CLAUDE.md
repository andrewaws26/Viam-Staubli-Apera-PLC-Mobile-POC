# TPS Remote Monitoring System

## What this is
A fleet monitoring system for 30+ railroad trucks. Each truck has a single **Raspberry Pi 5** running all three sensor modules:
- **plc-sensor**: Reads a Click PLC C0-10DD2E-D via Modbus TCP (TPS production monitoring)
- **j1939-sensor**: Reads J1939 CAN bus for truck engine/transmission diagnostics (passive, listen-only via CAN HAT)
- **cell-sensor**: Reads Staubli robot + Apera vision (robot cell monitoring)

Data syncs to Viam Cloud at 1 Hz. A Next.js dashboard on Vercel shows live status, AI diagnostics, shift reports, and fleet overview.

**There is NO E-Cat, NO servo/robot, NO vision in this system.**

*Historical note: The system previously used a Pi Zero 2 W as a second device for J1939. This was consolidated to a single Pi 5 in April 2026 by moving the CAN HAT to the Pi 5.*

## Architecture
- **Pi → PLC**: Modbus TCP (host: 169.168.10.21, port: 502) over Ethernet
- **Pi → Cloud**: Viam SDK, captures at 1 Hz, syncs every 6 seconds
- **Dashboard → Cloud**: Next.js API routes proxy Viam credentials server-side
- **History**: Viam Data API (`exportTabularData`) for shift summaries
- **Offline**: JSONL buffer at `/home/andrew/.viam/offline-buffer/` (50MB cap)

## Key directories
- `packages/shared/src/` — Shared TypeScript types and utilities (sensor-types, auth, work-order, spn-lookup, pcode-lookup, gauge-thresholds, format, chat). Both dashboard and mobile re-export from here.
- `modules/plc-sensor/src/` — PLC sensor module: plc_sensor.py (main), plc_utils.py, plc_offline.py, plc_metrics.py, plc_weather.py, diagnostics.py, system_health.py
- `modules/j1939-sensor/src/models/` — J1939 sensor module: j1939_sensor.py (main), j1939_can.py, j1939_dtc.py, j1939_discovery.py, pgn_decoder.py, pgn_utils.py, pgn_dm1.py, obd2_poller.py, obd2_pids.py, obd2_dtc.py, obd2_diagnostics.py, vehicle_profiles.py
- `modules/cell-sensor/src/` — Cell sensor module: cell_sensor.py (main), staubli_client.py (CS9 REST API), apera_client.py (Vue socket 14040), network_monitor.py (ping devices)
- `dashboard/` — Next.js 14 app on Vercel
- `dashboard/components/` — HomeScreen (OS launcher), AppNav (shared nav), Dashboard (truck view), TruckPanel, GaugeGrid, DTCPanel, AIChatPanel, TPS/, DevTruck/, WorkBoard, Chat/
- `dashboard/components/Chat/` — Team chat UI: ThreadView, ThreadList, MessageBubble, ChatInput, SnapshotCard, ReactionBar, TruckChatTab, WorkOrderChatTab, UserPicker
- `dashboard/app/accounting/` — Chart of Accounts and journal entry management pages
- `dashboard/app/api/accounting/` — Accounting CRUD API routes (accounts, entries, trial balance)
- `dashboard/app/api/` — API routes (sensor-readings, truck-readings, fleet/status, ai-chat, ai-diagnose, ai-suggest-steps, shift-report, work-orders, team-members, chat/, etc.)
- `dashboard/app/api/chat/` — Team chat API: threads, messages, reactions, read, members, users, by-entity
- `dashboard/lib/` — Re-exports from `@ironsight/shared` (sensor-types, auth, spn-lookup, pcode-lookup, chat) + app-specific libs (supabase, audit, ai, chat-push, chat-system-messages)
- `dashboard/components/Cell/` — Robot cell monitoring: CellSection (orchestrator), StaubliPanel, AperaPanel, CellWatchdog (20+ cross-system rules), CellTypes
- `dashboard/app/api/cell-readings/` — Combined Staubli + Apera + network readings (sim mode until Pi 5 Viam module deployed)
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

# Dashboard unit tests (vitest)
cd dashboard && npx vitest run                      # includes chat + cell watchdog tests

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

## Deployed module locations (all on Pi 5)
**plc-sensor:**
- Symlink: `/opt/viam-modules/plc-sensor/src/plc_sensor.py` → repo
- Copies (must manually update): `/opt/viam-modules/plc-sensor/run.sh`, `requirements.txt`

**cell-sensor:**
- Symlinks: `/opt/viam-modules/cell-sensor/src/{cell_sensor,staubli_client,apera_client,network_monitor}.py` → repo
- Copies (must manually update): `/opt/viam-modules/cell-sensor/run.sh`, `requirements.txt`

**j1939-sensor:**
- Symlinks: `/opt/viam-modules/j1939-sensor/src/models/*.py` → repo
- Copies (must manually update): `/opt/viam-modules/j1939-sensor/exec.sh`, `requirements.txt`

After editing any module: `sudo systemctl restart viam-server`

## Dashboard
- Production: viam-staubli-apera-plc-mobile-poc.vercel.app
- Homepage: `/` — IronSight OS launcher (HomeScreen component) when no truck_id param; shows truck Dashboard when `?truck_id=XX` is present
- Navigation: AppNav (shared top bar with logo, quick links, user dropdown) replaces the old 17-link header in Dashboard.tsx
- Dev mode: viam-staubli-apera-plc-mobile-poc.vercel.app/dev
- Env vars: VIAM_API_KEY, VIAM_API_KEY_ID, VIAM_MACHINE_ADDRESS, VIAM_PART_ID (server-side) + NEXT_PUBLIC_ variants (client-side)
- Push to git **should** trigger Vercel redeploy, but the webhook is unreliable
- **If Vercel doesn't auto-deploy after push/merge:** run `cd /path/to/repo && vercel --prod --yes` from repo root (NOT from `dashboard/` — Vercel root dir is set to `dashboard/` in project settings, so running from `dashboard/` doubles the path)
- Verify deploy: `curl -s -o /dev/null -w "%{http_code}" https://viam-staubli-apera-plc-mobile-poc.vercel.app/api/cell-readings?sim=true` — should return 200

## WiFi priority (NetworkManager)
1. B&B Shop (priority 30) — primary
2. Verizon_X6JPH6 (priority 20) — fallback
3. Andrew hotspot (priority 10) — last resort

## SSH access
- Tailscale IP: 100.112.68.52 (works from any network)
- Claude Code is available on the Pi — SSH in and run `claude` in the repo dir
- Full troubleshooting guide: `docs/pi-troubleshooting.md`

## Field Test Logging

Structured JSON-lines logging captures system state for post-test analysis:

**Log file**: `/var/log/ironsight-field.jsonl`

**Enable per-minute health snapshots** (during field testing):
```bash
(crontab -l; echo "* * * * * ~/Viam-Staubli-Apera-PLC-Mobile-POC/scripts/health-snapshot.sh") | crontab -
```

**Disable after testing**:
```bash
crontab -l | grep -v health-snapshot | crontab -
```

**Analyze results**:
```bash
python3 scripts/analyze-field-test.py                    # Full report
python3 scripts/analyze-field-test.py --since "2026-04-08T10:00"  # Since timestamp
```

**Categories logged**: system health (CPU/mem/disk/throttle), service status, CAN bus (frames/listen-only), PLC connection (latency/availability), network (eth0/WiFi/internet), discovery events (timing/method), module activity (errors/readings).

**Python API** (`scripts/lib/field_logger.py`):
```python
from lib.field_logger import field_log, FieldTimer
field_log("plc", "modbus_read", success=True, duration_ms=12.5, registers=10)
with FieldTimer("network", "plc_discovery") as t:
    result = discover()
    t.set(plc_ip=result)
```

## Self-Healing System

The Pi runs autonomous self-healing every 2 minutes via cron (`scripts/self-heal.py`). Two tiers:

**Tier 1 — Offline Playbook (no internet needed):**
- viam-server down → restart service
- CAN bus down → restart can0 service, verify listen-only mode
- PLC unreachable → trigger plc-autodiscover.py
- Modules not constructing → restart viam-server
- Disk >95% → prune old capture files

**Tier 2 — Claude-assisted (needs internet, rate-limited):**
- If Tier 1 fixes fail 3 times → call Claude CLI
- Claude creates `autofix/` branch, commits fix, pushes (never to main)
- Max 3 Claude calls per hour, 20 min cooldown between calls

**Status:** Written to `/tmp/ironsight-heal-status.json`, visible in the dashboard Dev Diagnostics panel.

**Logs:** `/var/log/ironsight-self-heal.log` + structured events in `/var/log/ironsight-field.jsonl`

**Manual run:** `python3 scripts/self-heal.py --force`

## Network Auto-Discovery

When plugged into a new truck's switch, the Pi auto-negotiates:

1. **eth0 link-up** → NetworkManager dispatcher fires
2. Restores last-known PLC subnet IP from `~/.ironsight/plc-network.conf`
3. Triggers `plc-autodiscover.py` in background
4. **Discovery scans**: configured IP → Click defaults → ARP → 8 subnet sweep
5. When found: updates `viam-server.json`, sets eth0 IP, saves state, restarts viam-server
6. **Watchdog** (every 5 min) re-triggers discovery if PLC becomes unreachable

**Saved state**: `~/.ironsight/plc-network.conf` — written on every successful discovery, read on boot/link-up for instant subnet restoration.

**Manual re-discovery**: `sudo python3 scripts/plc-autodiscover.py --force`

## Rules
- **Never use DD1 for distance** — use DS10 countdown (see above)
- **Never disable listen-only mode on the CAN bus** — normal mode ACKs truck frames and triggers DTCs/warning lights. OBD-II (which needs transmit) goes on a separate device.
- **CAN bus = 250kbps J1939 only** — do not change bitrate to 500kbps or set protocol to obd2 on the truck bus
- Robot cell monitoring code (Staubli, Apera, cell watchdog) lives in `dashboard/components/Cell/` and `dashboard/app/api/cell-readings/`
- Keep dashboard mobile-friendly
- All Viam credentials stay server-side (Next.js API route), never in browser
- Always branch and PR, never push directly to main (docs excepted)
- Test with: `python3 scripts/test_plc_modbus.py` (reads live PLC)
- Build dashboard with: `cd dashboard && npm run build`

## Fleet Architecture

This repo serves a fleet of trucks. Each truck has a single **Raspberry Pi 5** running all modules:

| Component | Module | Connection | Frequency |
|-----------|--------|------------|-----------|
| plc-monitor | `modules/plc-sensor/` | Modbus TCP to Click PLC | 1 Hz |
| cell-monitor | `modules/cell-sensor/` | REST/Socket to Staubli/Apera | 0.5 Hz |
| truck-engine | `modules/j1939-sensor/` | CAN bus J1939 (listen-only) | 1 Hz |

**Pi 5** (hostname: `viam-pi`, Tailscale: `100.112.68.52`):
- Repo: `/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC`
- Tracks `origin/main`. Auto-sync runs every 10 min via cron.

**Viam machine** (org & location `djgpitarpm`):
- Machine: `staubli-pi` → components `plc-monitor`, `cell-monitor`, `truck-engine`
- Single Part ID for all data queries

**Dashboard** is on Vercel (not the Pi). Push to `main` triggers Vercel auto-deploy.

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

Machine API Key (per-truck, for direct commands)
  |-- Per-machine, used ONLY for direct commands (do_command)
  |-- Required for: DTC clear, PGN requests, bus stats
  +-- Needs WebRTC connection to specific machine

Part IDs:
  |-- VIAM_PART_ID: Single Pi 5 machine (all components: plc-monitor, cell-monitor, truck-engine)
  +-- Each truck in the fleet has a unique Part ID
```

For 30+ truck fleet, the dashboard uses a truck registry (config/fleet.json or FLEET_TRUCKS env var)
mapping truck identifiers to their Part IDs. The org-level API key queries all of them.

## Fleet Orchestration Rules

Claude is the fleet orchestrator. When making ANY change:

1. **Code changes go to git first, then deploy.** Never edit files on a Pi without committing.
2. **Service restarts are safe.** Viam-server, CAN service, and all IronSight services auto-recover.
3. **Dashboard changes** — push to git, Vercel auto-deploys. No action needed on Pi.
4. **Module changes** — `sudo systemctl restart viam-server` after code change on Pi 5.
5. **Health check** — run `/usr/local/bin/fleet-health.sh` to get JSON status.
6. **Fleet sync** — `/usr/local/bin/fleet-sync.sh` runs on cron every 10 min; can also be triggered manually.
7. **If Pi is unreachable**, check: WiFi (nmcli), Tailscale (tailscale status), power (PiSugar).
8. **If Viam is down**, check: `sudo journalctl -u viam-server -n 30`. Common fixes: restart service, check credentials, check network.
9. **If CAN bus is down**, check: `ip link show can0`, `systemctl status can0`. Common fix: `sudo systemctl restart can0`.

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

**Env vars needed:** `ANTHROPIC_API_KEY`, `VIAM_MACHINE_ADDRESS`, `VIAM_API_KEY`, `VIAM_API_KEY_ID`

## Team Chat System

Contextual team chat anchored to domain entities. Every conversation is tied to a truck, work order, DTC, or is a direct message.

**Architecture:**
- Entity-anchored threads: one thread per truck/WO/DTC, auto-created on first access
- Sensor snapshots: messages auto-attach live readings at send time (client-side)
- @ai mentions: type `@ai` in any thread to get AI diagnostic input from Claude
- Domain reactions: 4 only (thumbs_up, wrench, checkmark, eyes) — no generic emoji
- Polling: 3s for active thread, 5s for thread list (Vercel doesn't support WebSockets)
- Push notifications: Expo push to all thread members on new message

**Database tables:** `chat_threads`, `chat_thread_members`, `chat_messages`, `chat_reactions`, `message_reads` — see `dashboard/supabase/migration_004_chat.sql`

**API routes (`dashboard/app/api/chat/`):**
- `threads/` — List/create threads
- `threads/[threadId]/` — Get/update/soft-delete thread
- `threads/[threadId]/messages/` — List/send messages (with AI mention support)
- `threads/[threadId]/messages/[messageId]/` — Edit/soft-delete message
- `threads/[threadId]/reactions/` — Toggle domain reactions
- `threads/[threadId]/read/` — Mark thread as read
- `threads/[threadId]/members/` — Manage thread members
- `threads/by-entity/` — Get or auto-create thread for entity
- `users/` — List org users for DM picker

**Dashboard UI:** `/chat` page with split layout (ThreadList + ThreadView). TruckChatTab embedded in TruckPanel. WorkOrderChatTab for work orders. Chat nav link in header.

**Mobile UI:** Chat tab in bottom nav, ChatListScreen, ThreadScreen, NewDMScreen. Zustand chat-store. Push notification handling for team_chat events.

**Logging:** All chat operations logged via `console.log("[TEAM-CHAT-LOG]", ...)` — viewable in Vercel Functions logs.

**v2 candidates:** Supabase Realtime (replace polling), voice messages, photo annotation, daily digest, @role mentions, unified search.

## Timesheet System

Weekly field operations time tracking with approval workflow and 12 specialized sub-sections. Employees submit timesheets, managers approve/reject.

**Database tables:** `timesheets`, `timesheet_daily_logs`, `company_vehicles`, plus sub-section tables (`timesheet_railroad_time`, `timesheet_railroad_timecards`, `timesheet_inspections`, `timesheet_ifta`, `timesheet_expenses`, `timesheet_maintenance_time`, `timesheet_shop_time`, `timesheet_mileage_pay`, `timesheet_flight_pay`, `timesheet_holiday_pay`, `timesheet_vacation_pay`) — see `dashboard/supabase/migration_005_timesheets.sql` and `dashboard/supabase/migration_007_timesheet_sections_platform.sql`

**Shared types:** `packages/shared/src/timesheet.ts` — Timesheet, TimesheetDailyLog, all 12 sub-section types, payloads, status labels, railroad options

**API routes (`dashboard/app/api/timesheets/`):**
- `timesheets/` — List (own) / create timesheets
- `timesheets/[id]/` — Get / update / delete individual timesheet
- `timesheets/[id]/sections?section=<name>` — Sub-section CRUD (GET/POST/PATCH/DELETE for any of the 12 section types)
- `timesheets/admin/` — Manager overview with aggregated stats (developer/manager only)
- `timesheets/vehicles/` — Company vehicle reference data for dropdowns

**Dashboard pages:**
- `/timesheets` — My Timesheets list (all roles)
- `/timesheets/new` — Create new timesheet
- `/timesheets/[id]` — View/edit timesheet with all 12 sections (owner edits drafts, managers approve/reject)
- `/timesheets/admin` — Manager overview with pending approvals, employee summaries, bulk approve/reject

**12 sub-sections:**
1. Railroad Time — hours worked on railroad jobs, Norfolk Southern job code field
2. Railroad Timecards — formal timecard entries per railroad
3. Inspections — field inspection records
4. IFTA — fuel tax tracking with odometer start/end readings
5. Expenses — categorized expense line items
6. Maintenance Time — equipment maintenance hours
7. Shop Time — in-shop work hours
8. Mileage Pay — mileage-based compensation
9. Flight Pay — travel flight compensation
10. Holiday Pay — holiday hours
11. Vacation Pay — vacation hours used
12. Daily Logs — start/end time, hours, travel, description per day, lunch_minutes, semi truck travel fields

**Workflow:** draft → submitted → approved/rejected. Rejected timesheets can be edited and resubmitted. Managers can also withdraw submissions.

**Fields per timesheet:** week ending date, railroad working on, chase vehicles, semi trucks, work location, nights out, layovers, co-workers, notes.

**Roles:**
- All roles: create/view/submit own timesheets
- Manager/developer: view all timesheets, approve/reject, admin overview
- Audit logged: all create/submit/approve/reject actions

## Employee Profiles & Training

Employee profiles extend Clerk auth with company-specific HR fields. Training compliance tracks certifications and expiry dates.

**Database tables:** `employee_profiles`, `training_requirements`, `training_records` — see `dashboard/supabase/migration_006_profiles_pto_training.sql`

**Shared types:** `packages/shared/src/profile.ts`, `packages/shared/src/training.ts`

**API routes:**
- `profiles/` — GET own (auto-create), PATCH update, upload picture
- `profiles/[userId]/` — GET any user's profile
- `profiles/upload/` — POST base64 image to Supabase Storage
- `training/` — GET own records with compliance status
- `training/requirements/` — GET all active requirements
- `training/admin/` — GET compliance matrix, POST/DELETE records (manager+)

**Dashboard pages:** `/profile`, `/training`, `/training/admin`

**Training compliance logic:** current (not expired), expiring_soon (within 30 days), expired, missing. User is "compliant" when all required+active trainings are current.

## PTO (Paid Time Off)

Time-off request workflow with balance tracking.

**Database tables:** `pto_balances`, `pto_requests` — see `dashboard/supabase/migration_006_profiles_pto_training.sql`

**Shared types:** `packages/shared/src/pto.ts`

**API routes:**
- `pto/` — GET own requests, POST create (pending)
- `pto/[id]/` — GET, PATCH status transitions, DELETE
- `pto/admin/` — GET all requests + stats (manager+)
- `pto/balance/` — GET own balance (auto-create), PATCH adjust (manager+)

**Workflow:** pending → approved/rejected/cancelled. Approved requests deduct from balance. Default balances: 80h vacation, 40h sick, 24h personal.

## Per Diem

Auto-calculated from timesheet nights_out and layovers when timesheets are approved.

**Database tables:** `per_diem_rates`, `per_diem_entries` — see `dashboard/supabase/migration_006_profiles_pto_training.sql`

**API routes:** `per-diem/`, `per-diem/rates/`

## Accounting Module

Full QuickBooks replacement for the IronSight Company OS. Double-entry bookkeeping with AR/AP, invoicing, payroll, fixed assets, and compliance reporting — all integrated with timesheets, per diem, fleet, and expenses.

**Database migrations (dashboard/supabase/migrations/):**
- `009_accounting.sql` — chart_of_accounts, journal_entries, journal_entry_lines
- `010_ar_ap.sql` — customers, vendors, invoices, invoice_line_items, invoice_payments, bills, bill_line_items, bill_payments
- `011_bank_reconciliation.sql` — bank_accounts, bank_transactions, reconciliation_sessions
- `014_accounting_periods.sql` — accounting_periods, recurring_journal_entries
- `020_payroll_tax.sql` — employee_tax_profiles, tax_rate_tables (2026 federal/KY/FICA/FUTA), payroll_runs, payroll_run_lines, benefit_plans, employee_benefits, workers_comp_classes
- `021_budgets.sql` — budgets (fiscal_year, account_id, period, budgeted_amount)
- `022_fixed_assets.sql` — fixed_assets, depreciation_entries, GL accounts 1300/1310/6000/6010
- `023_estimates.sql` — estimates, estimate_line_items, estimate_number_seq
- `024_expense_rules_cc.sql` — expense_categorization_rules, credit_card_accounts, credit_card_transactions
- `025_mileage_rates.sql` — mileage_rates (IRS 2025-2026), payment_reminders
- `026_sales_tax.sql` — sales_tax_rates, sales_tax_exemptions, sales_tax_collected

**Shared types:** `packages/shared/src/accounting.ts` — Account, JournalEntry, JournalEntryLine, TrialBalance types + constants

**API routes (`dashboard/app/api/accounting/`):**
- `accounts/` — Chart of accounts CRUD
- `entries/`, `entries/[id]/` — Journal entry lifecycle (create, post, void, delete)
- `trial-balance/` — Trial balance as-of-date
- `invoices/` — AR invoicing with line items, payments, auto-JE on send
- `bills/` — AP bills with line items, payments, auto-JE on entry
- `customers/` — Customer/vendor management
- `bank/` — Bank accounts, CSV import, transaction matching, reconciliation
- `recurring/` — Recurring JE templates with auto-generation
- `periods/` — Accounting period close/lock/reopen, year-end close
- `general-ledger/` — GL report with running balances per account
- `aging/` — AR/AP aging in 30/60/90/120+ day buckets
- `cash-flow/` — Indirect-method cash flow statement
- `budget/` — Budget CRUD + budget vs actual variance analysis
- `payroll-run/` — Full payroll processing: preview → draft → approve → post (JE + YTD)
- `employee-tax/` — Employee W-4 profiles, benefits enrollment, workers comp
- `vendor-1099/` — 1099 vendor tracking with $600 threshold detection
- `fixed-assets/` — Asset register, depreciation batch (straight-line/declining/sum-of-years), disposal with gain/loss JE
- `estimates/` — Estimates/quotes with convert-to-invoice
- `expense-rules/` — Auto-categorization rules, CC import with dedup, batch post
- `audit-trail/` — Filterable accounting audit log with category grouping
- `payment-reminders/` — Tiered overdue invoice reminders (7/30/60/90+ days)
- `mileage-rates/` — IRS mileage rate management
- `sales-tax/` — Tax rates, customer exemptions, filing period tracking
- `receipt-ocr/` — Claude Vision receipt scanning (vendor, amount, line items)
- `tax-reports/` — Form 941/940 worksheets, KY withholding, filing calendar

**Dashboard pages (`dashboard/app/accounting/`):**
- `/accounting` — COA browser + journal entries list
- `/accounting/new`, `/accounting/[id]` — Create/view journal entries
- `/accounting/invoices` — AR invoicing with PDF generation
- `/accounting/bills` — AP bill management
- `/accounting/customers` — Customer & vendor directory
- `/accounting/bank` — Bank reconciliation with CSV import
- `/accounting/recurring` — Recurring JE templates
- `/accounting/periods` — Accounting period management + year-end close
- `/accounting/payroll-run` — Payroll processing with tax calculation
- `/accounting/employee-tax` — Employee W-4, benefits, workers comp setup
- `/accounting/vendor-1099` — 1099 vendor tracking
- `/accounting/budget` — Budget entry + variance analysis
- `/accounting/fixed-assets` — Fixed asset register + depreciation
- `/accounting/estimates` — Estimates/quotes + convert to invoice
- `/accounting/expense-rules` — CC rules, import, transaction review
- `/accounting/audit-trail` — Audit log viewer with filters + CSV export
- `/accounting/payment-reminders` — Overdue invoice reminders + mileage calculator
- `/accounting/sales-tax` — Tax rates, exemptions, filing summary
- `/accounting/receipt-ocr` — Receipt scanner (Claude Vision OCR)
- `/accounting/tax-reports` — 941/940 worksheets + filing calendar
- `/accounting/reports` — P&L, Balance Sheet, GL, Aging, Cash Flow

**Chart of Accounts:** 40+ accounts across 5 types: Assets (1000-1999), Liabilities (2000-2999), Equity (3000-3999), Revenue (4000-4999), Expenses (5000-9999). Includes 1300 Fixed Assets, 1310 Accumulated Depreciation, 2100 Credit Card Payable, 5410 Meals, 5420 Travel, etc.

**Journal Entry workflow:** draft → posted → voided. Posting updates account balances. Voiding reverses balances and records reason.

**Auto-generated entries:**
- Timesheet approved with per diem → DR 5100 Per Diem Expense / CR 2110 Per Diem Payable
- Timesheet approved with expenses → DR expense accounts / CR 2120 Expense Reimbursements Payable
- Invoice sent → DR 1100 AR / CR 4010 Revenue
- Bill entered → DR Expense / CR 2000 AP
- Payroll posted → DR 5000 Payroll Expense + DR 5010 Employer Tax / CR tax liability accounts / CR 1000 Cash
- Depreciation run → DR 6000 Depreciation Expense / CR 1310 Accumulated Depreciation
- Asset disposal → DR Cash + DR 1310 Accum Depr / CR 1300 Fixed Assets ± 6010 Gain/Loss
- CC transactions posted → DR expense accounts / CR 2100 Credit Card Payable

**Payroll tax engine:** W-4 2020+ percentage method with 2026 federal progressive brackets (3 filing statuses), KY flat 4%, SS 6.2% (wage base $176,100), Medicare 1.45% (+0.9% additional over $200k), FUTA 0.6% (first $7,000), KY SUTA 2.7%.

**Roles:** Manager/developer can access all financial operations. All roles can view COA.

## Platform Foundation

Cross-domain tables for the IronSight Company OS:
- `documents` — polymorphic file attachments (entity_type + entity_id)
- `activity_feed` — unified timeline across all modules
- `entity_tags` — cross-domain categorization
- `expense_categories` — reference data for expense tracking

See `dashboard/supabase/migration_007_timesheet_sections_platform.sql`

## Data Architecture

Full data architecture documentation: `docs/data-architecture.md`

Covers all 60+ tables, data flows, security model, cost strategy, scalability plan, and future module roadmap.

## OBD-II Passenger Vehicle Support (FUTURE — SEPARATE DEVICE)

**The Pi 5 CAN bus is J1939-only.** OBD-II support will live on a separate physical device and potentially a separate repo. Do NOT configure the Pi 5 CAN interface for OBD-II — it must stay in listen-only mode at 250kbps for J1939 truck safety.

The OBD-II code remains in this repo for future use on a dedicated OBD-II device. The module auto-detects J1939 vs OBD-II based on CAN frame IDs when configured for the appropriate protocol.

**Tested and validated (on separate vehicle):** 2013 Nissan Altima — 6.6M CAN frames, zero drops, remote DTC clear successful (2026-03-29). SPI CAN HAT (MCP2515) confirmed production-ready.

**OBD-II features:** 33 PIDs (all imperial units), DTC read/clear, freeze frame, readiness monitors, VIN, pending/permanent DTCs.

**The full OBD-II poller lives in `modules/j1939-sensor/src/models/obd2_poller.py`.**
This file contains ALL 33 PIDs, the OBD2DTCReader class (Mode 03/04), and the OBD2AdvancedDiag class
(freeze frame, readiness, VIN, pending/permanent DTCs). The do_command routing in j1939_sensor.py
forwards OBD-II commands to these classes. Keep this code intact for the future OBD-II device.

**All readings are US imperial:** temperatures in °F, pressures in PSI, speed in mph, distances in miles, fuel in gallons. Conversion happens in the decode lambdas, not in the dashboard.

## J1939 Truck Sensor (modules/j1939-sensor/)

Reads J1939 CAN bus data from heavy-duty trucks (2013+ Mack/Volvo) via Waveshare CAN HAT (B) on the Pi 5.
Decodes 15 PGNs: engine RPM, temperatures, pressures, vehicle speed, fuel, battery, transmission, DTCs.

**⚠️ CRITICAL: CAN Bus Safety — Listen-Only Mode Required**

The Pi 5 MUST operate in **listen-only mode** on the J1939 truck bus. In normal mode, the MCP2515 ACKs every CAN frame, which adds an unauthorized node to the truck's bus. This disrupts ECU-to-ECU communication and triggers dashboard warning lights (DTCs). Listen-only mode makes the MCP2515 completely invisible on the bus.

The `can0.service` systemd unit enforces listen-only mode on boot.

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

**Data capture** on the consolidated Pi 5 machine:
- Capture: `Readings` method at 1 Hz on `truck-engine` component
- Sync: every 6 seconds (0.1 min) to Viam Cloud
- Capture dir: `/home/andrew/.viam/capture` (persistent, survives reboot)
- Tags: `truck-diagnostics`, `ironsight`
- Config note: Viam requires `api` field only — do NOT include `type`/`namespace` alongside `api` on components or services

## Truck Networking (Field Deployment)

When on a truck (away from shop WiFi), the Pi 5 connects via cellular:

```
Cellular dongle/HAT → Pi 5 (internet)
Pi 5 → Tailscale → Viam Cloud → Dashboard
```

**Pre-configured and ready:**
- Cellular profile on Pi 5: auto-connects when USB modem/HAT is plugged in

**WiFi priorities (Pi 5):**
- Andrew-Hotspot: 40
- BB-Shop: 30 (work)
- Verizon_X6JPH6: 20 (home)
