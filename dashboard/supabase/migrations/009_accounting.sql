-- ============================================================================
-- Migration 009: Accounting Module — Chart of Accounts & Journal Entries
-- ============================================================================
-- Double-entry bookkeeping foundation for the IronSight Company OS.
--
-- Tables:
--   chart_of_accounts     — Ledger accounts (asset, liability, equity, revenue, expense)
--   journal_entries       — Transaction headers with status workflow
--   journal_entry_lines   — Debit/credit line items (must balance per entry)
--
-- Constraints:
--   - Account numbers are unique
--   - Journal entry lines must have either debit OR credit (not both, not neither)
--   - System accounts (is_system=true) cannot be deleted
--   - Voided entries retain their lines for audit trail
-- ============================================================================

-- ── Chart of Accounts ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  account_type  TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  description   TEXT,
  parent_id     UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  is_system     BOOLEAN NOT NULL DEFAULT false,
  current_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coa_type ON chart_of_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_coa_active ON chart_of_accounts(is_active);
CREATE INDEX IF NOT EXISTS idx_coa_parent ON chart_of_accounts(parent_id);

-- ── Journal Entries ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS journal_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date    DATE NOT NULL,
  description   TEXT NOT NULL,
  reference     TEXT,
  source        TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'timesheet_approved', 'per_diem', 'expense_approved', 'payroll', 'invoice', 'adjustment')),
  source_id     TEXT,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'posted', 'voided')),
  total_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  posted_at     TIMESTAMPTZ,
  voided_at     TIMESTAMPTZ,
  voided_by     TEXT,
  voided_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_je_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_je_status ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_je_source ON journal_entries(source);
CREATE INDEX IF NOT EXISTS idx_je_source_id ON journal_entries(source_id);
CREATE INDEX IF NOT EXISTS idx_je_created_by ON journal_entries(created_by);

-- ── Journal Entry Lines ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES chart_of_accounts(id),
  debit           NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit          NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description     TEXT,
  line_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Each line must have either a debit OR a credit, not both and not neither
  CONSTRAINT chk_debit_or_credit CHECK (
    (debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_jel_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines(account_id);

-- ── Seed: Standard Chart of Accounts ─────────────────────────────────
-- Standard small-business COA for a construction/industrial contractor.

INSERT INTO chart_of_accounts (account_number, name, account_type, normal_balance, is_system, description) VALUES
  -- Assets (1000-1999)
  ('1000', 'Cash',                    'asset',     'debit',  true,  'Operating cash account'),
  ('1010', 'Petty Cash',              'asset',     'debit',  false, 'Small cash on hand for field expenses'),
  ('1100', 'Accounts Receivable',     'asset',     'debit',  true,  'Money owed by customers'),
  ('1200', 'Prepaid Expenses',        'asset',     'debit',  false, 'Expenses paid in advance'),
  ('1300', 'Equipment',               'asset',     'debit',  false, 'Trucks, tools, machinery'),
  ('1310', 'Accumulated Depreciation','asset',     'debit',  false, 'Contra-asset for equipment depreciation'),
  ('1400', 'Inventory — Parts',       'asset',     'debit',  false, 'Replacement parts and supplies'),

  -- Liabilities (2000-2999)
  ('2000', 'Accounts Payable',        'liability', 'credit', true,  'Money owed to vendors'),
  ('2100', 'Payroll Payable',         'liability', 'credit', true,  'Wages earned but not yet paid'),
  ('2110', 'Per Diem Payable',        'liability', 'credit', true,  'Per diem owed to employees'),
  ('2120', 'Expense Reimbursements Payable', 'liability', 'credit', false, 'Employee expenses awaiting reimbursement'),
  ('2200', 'Accrued Liabilities',     'liability', 'credit', false, 'Other accrued obligations'),
  ('2300', 'Credit Cards Payable',    'liability', 'credit', false, 'Company credit card balances'),

  -- Equity (3000-3999)
  ('3000', 'Owner Equity',            'equity',    'credit', true,  'Owner investment and retained earnings'),
  ('3100', 'Retained Earnings',       'equity',    'credit', true,  'Accumulated net income'),

  -- Revenue (4000-4999)
  ('4000', 'Service Revenue',         'revenue',   'credit', true,  'Primary revenue from services rendered'),
  ('4010', 'Railroad Services',       'revenue',   'credit', false, 'Revenue from railroad contract work'),
  ('4020', 'Maintenance Services',    'revenue',   'credit', false, 'Revenue from equipment maintenance'),
  ('4100', 'Other Income',            'revenue',   'credit', false, 'Miscellaneous income'),

  -- Expenses (5000-9999)
  ('5000', 'Payroll Expense',         'expense',   'debit',  true,  'Employee wages and salaries'),
  ('5010', 'Payroll Tax Expense',     'expense',   'debit',  false, 'Employer payroll taxes'),
  ('5100', 'Per Diem Expense',        'expense',   'debit',  true,  'Employee per diem payments'),
  ('5200', 'Mileage Expense',         'expense',   'debit',  false, 'Employee mileage reimbursements'),
  ('5300', 'Flight Expense',          'expense',   'debit',  false, 'Employee travel flights'),
  ('5400', 'Fuel & IFTA',            'expense',   'debit',  false, 'Fuel purchases and IFTA tax'),
  ('5500', 'Equipment Maintenance',   'expense',   'debit',  false, 'Truck and equipment repairs'),
  ('5600', 'Tools & Supplies',        'expense',   'debit',  false, 'Field tools and consumable supplies'),
  ('5700', 'Insurance',               'expense',   'debit',  false, 'Business and vehicle insurance'),
  ('5800', 'Rent & Utilities',        'expense',   'debit',  false, 'Shop rent, electricity, internet'),
  ('5900', 'Office & Admin',          'expense',   'debit',  false, 'Office supplies, software, admin costs'),
  ('6000', 'Depreciation Expense',    'expense',   'debit',  false, 'Monthly equipment depreciation'),
  ('6100', 'Miscellaneous Expense',   'expense',   'debit',  false, 'Uncategorized expenses')
ON CONFLICT (account_number) DO NOTHING;

-- ── Updated_at trigger ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_accounting_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_coa_updated') THEN
    CREATE TRIGGER trg_coa_updated
      BEFORE UPDATE ON chart_of_accounts
      FOR EACH ROW EXECUTE FUNCTION update_accounting_timestamp();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_je_updated') THEN
    CREATE TRIGGER trg_je_updated
      BEFORE UPDATE ON journal_entries
      FOR EACH ROW EXECUTE FUNCTION update_accounting_timestamp();
  END IF;
END;
$$;
