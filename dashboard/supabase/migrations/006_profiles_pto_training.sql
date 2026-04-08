-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 006: Employee Profiles, Training Compliance, PTO, Per Diem
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Part of IronSight Company OS. Extends Clerk auth with company-specific HR
-- fields, safety/compliance tracking, time-off management, and per diem
-- auto-calculation from timesheet data.
--
-- Tables created:
--   employee_profiles     — Company-specific user fields (phone, emergency, etc.)
--   training_requirements — What certifications/training the company requires
--   training_records      — Individual completion records with expiry tracking
--   pto_balances          — Available PTO hours per user per year
--   pto_requests          — Time-off requests with approval workflow
--   per_diem_rates        — Configurable daily/layover rates
--   per_diem_entries      — Auto-calculated entries linked to timesheets
--
-- Depends on: migration_005_timesheets (timesheets table for FK)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EMPLOYEE PROFILES
-- ─────────────────────────────────────────────────────────────────────────────
-- Extends Clerk user data with company-specific fields. Clerk stores the basics
-- (name, email, avatar) — this table adds phone, emergency contact, hire date,
-- job title, department, and a dedicated profile picture URL.
--
-- Design decisions:
--   • user_name/user_email denormalized from Clerk for display without API call
--   • One profile per Clerk user_id (UNIQUE constraint)
--   • profile_picture_url points to Supabase Storage (bucket: profile-pictures)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_profiles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 TEXT NOT NULL UNIQUE,
  user_name               TEXT NOT NULL,
  user_email              TEXT NOT NULL,
  phone                   TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  hire_date               DATE,
  job_title               TEXT,
  department              TEXT,
  profile_picture_url     TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON employee_profiles (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TRAINING COMPLIANCE
-- ─────────────────────────────────────────────────────────────────────────────
-- Two-table design: requirements define WHAT training exists company-wide,
-- records track WHO completed WHAT and WHEN.
--
-- Compliance logic (computed in application layer):
--   • current:       latest record exists AND expiry_date > today
--   • expiring_soon: expiry_date within 30 days
--   • expired:       expiry_date < today
--   • missing:       no record exists for a required training
--   • is_compliant:  all required + active trainings are "current"
--
-- frequency_months = NULL means one-time certification (never expires).
-- expiry_date on records = completed_date + frequency_months (app-computed).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS training_requirements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL UNIQUE,
  description      TEXT,
  frequency_months INT,
  is_required      BOOLEAN NOT NULL DEFAULT true,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL,
  user_name        TEXT NOT NULL,
  requirement_id   UUID NOT NULL REFERENCES training_requirements(id) ON DELETE CASCADE,
  completed_date   DATE NOT NULL,
  expiry_date      DATE,
  certificate_url  TEXT,
  notes            TEXT,
  recorded_by      TEXT NOT NULL,
  recorded_by_name TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_records_user    ON training_records (user_id);
CREATE INDEX IF NOT EXISTS idx_training_records_req     ON training_records (requirement_id);
CREATE INDEX IF NOT EXISTS idx_training_records_expiry  ON training_records (expiry_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PTO (PAID TIME OFF)
-- ─────────────────────────────────────────────────────────────────────────────
-- Balances track available hours per category per year.
-- Requests follow an approval workflow: pending → approved/rejected/cancelled.
--
-- Workflow rules (enforced in application layer):
--   • Employee creates request (pending)
--   • Manager approves or rejects (approved/rejected)
--   • Employee can cancel own pending request (cancelled)
--   • Approved requests deduct from balance
--   • Rejected/cancelled requests do not affect balance
--
-- hours_requested is the total hours for the date range (not per-day).
-- The app computes business days × 8 as a default, user can override.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pto_balances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  year            INT NOT NULL,
  vacation_hours  NUMERIC(6,2) NOT NULL DEFAULT 0,
  sick_hours      NUMERIC(6,2) NOT NULL DEFAULT 0,
  personal_hours  NUMERIC(6,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, year)
);

CREATE INDEX IF NOT EXISTS idx_pto_balances_user_year ON pto_balances (user_id, year);

CREATE TABLE IF NOT EXISTS pto_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT NOT NULL,
  user_name        TEXT NOT NULL,
  user_email       TEXT NOT NULL,
  request_type     TEXT NOT NULL CHECK (request_type IN ('vacation', 'sick', 'personal', 'bereavement', 'other')),
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  hours_requested  NUMERIC(6,2) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reason           TEXT,
  manager_notes    TEXT,
  approved_by      TEXT,
  approved_by_name TEXT,
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pto_requests_user   ON pto_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_pto_requests_status ON pto_requests (status);
CREATE INDEX IF NOT EXISTS idx_pto_requests_dates  ON pto_requests (start_date, end_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PER DIEM
-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-calculated from timesheet nights_out and layovers fields.
-- Rates are configurable with effective dates so historical calculations
-- remain accurate when rates change.
--
-- Flow: when a timesheet is approved, the API creates/updates a per_diem_entry
-- using the active rate at that time. If the timesheet is un-approved, the
-- entry is removed.
--
-- per_diem_entries.timesheet_id FK ensures entries are cleaned up if a
-- timesheet is deleted.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS per_diem_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  daily_rate     NUMERIC(8,2) NOT NULL,
  layover_rate   NUMERIC(8,2) NOT NULL,
  effective_date DATE NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS per_diem_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id   UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL,
  rate_id        UUID NOT NULL REFERENCES per_diem_rates(id),
  nights_count   INT NOT NULL DEFAULT 0,
  layover_count  INT NOT NULL DEFAULT 0,
  nights_amount  NUMERIC(8,2) NOT NULL DEFAULT 0,
  layover_amount NUMERIC(8,2) NOT NULL DEFAULT 0,
  total_amount   NUMERIC(8,2) NOT NULL DEFAULT 0,
  week_ending    DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(timesheet_id)
);

CREATE INDEX IF NOT EXISTS idx_per_diem_entries_user ON per_diem_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_per_diem_entries_week ON per_diem_entries (week_ending);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SEED DATA
-- ─────────────────────────────────────────────────────────────────────────────

-- Training requirements typical for railroad/industrial field operations.
-- OSHA, FRA, DOT, and trade-specific certifications.
INSERT INTO training_requirements (name, description, frequency_months, is_required) VALUES
  ('OSHA 10-Hour',              'OSHA 10-hour general industry safety certification',                          NULL, true),
  ('OSHA 30-Hour',              'OSHA 30-hour construction/general industry certification',                    NULL, false),
  ('First Aid / CPR / AED',     'American Red Cross or equivalent first aid and CPR certification',            24,   true),
  ('Railroad Safety (GCOR)',    'General Code of Operating Rules — required for all railroad ROW work',        12,   true),
  ('Hazmat Awareness',          'DOT hazardous materials awareness training per 49 CFR 172.704',               36,   true),
  ('Confined Space Entry',      'OSHA 1910.146 permit-required confined space entry and rescue procedures',    12,   true),
  ('Fall Protection',           'OSHA 1926.503 fall protection training for work at heights >6 ft',            12,   true),
  ('Forklift Certification',    'OSHA 1910.178 powered industrial truck operator training',                    36,   false),
  ('CDL Medical Card',          'DOT physical examination and medical certificate per FMCSA 391.41',           24,   true),
  ('Roadway Worker Protection', 'FRA roadway worker on-track safety per 49 CFR 214',                          12,   true),
  ('Flagging / Flagger',        'ATSSA or state-equivalent traffic control and flagging certification',        36,   false),
  ('Crane / Rigging Safety',    'Crane signaling, rigging awareness, and load calculation training',           12,   false)
ON CONFLICT (name) DO NOTHING;

-- Default per diem rates (based on GSA federal per diem schedule).
-- daily_rate = per night out, layover_rate = per layover day.
INSERT INTO per_diem_rates (name, daily_rate, layover_rate, effective_date, is_active) VALUES
  ('Standard Field Rate 2024', 59.00, 79.00, '2024-01-01', true)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. STORAGE BUCKET (informational — created via Supabase Storage API)
-- ─────────────────────────────────────────────────────────────────────────────
-- The profile-pictures bucket is created by the API route on first upload.
-- Public access is enabled so URLs can be used directly in <img> tags.
-- Bucket name: 'profile-pictures'
-- Max file size: 5MB
-- Allowed MIME types: image/jpeg, image/png, image/webp

COMMIT;
