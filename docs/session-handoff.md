# Session Handoff: IronSight Company OS

**Date**: 2026-04-09
**Branch**: `main` (production), `develop` (staging)
**Status**: Company OS modules live. Accounting audit & hardening complete. Multi-state payroll deployed. Comprehensive demo seed data loaded.

## Current State Summary

| Metric | Value |
|--------|-------|
| Python tests | **297 passing** (148 j1939 + 149 plc) |
| Dashboard unit tests | **1223 tests** (vitest, 28 test files) |
| Dashboard build | **Clean** (all routes compile) |
| Playwright E2E | 18 tests configured |
| Supabase migrations | **38 applied** (001–038) |
| Production | Vercel auto-deploy from `main` |

## IronSight Company OS — What's Built

### Homepage & Navigation (2026-04-08)
- **OS-style homepage** at `/` — module cards organized by category (Fleet, Operations, HR, Finance, System)
- **AppNav** shared top navigation — logo, quick links, user dropdown with sign-out
- **Dashboard header** slimmed from 17 inline links to truck-specific controls only
- Role-based visibility: operators see basic modules, managers see finance, developers see admin/dev tools
- Time-of-day greeting from Clerk user data

### Accounting Module (Full QuickBooks Replacement)
- **Double-entry bookkeeping** — Chart of Accounts (40+ accounts), Journal Entries with balanced debit/credit lines
- **AR/AP** — Invoicing with line items and payments, bill management, aging reports (30/60/90/120+ buckets)
- **Payroll** — Full payroll processing with 2026 federal/KY/FICA/FUTA/SUTA tax engine, W-4 profiles, benefits
- **Bank reconciliation** — CSV import, transaction matching, reconciliation sessions
- **Fixed assets** — Asset register with depreciation (straight-line/declining/sum-of-years), disposal with gain/loss JE
- **Estimates** — Quotes with convert-to-invoice workflow
- **Expense management** — Auto-categorization rules, credit card import with dedup, receipt OCR via Claude Vision
- **Compliance** — Form 941/940 worksheets, multi-state withholding (9 states), filing calendar, 1099 vendor tracking, sales tax, CSV exports
- **Recurring entries** — Templates with auto-generation, accounting period close/lock/reopen, year-end close
- **Budget** — Budget entry and variance analysis
- **Reports** — Trial Balance, P&L, Balance Sheet, General Ledger, Aging, Cash Flow, Budget vs Actual
- **Auto-journal entries** from timesheets (per diem, expenses), invoices, bills, payroll, depreciation, asset disposal, CC transactions
- **20+ pages**, **25+ API routes**, **17 migrations** (009–038)
- **Idempotency keys** on all financial write endpoints to prevent duplicate entries
- **AI Report Generator** — Natural language to SQL via Claude, with prompt caching, retry logic, and sandboxed exec_readonly_query

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

### Truck Snapshots
- **Point-in-time sensor captures** stored in Supabase (`truck_snapshots` table)
- Historical capture with custom timestamp for backfill
- Reading data stored as JSONB for flexible sensor payloads
- Audit-logged via `logAudit("snapshot_captured")`
- **API**: `/api/snapshots` (GET list, POST capture), `/api/snapshots/[id]` (GET individual)
- **Migration**: 031_truck_snapshots.sql

### Accounting Audit & Hardening (2026-04-09)
- **DB safety triggers** (migration 036) — JE balance enforcement on posting (min 2 lines, debits=credits, nonzero), period lock (cannot post to closed/locked periods), reconciliation lock (cannot modify completed reconciliations), audit log immutability (no UPDATE/DELETE)
- **Multi-state payroll** (migration 037) — 9 state tax configs (KY, IN, OH, TN, IL, WV, VA, MI, WI), progressive brackets for 4 states, 28 reciprocity agreements, `work_state` on employee_tax_profiles
- **SS wage base bug fix** — `tax-reports/route.ts` had hardcoded 2025 SS wage base ($168,600). Replaced all 6 hardcoded tax constants with `loadTaxConstants()` that reads from DB
- **Compliance disclaimers** — Reusable `ComplianceDisclaimer` component (payroll/tax/financial/general variants) added to 7 accounting pages
- **QB data import** — CSV import API + wizard UI for chart_of_accounts, customers, vendors with dedup, batch tracking, rollback
- **Tax CSV exports** — Export endpoint for 941, 940, state withholding, W-2 summary, 1099-NEC reports
- **Comprehensive demo seed** (migration 038) — Bank account + 30 transactions, 6 employee tax profiles, completed payroll run, 4 fixed assets with Q1 depreciation, 3 estimates, CC account + 15 transactions, 3 recurring JE templates, IRS mileage rates, GL accounts 2210–2240

### Platform Hardening (2026-04-08)
- **Auth middleware default-deny** — flipped from `/api(.*)` public to only `/api/webhooks(.*)` public
- **Supabase retry wrapper** — `withRetry()` with exponential backoff + jitter, skips 4xx
- **Circuit breaker** — 3-state Viam API breaker (closed/open/half_open), 5-failure threshold, 30s reset
- **Rate limiting** — In-memory sliding window per-key limiter; `aiMentionLimiter` (5/min) on @ai chat mentions
- **Idempotency keys** — `x-idempotency-key` header with 5-min TTL for financial endpoints (entries, invoices, payroll)
- **SQL validation** — Token-aware parser strips string literals/comments before keyword check, complexity limit (max 10 SELECTs)
- **Data quality warnings** — `DataQualityWarning[]` on shift reports for sparse data, GPS gaps, sampling issues
- **Receipt OCR hardening** — JSON structure validation + numeric coercion for parsed amounts
- **Structured logging** — `createLogger("PREFIX")` utility for consistent log formatting
- **Compound indexes** — 14 indexes for common query patterns (migration 032)

### Team Chat
- Entity-anchored threads (truck, work order, DTC, direct message)
- @ai mentions trigger Claude diagnostic response (rate-limited to 5/min per user)
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
100+ tables across 38 migrations:
- 001: Base schema (trucks, readings)
- 002: Audit, maintenance, DTCs
- 003: Work orders
- 004: Team chat (threads, messages, reactions, reads)
- 005: Timesheets + daily logs
- 006: Profiles, PTO, training, per diem
- 007: Timesheet sections + platform (documents, activity, tags)
- 008: Mobile features
- 009: Accounting (COA, journal entries)
- 010: Inventory (parts, usage)
- 011: PTO balance column fix
- 012–015: Seed data (base, training, payroll, PTO)
- 016: Accounting periods + recurring entries
- 017–018: AR/AP (invoices, bills, customers, vendors) + seed data
- 019: Bank reconciliation
- 020: Payroll tax (employee tax profiles, tax rate tables, payroll runs, benefits, workers comp)
- 021: Budgets
- 022: Fixed assets + depreciation
- 023: Estimates
- 024: Expense rules + credit card accounts
- 025: Mileage rates + payment reminders
- 026: Sales tax
- 027: nextval RPC
- 028: Saved reports
- 029: Fix readonly query
- 030: Report query log
- 031: Truck snapshots
- 032: Compound indexes (14 indexes for common query patterns)
- 033–035: Report sharing, demo seed refresh, shared links
- 036: Accounting safety triggers (balance, period lock, recon lock, audit immutability)
- 037: Multi-state payroll tax (9 states, brackets, reciprocity)
- 038: Comprehensive demo accounting seed data

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
| `/accounting` | Accounting | Full QB replacement (20+ pages) |
| `/accounting/reports` | Financial Reports | P&L, Balance Sheet, GL, Aging, Cash Flow |
| `/accounting/invoices` | Invoicing | AR with line items + payments |
| `/accounting/bills` | Bills | AP management |
| `/accounting/payroll-run` | Payroll | Full tax engine processing |
| `/accounting/receipt-ocr` | Receipt Scanner | Claude Vision OCR |
| `/accounting/tax-reports` | Tax Reports | 941/940, KY withholding, filing calendar |
| `/payroll` | Payroll Export | Export approved timesheets |
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
cd dashboard && npx vitest run          # 1178 tests
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
