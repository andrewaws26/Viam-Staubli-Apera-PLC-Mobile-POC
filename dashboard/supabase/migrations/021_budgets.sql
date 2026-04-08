-- ============================================================================
-- Migration 021: Budgets
-- ============================================================================
-- Budget tracking per fiscal year, linked to chart_of_accounts.
-- Supports annual, quarterly, and monthly budget periods.
-- ============================================================================

CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year INT NOT NULL,
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
  period TEXT NOT NULL DEFAULT 'annual' CHECK (period IN ('annual', 'q1', 'q2', 'q3', 'q4', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec')),
  budgeted_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(fiscal_year, account_id, period)
);

CREATE INDEX IF NOT EXISTS idx_budgets_year ON budgets(fiscal_year);

-- Reuse the accounting updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_budgets_updated') THEN
    CREATE TRIGGER trg_budgets_updated
      BEFORE UPDATE ON budgets
      FOR EACH ROW EXECUTE FUNCTION update_accounting_timestamp();
  END IF;
END;
$$;
