-- ============================================================================
-- Migration 024: Expense Categorization Rules & Credit Card Import
-- ============================================================================
-- Auto-categorize credit card transactions using pattern-matching rules.
-- Import CC statements via CSV, review/override categories, then batch-post
-- as journal entries (DR expense / CR Credit Cards Payable).
--
-- Tables:
--   expense_categorization_rules  — Pattern rules for auto-categorizing CC transactions
--   credit_card_accounts          — Company credit card accounts (linked to GL liability)
--   credit_card_transactions      — Imported CC statement lines with categorization workflow
--
-- New GL accounts:
--   5410 Meals & Entertainment
--   5420 Travel & Lodging
--   5910 Office Supplies
-- ============================================================================

-- ── Additional GL Accounts ─────────────────────────────────────────────
-- 5400 Fuel & IFTA already exists. Add granular expense accounts for rules.

INSERT INTO chart_of_accounts (account_number, name, account_type, normal_balance, is_system, description) VALUES
  ('5410', 'Meals & Entertainment', 'expense', 'debit', false, 'Restaurant meals and business entertainment'),
  ('5420', 'Travel & Lodging',     'expense', 'debit', false, 'Hotels, airfare, and travel expenses'),
  ('5910', 'Office Supplies',      'expense', 'debit', false, 'Office supplies and consumables')
ON CONFLICT (account_number) DO NOTHING;

-- ── Expense Categorization Rules ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS expense_categorization_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  match_type    TEXT NOT NULL CHECK (match_type IN ('contains', 'starts_with', 'exact', 'regex')),
  match_pattern TEXT NOT NULL,
  category      TEXT NOT NULL,
  gl_account_id UUID REFERENCES chart_of_accounts(id),
  priority      INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ecr_active ON expense_categorization_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_ecr_priority ON expense_categorization_rules(priority DESC);

-- ── Credit Card Accounts ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credit_card_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  last_four     TEXT,
  gl_account_id UUID REFERENCES chart_of_accounts(id),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Credit Card Transactions ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credit_card_transactions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_card_account_id  UUID NOT NULL REFERENCES credit_card_accounts(id),
  transaction_date        DATE NOT NULL,
  posted_date             DATE,
  description             TEXT NOT NULL,
  amount                  NUMERIC(14,2) NOT NULL,
  category                TEXT,
  gl_account_id           UUID REFERENCES chart_of_accounts(id),
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'categorized', 'posted', 'excluded')),
  journal_entry_id        UUID REFERENCES journal_entries(id),
  import_batch            TEXT,
  duplicate_hash          TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cct_account ON credit_card_transactions(credit_card_account_id);
CREATE INDEX IF NOT EXISTS idx_cct_status ON credit_card_transactions(status);
CREATE INDEX IF NOT EXISTS idx_cct_date ON credit_card_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_cct_hash ON credit_card_transactions(duplicate_hash);
CREATE INDEX IF NOT EXISTS idx_cct_journal ON credit_card_transactions(journal_entry_id);

-- ── Updated_at triggers ────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ecr_updated') THEN
    CREATE TRIGGER trg_ecr_updated
      BEFORE UPDATE ON expense_categorization_rules
      FOR EACH ROW EXECUTE FUNCTION update_accounting_timestamp();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cct_updated') THEN
    CREATE TRIGGER trg_cct_updated
      BEFORE UPDATE ON credit_card_transactions
      FOR EACH ROW EXECUTE FUNCTION update_accounting_timestamp();
  END IF;
END;
$$;

-- ── Seed: Common Expense Rules ─────────────────────────────────────────
-- Rules are evaluated by priority DESC. Higher priority = checked first.

INSERT INTO expense_categorization_rules (name, match_type, match_pattern, category, gl_account_id, priority, is_active) VALUES
  -- Fuel (priority 90)
  ('Gas Stations — Shell',        'contains', 'SHELL',           'Fuel',             (SELECT id FROM chart_of_accounts WHERE account_number = '5400'), 90, true),
  ('Gas Stations — ExxonMobil',   'contains', 'EXXON',           'Fuel',             (SELECT id FROM chart_of_accounts WHERE account_number = '5400'), 90, true),
  ('Gas Stations — BP',           'contains', 'BP#',             'Fuel',             (SELECT id FROM chart_of_accounts WHERE account_number = '5400'), 90, true),
  ('Gas Stations — Chevron',      'contains', 'CHEVRON',         'Fuel',             (SELECT id FROM chart_of_accounts WHERE account_number = '5400'), 90, true),
  ('Gas Stations — Pilot',        'contains', 'PILOT',           'Fuel',             (SELECT id FROM chart_of_accounts WHERE account_number = '5400'), 90, true),
  ('Gas Stations — Love''s',      'contains', 'LOVE',            'Fuel',             (SELECT id FROM chart_of_accounts WHERE account_number = '5400'), 90, true),
  ('Gas Stations — TA',           'contains', 'TRAVELCENTER',    'Fuel',             (SELECT id FROM chart_of_accounts WHERE account_number = '5400'), 90, true),
  ('Gas Stations — Wawa',         'contains', 'WAWA',            'Fuel',             (SELECT id FROM chart_of_accounts WHERE account_number = '5400'), 90, true),

  -- Hotels / Lodging (priority 80)
  ('Hotels — Hilton',             'contains', 'HILTON',          'Travel & Lodging', (SELECT id FROM chart_of_accounts WHERE account_number = '5420'), 80, true),
  ('Hotels — Marriott',           'contains', 'MARRIOTT',        'Travel & Lodging', (SELECT id FROM chart_of_accounts WHERE account_number = '5420'), 80, true),
  ('Hotels — Hampton',            'contains', 'HAMPTON',         'Travel & Lodging', (SELECT id FROM chart_of_accounts WHERE account_number = '5420'), 80, true),
  ('Hotels — Holiday Inn',        'contains', 'HOLIDAY INN',     'Travel & Lodging', (SELECT id FROM chart_of_accounts WHERE account_number = '5420'), 80, true),
  ('Hotels — Best Western',       'contains', 'BEST WESTERN',    'Travel & Lodging', (SELECT id FROM chart_of_accounts WHERE account_number = '5420'), 80, true),
  ('Hotels — La Quinta',          'contains', 'LA QUINTA',       'Travel & Lodging', (SELECT id FROM chart_of_accounts WHERE account_number = '5420'), 80, true),

  -- Office Supplies (priority 70)
  ('Office — Amazon',             'contains', 'AMAZON',          'Office Supplies',  (SELECT id FROM chart_of_accounts WHERE account_number = '5910'), 70, true),
  ('Office — Staples',            'contains', 'STAPLES',         'Office Supplies',  (SELECT id FROM chart_of_accounts WHERE account_number = '5910'), 70, true),
  ('Office — Office Depot',       'contains', 'OFFICE DEPOT',    'Office Supplies',  (SELECT id FROM chart_of_accounts WHERE account_number = '5910'), 70, true),

  -- Meals (priority 60)
  ('Meals — McDonalds',           'contains', 'MCDONALD',        'Meals',            (SELECT id FROM chart_of_accounts WHERE account_number = '5410'), 60, true),
  ('Meals — Chick-fil-A',         'contains', 'CHICK-FIL',       'Meals',            (SELECT id FROM chart_of_accounts WHERE account_number = '5410'), 60, true),
  ('Meals — Subway',              'contains', 'SUBWAY',          'Meals',            (SELECT id FROM chart_of_accounts WHERE account_number = '5410'), 60, true),
  ('Meals — Cracker Barrel',      'contains', 'CRACKER BARREL',  'Meals',            (SELECT id FROM chart_of_accounts WHERE account_number = '5410'), 60, true),
  ('Meals — Waffle House',        'contains', 'WAFFLE HOUSE',    'Meals',            (SELECT id FROM chart_of_accounts WHERE account_number = '5410'), 60, true),
  ('Meals — Generic Restaurant',  'contains', 'RESTAURANT',      'Meals',            (SELECT id FROM chart_of_accounts WHERE account_number = '5410'), 50, true),

  -- Hardware / Tools (priority 65)
  ('Tools — Home Depot',          'contains', 'HOME DEPOT',      'Tools & Supplies', (SELECT id FROM chart_of_accounts WHERE account_number = '5600'), 65, true),
  ('Tools — Lowes',               'contains', 'LOWE''S',         'Tools & Supplies', (SELECT id FROM chart_of_accounts WHERE account_number = '5600'), 65, true),
  ('Tools — Harbor Freight',      'contains', 'HARBOR FREIGHT',  'Tools & Supplies', (SELECT id FROM chart_of_accounts WHERE account_number = '5600'), 65, true),

  -- Auto Parts / Maintenance (priority 65)
  ('Maintenance — AutoZone',      'contains', 'AUTOZONE',        'Equipment Maint.', (SELECT id FROM chart_of_accounts WHERE account_number = '5500'), 65, true),
  ('Maintenance — O''Reilly',     'contains', 'O''REILLY',       'Equipment Maint.', (SELECT id FROM chart_of_accounts WHERE account_number = '5500'), 65, true),
  ('Maintenance — NAPA',          'contains', 'NAPA AUTO',       'Equipment Maint.', (SELECT id FROM chart_of_accounts WHERE account_number = '5500'), 65, true)
ON CONFLICT DO NOTHING;
