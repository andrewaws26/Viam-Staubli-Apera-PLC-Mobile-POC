-- 011_pto_balance_fix.sql
-- Fix pto_balances schema to match API expectations.
-- Original migration 006 created only vacation_hours/sick_hours/personal_hours.
-- The API expects _total/_used columns for proper balance tracking.

-- Add the _total and _used columns the API expects
ALTER TABLE pto_balances
  ADD COLUMN IF NOT EXISTS vacation_hours_total NUMERIC(6,2) NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS vacation_hours_used  NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sick_hours_total     NUMERIC(6,2) NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS sick_hours_used      NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS personal_hours_total NUMERIC(6,2) NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS personal_hours_used  NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS user_name            TEXT;

-- Migrate any existing data from old columns to new _total columns
UPDATE pto_balances
SET vacation_hours_total = vacation_hours,
    sick_hours_total     = sick_hours,
    personal_hours_total = personal_hours
WHERE vacation_hours IS NOT NULL
  AND vacation_hours != 0;

-- Drop the old columns (no longer referenced by API code)
ALTER TABLE pto_balances
  DROP COLUMN IF EXISTS vacation_hours,
  DROP COLUMN IF EXISTS sick_hours,
  DROP COLUMN IF EXISTS personal_hours;
