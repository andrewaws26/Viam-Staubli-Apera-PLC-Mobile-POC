-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 007: Complete Timesheet Sections + Platform Foundation Tables
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Part 1: Extends the timesheet system to match the full B&B Metals weekly
--         work report — every section from the old system, now as structured
--         relational tables (not JSONB) so each domain is independently
--         queryable for reporting, financials, IFTA compliance, etc.
--
-- Part 2: Adds platform-level tables for the IronSight Company OS —
--         a polymorphic documents table and a unified activity feed that
--         support cross-domain data linking as new modules (financials,
--         legal, documentation) are added.
--
-- Depends on: migration_005_timesheets (timesheets, timesheet_daily_logs)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 1: ADDITIONAL TIMESHEET FIELDS & SECTIONS
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1A. Extend existing timesheets table
-- ─────────────────────────────────────────────────────────────────────────────
-- Norfolk Southern requires a job code when selected as the railroad.
-- IFTA odometer readings are per-timesheet (start/end for the week).

ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS norfolk_southern_job_code TEXT,
  ADD COLUMN IF NOT EXISTS ifta_odometer_start INTEGER,
  ADD COLUMN IF NOT EXISTS ifta_odometer_end INTEGER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1B. Extend daily logs with lunch, semi truck travel fields
-- ─────────────────────────────────────────────────────────────────────────────
-- The old system tracks lunch break duration and semi truck travel details
-- per daily log entry.

ALTER TABLE timesheet_daily_logs
  ADD COLUMN IF NOT EXISTS lunch_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS semi_truck_travel BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS traveling_from TEXT,
  ADD COLUMN IF NOT EXISTS destination TEXT,
  ADD COLUMN IF NOT EXISTS travel_miles NUMERIC(8,1);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1C. Railroad Timecards
-- ─────────────────────────────────────────────────────────────────────────────
-- Documentation of railroad time cards with supervisor info and photo evidence.
-- Required by some railroads for billing reconciliation.

CREATE TABLE IF NOT EXISTS timesheet_railroad_timecards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id      UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  railroad          TEXT NOT NULL,
  track_supervisor  TEXT,
  division_engineer TEXT,
  images            JSONB NOT NULL DEFAULT '[]',  -- array of Supabase Storage URLs
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_rr_timecards_ts ON timesheet_railroad_timecards (timesheet_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1D. Equipment Inspections (linked to timesheet)
-- ─────────────────────────────────────────────────────────────────────────────
-- Vehicle inspection records with timestamped photos. The old system embeds
-- these in the timesheet. We link them so they're also queryable independently
-- for DOT compliance reporting.

CREATE TABLE IF NOT EXISTS timesheet_inspections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id    UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  inspection_time TIMESTAMPTZ NOT NULL,
  images          JSONB NOT NULL DEFAULT '[]',  -- array of Supabase Storage URLs
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_inspections_ts ON timesheet_inspections (timesheet_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1E. IFTA Entries (International Fuel Tax Agreement)
-- ─────────────────────────────────────────────────────────────────────────────
-- Per-state fuel tax reporting. Odometer start/end live on the timesheet.
-- Each entry tracks miles driven and gallons purchased in a specific state.
-- Critical for DOT compliance and quarterly IFTA filing.

CREATE TABLE IF NOT EXISTS timesheet_ifta_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id     UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  state_code       TEXT NOT NULL,  -- 2-letter state abbreviation
  reportable_miles NUMERIC(10,1) NOT NULL DEFAULT 0,
  gallons_purchased NUMERIC(10,3) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_ifta_ts ON timesheet_ifta_entries (timesheet_id);
CREATE INDEX IF NOT EXISTS idx_ts_ifta_state ON timesheet_ifta_entries (state_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1F. Expenses
-- ─────────────────────────────────────────────────────────────────────────────
-- Expense tracking with receipt capture and categorization. Supports
-- reimbursement workflow and links fuel purchases to specific vehicles
-- for fleet cost allocation.
--
-- Categories match the old system: Fuel, Safety, Repairs & Maintenance,
-- Parts, Parking, Lodging/Hotels, Travel, Supplies, MGT approved, Other.

CREATE TABLE IF NOT EXISTS timesheet_expenses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id          UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  expense_date          DATE NOT NULL,
  amount                NUMERIC(10,2) NOT NULL,
  category              TEXT NOT NULL,
  description           TEXT,
  needs_reimbursement   BOOLEAN NOT NULL DEFAULT false,
  payment_type          TEXT NOT NULL DEFAULT 'credit' CHECK (payment_type IN ('cash', 'credit')),
  receipt_image_url     TEXT,           -- Supabase Storage URL
  -- Fuel-specific fields
  is_fuel               BOOLEAN NOT NULL DEFAULT false,
  fuel_vehicle_type     TEXT CHECK (fuel_vehicle_type IN ('chase', 'semi')),
  fuel_vehicle_number   TEXT,
  odometer_image_url    TEXT,           -- Supabase Storage URL
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_expenses_ts ON timesheet_expenses (timesheet_id);
CREATE INDEX IF NOT EXISTS idx_ts_expenses_category ON timesheet_expenses (category);
CREATE INDEX IF NOT EXISTS idx_ts_expenses_date ON timesheet_expenses (expense_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1G. Maintenance Time
-- ─────────────────────────────────────────────────────────────────────────────
-- Time spent on vehicle/equipment maintenance with parts tracking.
-- Feeds into maintenance cost reporting and parts inventory.

CREATE TABLE IF NOT EXISTS timesheet_maintenance_time (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id   UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  log_date       DATE NOT NULL,
  start_time     TIME NOT NULL,
  stop_time      TIME NOT NULL,
  hours_worked   NUMERIC(5,2),  -- auto-computed from start/stop
  description    TEXT NOT NULL,
  parts_used     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_maintenance_ts ON timesheet_maintenance_time (timesheet_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1H. Shop Time
-- ─────────────────────────────────────────────────────────────────────────────
-- Time spent working in the shop (non-field, non-maintenance work).
-- Tracks clock in/out and lunch break duration.

CREATE TABLE IF NOT EXISTS timesheet_shop_time (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id   UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  log_date       DATE NOT NULL,
  start_time     TIME NOT NULL,
  stop_time      TIME,
  lunch_minutes  INTEGER NOT NULL DEFAULT 0,
  hours_worked   NUMERIC(5,2),  -- auto-computed: (stop - start) - lunch
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_shop_time_ts ON timesheet_shop_time (timesheet_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1I. Mileage Pay
-- ─────────────────────────────────────────────────────────────────────────────
-- Personal vehicle mileage reimbursement entries.
-- Tracks origin/destination, miles, and associated vehicle.

CREATE TABLE IF NOT EXISTS timesheet_mileage_pay (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id     UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  log_date         DATE NOT NULL,
  traveling_from   TEXT NOT NULL,
  destination      TEXT NOT NULL,
  miles            NUMERIC(8,1) NOT NULL,
  chase_vehicle    TEXT,
  description      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_mileage_ts ON timesheet_mileage_pay (timesheet_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1J. Flight Pay
-- ─────────────────────────────────────────────────────────────────────────────
-- Compensation for travel by air to/from job sites.

CREATE TABLE IF NOT EXISTS timesheet_flight_pay (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id   UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  log_date       DATE NOT NULL,
  traveling_from TEXT NOT NULL,
  destination    TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_flight_ts ON timesheet_flight_pay (timesheet_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1K. Holiday Pay
-- ─────────────────────────────────────────────────────────────────────────────
-- Tracks holidays worked or observed during the timesheet week.

CREATE TABLE IF NOT EXISTS timesheet_holiday_pay (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_holiday_ts ON timesheet_holiday_pay (timesheet_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1L. Vacation Pay
-- ─────────────────────────────────────────────────────────────────────────────
-- Vacation time taken during the timesheet week.
-- Tracks date range and hours per day for partial-day vacations.

CREATE TABLE IF NOT EXISTS timesheet_vacation_pay (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id   UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  hours_per_day  INTEGER NOT NULL DEFAULT 8,
  total_hours    NUMERIC(5,2),  -- auto-computed: business_days × hours_per_day
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ts_vacation_ts ON timesheet_vacation_pay (timesheet_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Expense categories (reference data for consistent categorization)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS expense_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO expense_categories (name, description, sort_order) VALUES
  ('Fuel',                     'Fuel for company or personal vehicles',                         1),
  ('Safety',                   'Gloves, glasses, vest, ear plugs, hard hats',                   2),
  ('Repairs & Maintenance',    'Oil change, tire change, brakes, fluid top-off',                3),
  ('Parts',                    'Belts, hoses, pins, lights, filters, etc.',                     4),
  ('Parking',                  'Tolls, taxi, rental car, Uber',                                 5),
  ('Lodging/Hotels',           'Hotel and lodging expenses',                                    6),
  ('Travel',                   'Flights and luggage fees',                                      7),
  ('Supplies',                 'Cleaners, paper towels, grease, oils, shop supplies',           8),
  ('MGT Approved Expense',     'Manager-approved: dinner, specialty tools, high-value items',   9),
  ('Other',                    'Miscellaneous — requires description',                         10)
ON CONFLICT (name) DO NOTHING;


-- ═════════════════════════════════════════════════════════════════════════════
-- PART 2: PLATFORM FOUNDATION TABLES (IronSight Company OS)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- These tables support cross-domain data operations as the platform grows
-- to include financials, legal, documentation, and other company modules.
-- The design is intentionally generic — any future module can attach
-- documents and generate activity feed entries without schema changes.
--

-- ─────────────────────────────────────────────────────────────────────────────
-- 2A. Documents (Polymorphic File Attachments)
-- ─────────────────────────────────────────────────────────────────────────────
-- Attach files to ANY entity in the system via entity_type + entity_id.
-- Stored in Supabase Storage, tracked here for querying and access control.
--
-- entity_type values: 'timesheet', 'expense', 'pto_request', 'work_order',
--   'training_record', 'profile', 'inspection', 'maintenance', etc.
-- Future modules just add new entity_type values — no schema change needed.

CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  file_name   TEXT NOT NULL,
  file_url    TEXT NOT NULL,      -- Supabase Storage public URL
  file_size   INTEGER NOT NULL,   -- bytes
  mime_type   TEXT NOT NULL,
  description TEXT,
  tags        JSONB NOT NULL DEFAULT '[]',  -- arbitrary tags for categorization
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents (user_id);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents (created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2B. Activity Feed (Unified Timeline)
-- ─────────────────────────────────────────────────────────────────────────────
-- A unified timeline of all actions across every module. Powers:
--   • Company-wide activity dashboard
--   • Per-entity history ("what happened to this timesheet?")
--   • Per-user history ("what did this person do today?")
--   • Cross-domain insights ("show all actions this week")
--
-- This is separate from audit_log (which is security-focused).
-- Activity feed is user-facing and designed for display.

CREATE TABLE IF NOT EXISTS activity_feed (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  user_name   TEXT NOT NULL,
  action      TEXT NOT NULL,     -- 'created', 'updated', 'submitted', 'approved', etc.
  entity_type TEXT NOT NULL,     -- 'timesheet', 'pto_request', 'expense', 'work_order', etc.
  entity_id   UUID,
  summary     TEXT NOT NULL,     -- Human-readable: "Andrew submitted timesheet for week ending 4/12"
  metadata    JSONB NOT NULL DEFAULT '{}',  -- additional context (amount, status, etc.)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_feed (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_feed (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_feed (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_feed (action);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2C. Tags (Cross-Domain Categorization)
-- ─────────────────────────────────────────────────────────────────────────────
-- A flexible tagging system that can label any entity. Supports:
--   • "High priority" on work orders AND expenses
--   • "DOT compliance" on training records AND IFTA entries
--   • "Q2 2026" on timesheets AND financial reports
--   • Custom tags per company need

CREATE TABLE IF NOT EXISTS entity_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  tag         TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_entity_tags_entity ON entity_tags (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_tags_tag ON entity_tags (tag);

COMMIT;
