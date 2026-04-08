-- ============================================================================
-- Migration 016: Accounting Periods & Recurring Journal Entries
-- ============================================================================
-- Adds period management (close/lock months to prevent backdating) and
-- recurring journal entry templates for automated monthly entries.
-- ============================================================================

-- ── Accounting Periods ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS accounting_periods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  label         TEXT NOT NULL,           -- e.g. "January 2026", "Q1 2026", "FY 2026"
  period_type   TEXT NOT NULL DEFAULT 'month' CHECK (period_type IN ('month', 'quarter', 'year')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'locked')),
  closed_by     TEXT,                    -- Clerk user ID
  closed_by_name TEXT,
  closed_at     TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date),
  CONSTRAINT unique_period UNIQUE (start_date, end_date, period_type)
);

-- Seed monthly periods for 2026
INSERT INTO accounting_periods (start_date, end_date, label, period_type) VALUES
  ('2026-01-01', '2026-01-31', 'January 2026', 'month'),
  ('2026-02-01', '2026-02-28', 'February 2026', 'month'),
  ('2026-03-01', '2026-03-31', 'March 2026', 'month'),
  ('2026-04-01', '2026-04-30', 'April 2026', 'month'),
  ('2026-05-01', '2026-05-31', 'May 2026', 'month'),
  ('2026-06-01', '2026-06-30', 'June 2026', 'month'),
  ('2026-07-01', '2026-07-31', 'July 2026', 'month'),
  ('2026-08-01', '2026-08-31', 'August 2026', 'month'),
  ('2026-09-01', '2026-09-30', 'September 2026', 'month'),
  ('2026-10-01', '2026-10-31', 'October 2026', 'month'),
  ('2026-11-01', '2026-11-30', 'November 2026', 'month'),
  ('2026-12-01', '2026-12-31', 'December 2026', 'month')
ON CONFLICT DO NOTHING;


-- ── Recurring Journal Entries ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recurring_journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description     TEXT NOT NULL,          -- e.g. "Monthly Shop Rent"
  reference       TEXT,                   -- optional reference
  frequency       TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'annually')),
  next_date       DATE NOT NULL,          -- next occurrence
  end_date        DATE,                   -- stop generating after this date (null = forever)
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      TEXT NOT NULL,          -- Clerk user ID
  created_by_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recurring_journal_entry_lines (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_entry_id      UUID NOT NULL REFERENCES recurring_journal_entries(id) ON DELETE CASCADE,
  account_id              UUID NOT NULL REFERENCES chart_of_accounts(id),
  debit                   NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit                  NUMERIC(14,2) NOT NULL DEFAULT 0,
  description             TEXT,
  line_order              INT NOT NULL DEFAULT 0,
  CONSTRAINT valid_amounts CHECK (debit >= 0 AND credit >= 0 AND (debit > 0 OR credit > 0))
);

-- Index for fast lookup of due recurring entries
CREATE INDEX IF NOT EXISTS idx_recurring_next_date ON recurring_journal_entries (next_date) WHERE is_active = true;
