-- ============================================================================
-- Migration 019: Bank Reconciliation
-- ============================================================================
-- Bank accounts, imported transactions, and reconciliation sessions.
-- Enables matching bank statement transactions to journal entries.
-- ============================================================================

-- ── Bank Accounts ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bank_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,                    -- e.g. "B&B Metals Operating"
  institution     TEXT,                             -- e.g. "Republic Bank"
  account_last4   TEXT,                             -- last 4 digits only
  account_type    TEXT NOT NULL DEFAULT 'checking' CHECK (account_type IN ('checking', 'savings', 'credit_card')),
  gl_account_id   UUID NOT NULL REFERENCES chart_of_accounts(id),  -- linked GL account (1000 Cash)
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Bank Transactions ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bank_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id     UUID NOT NULL REFERENCES bank_accounts(id),
  transaction_date    DATE NOT NULL,
  description         TEXT NOT NULL,
  amount              NUMERIC(14,2) NOT NULL,       -- positive = deposit, negative = withdrawal
  type                TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('deposit', 'withdrawal', 'transfer', 'fee', 'interest', 'other')),
  reference           TEXT,                          -- check number, transaction ID
  cleared             BOOLEAN NOT NULL DEFAULT false,
  matched_je_id       UUID REFERENCES journal_entries(id),  -- matched journal entry
  reconciliation_id   UUID,                          -- set when reconciled
  import_source       TEXT,                          -- e.g. "csv_import", "manual", "plaid"
  import_hash         TEXT,                          -- for dedup on reimport
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_tx_account ON bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_date ON bank_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_bank_tx_cleared ON bank_transactions(cleared);
CREATE INDEX IF NOT EXISTS idx_bank_tx_hash ON bank_transactions(import_hash);

-- ── Reconciliation Sessions ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reconciliation_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id     UUID NOT NULL REFERENCES bank_accounts(id),
  statement_date      DATE NOT NULL,
  statement_balance   NUMERIC(14,2) NOT NULL,
  beginning_balance   NUMERIC(14,2) NOT NULL,
  cleared_deposits    NUMERIC(14,2) NOT NULL DEFAULT 0,
  cleared_withdrawals NUMERIC(14,2) NOT NULL DEFAULT 0,
  difference          NUMERIC(14,2) NOT NULL DEFAULT 0,  -- should be 0 when balanced
  status              TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  completed_by        TEXT,
  completed_by_name   TEXT,
  completed_at        TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add reconciliation_id FK now that the table exists
ALTER TABLE bank_transactions
  ADD CONSTRAINT fk_bank_tx_reconciliation
  FOREIGN KEY (reconciliation_id) REFERENCES reconciliation_sessions(id)
  ON DELETE SET NULL;

-- ── Seed: Default bank account linked to Cash (1000) ───────────────

INSERT INTO bank_accounts (name, institution, account_last4, account_type, gl_account_id)
SELECT 'B&B Metals Operating', 'Republic Bank', '4821', 'checking', id
FROM chart_of_accounts WHERE account_number = '1000'
ON CONFLICT DO NOTHING;
