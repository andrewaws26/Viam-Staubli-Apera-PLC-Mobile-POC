-- Migration 039: Company Settings
-- Single-row company configuration table for the setup wizard.
-- The singleton index ensures exactly one company record exists.

CREATE TABLE IF NOT EXISTS company_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name  TEXT NOT NULL DEFAULT '',
  address_line1 TEXT DEFAULT '',
  address_line2 TEXT DEFAULT '',
  city          TEXT DEFAULT '',
  state         TEXT DEFAULT '',
  zip           TEXT DEFAULT '',
  phone         TEXT DEFAULT '',
  email         TEXT DEFAULT '',
  website       TEXT DEFAULT '',
  ein           TEXT DEFAULT '',
  industry      TEXT DEFAULT '',
  logo_url      TEXT DEFAULT '',

  -- Accounting
  fiscal_year_start_month INTEGER DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  accounting_method TEXT DEFAULT 'accrual'
    CHECK (accounting_method IN ('cash', 'accrual')),

  -- Setup wizard state
  setup_completed    BOOLEAN DEFAULT false,
  setup_completed_at TIMESTAMPTZ,
  setup_completed_by TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Only one company record allowed
CREATE UNIQUE INDEX IF NOT EXISTS company_settings_singleton
  ON company_settings ((true));
