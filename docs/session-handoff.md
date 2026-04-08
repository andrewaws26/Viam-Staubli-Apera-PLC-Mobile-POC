# Session Handoff: IronSight Company OS

**Date**: 2026-04-08
**Branch**: `main` (production), `develop` (staging)
**Status**: Company OS modules live. Homepage launched. 3 critical bugs fixed. All tests passing.

## Current State Summary

| Metric | Value |
|--------|-------|
| Python tests | **297 passing** (148 j1939 + 149 plc) |
| Dashboard unit tests | **430 passing** (vitest) |
| Dashboard build | **Clean** (all routes compile) |
| Playwright E2E | 18 tests configured |
| Supabase migrations | **11 applied** (001–011) |
| Production | Vercel auto-deploy from `main` |

## IronSight Company OS — What's Built

### Homepage & Navigation (2026-04-08)
- **OS-style homepage** at `/` — module cards organized by category (Fleet, Operations, HR, Finance, System)
- **AppNav** shared top navigation — logo, quick links, user dropdown with sign-out
- **Dashboard header** slimmed from 17 inline links to truck-specific controls only
- Role-based visibility: operators see basic modules, managers see finance, developers see admin/dev tools
- Time-of-day greeting from Clerk user data

### Accounting Module
- **Double-entry bookkeeping** — Chart of Accounts (32 seeded accounts), Journal Entries with balanced debit/credit lines
- **Trial Balance & P&L** reports at `/accounting/reports`
- **Auto-journal entries** from timesheets: per diem (DR 5100 / CR 2110), expenses (category→account mapping)
- **Workflow**: draft → posted → voided (with balance reversal)
- **Pages**: `/accounting`, `/accounting/new`, `/accounting/[id]`, `/accounting/reports`
- **API**: `/api/accounting/accounts`, `/api/accounting/entries`, `/api/accounting/trial-balance`
- **Migration**: 009_accounting.sql (applied)

### Inventory & Parts Tracking
- **Parts catalog** with categories, costs, reorder points (22 seeded heavy-duty truck parts)
- **Usage logging** linked to trucks and maintenance entries
- **Low-stock alerts** with reorder suggestions
- **Pages**: `/inventory` (catalog, usage log, alerts tabs)
- **API**: `/api/inventory`, `/api/inventory/[id]`, `/api/inventory/usage`, `/api/inventory/alerts`
- **Shared types**: `packages/shared/src/inventory.ts`
- **Migration**: 010_inventory.sql (applied)

### Payroll Export
- **Payroll admin page** at `/payroll` — date range picker, employee aggregation
- **CSV/JSON export** from approved timesheets with hours, per diem, mileage, expenses
- **API**: `/api/payroll/export`

### Timesheet Enhancements
- **Receipt photo upload** to Supabase Storage (`expense-receipts` bucket)
- **12 sub-sections** all functional on both dashboard and mobile
- **Auto-journal entries** on approval (per diem + expense JEs, voided on rejection)

### Employee Profiles & Training
- **Profile page** at `/profile` — photo upload, phone, emergency contact, hire date, job title, department
- **Training compliance** at `/training` — current/expiring/expired status badges
- **DB table**: `employee_profiles` (migration 006)

### PTO (Paid Time Off)
- **Balance tracking** per user per year (vacation, sick, personal hours)
- **Request workflow**: pending → approved/rejected/cancelled
- **Balance cards** showing remaining hours
- **DB table**: `pto_balances` with `_total`/`_used` columns (migration 011 fix applied)

### Team Chat
- Entity-anchored threads (truck, work order, DTC, direct message)
- @ai mentions trigger Claude diagnostic response
- Sensor snapshot auto-attachment
- Domain-specific reactions
- 21 unit tests

## Bugs Fixed (2026-04-08)

### Cell Sim Data Isolation (CRITICAL)
**Root cause**: `cell-readings` API always called `getDefaultTruck()` (truck "00", empty Part ID) → fell back to sim data for ALL trucks. The `_is_sim` flag check in CellSection only caught explicitly-flagged sim data, but real Viam data had no `_is_sim` field, so it passed through.

**Fix**:
- API now accepts `?truck=<id>` param, uses `getTruckById()` for correct Part ID routing
- Returns `_no_cell: true` instead of sim fallback when truck has no cell data
- CellSection passes truckId in URL, handles `_no_cell` responses
- Success path now sets `_is_sim: false` explicitly
- **9 automated tests** in `tests/unit/cell-sim-isolation.test.ts` guard this permanently

### PTO Balance "h" Display
**Root cause**: DB had columns `vacation_hours`, `sick_hours`, `personal_hours` but API expected `vacation_hours_total`, `vacation_hours_used`. Insert failed silently, error JSON was treated as balance data, React rendered `{undefined}h` as "h".

**Fix**: Migration 011 adds `_total`/`_used` columns, drops old single columns. Applied to Supabase.

### Profile "Failed to load"
**Root cause**: API queried table `"profiles"` but DB table is `"employee_profiles"`. Also column mismatches (`display_name` vs `user_name`). ProfileForm save URL was `/api/profile` (singular) instead of `/api/profiles` (plural).

**Fix**: Corrected table name, column names, and save URL.

## Architecture

### Database (Supabase)
37+ tables across 11 migrations:
- 001: Base schema (trucks, readings)
- 002: Audit, maintenance, DTCs
- 003: Work orders
- 004: Team chat (threads, messages, reactions, reads)
- 005: Timesheets + daily logs
- 006: Profiles, PTO, training
- 007: Timesheet sections + platform (documents, activity, tags)
- 008: Mobile features
- 009: Accounting (COA, journal entries)
- 010: Inventory (parts, usage)
- 011: PTO balance column fix

### Shared Package (`packages/shared/src/`)
Single source of truth for types: sensor-types, auth, work-order, spn-lookup, pcode-lookup, gauge-thresholds, chat, timesheet, profile, pto, training, per-diem, accounting, inventory, format.

### Fleet Routing
- `dashboard/lib/machines.ts` — truck registry (fleet.json → FLEET_TRUCKS env → fallback)
- Truck "00" = Demo (empty Part ID, sim data allowed)
- Truck "01" = Production (real Part ID, real data only)
- Cell-readings API routes to correct truck's Part ID

### Key Pages
| Route | Purpose | Notes |
|-------|---------|-------|
| `/` | OS Homepage | Module launcher, no truck_id = home screen |
| `/?truck_id=XX` | Truck Dashboard | Live production + diagnostics |
| `/fleet` | Fleet Overview | All trucks status |
| `/work` | Work Orders | Task management |
| `/chat` | Team Chat | Entity-anchored threads |
| `/shift-report` | Shift Reports | Production summaries |
| `/timesheets` | Time Tracking | 12 sub-sections |
| `/pto` | Time Off | Balances + requests |
| `/training` | Training | Compliance tracking |
| `/profile` | Employee Profile | HR fields + photo |
| `/accounting` | Accounting | COA + journal entries |
| `/accounting/reports` | Financial Reports | Trial Balance + P&L |
| `/payroll` | Payroll | Export approved timesheets |
| `/inventory` | Inventory | Parts catalog + alerts |
| `/vision` | Vision | Product roadmap |
| `/admin` | Admin | System settings |
| `/dev` | Dev Tools | Diagnostics + API testing |

## What's In Progress / Next

### Navigation Consistency
- AppNav added to homepage; other pages (fleet, timesheets, PTO, etc.) still have their own headers
- Should add AppNav to all pages for consistent back-to-home navigation

### Vision Page — B&B Metals Specific
- User requested: update vision page to be B&B-specific for integration pitch
- B&B Metals context: railroad TPS contractor, Shepherdsville KY, 36 Mack trucks, Norfolk Southern

### Fleet Expansion
- Currently 2 trucks (Demo + Truck 01)
- Need to add more trucks as fleet grows
- Each truck needs its own Pi 5 with Part ID in fleet.json

### Mobile App Parity
- Accounting pages added to mobile (index, detail)
- Timesheet sections component added (520 lines, 10 sub-sections)
- More mobile features may be needed as Company OS grows

## How to Pick Up

```bash
# 1. Check branch status
git checkout develop
git log --oneline -5

# 2. Verify everything works
cd dashboard && npx next build
cd dashboard && npx vitest run          # 430 tests
cd .. && python3 -m pytest modules/plc-sensor/tests/ -v    # 149 tests
python3 -m pytest modules/j1939-sensor/tests/ -v           # 148 tests

# 3. Deploy
git push origin develop                  # staging
git checkout main && git merge develop   # production
git push origin main                     # triggers Vercel
vercel --prod --yes                      # force deploy if webhook fails

# 4. Apply pending migrations
# Use Supabase API:
curl -X POST "https://api.supabase.com/v1/projects/bppztvrvaajrgyfwesoe/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT 1;"}'
```
