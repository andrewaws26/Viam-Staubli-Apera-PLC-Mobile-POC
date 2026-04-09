-- ============================================================================
-- Migration 036: Accounting Safety Constraints
-- ============================================================================
-- Database-level enforcement for accounting integrity:
--   1. Balance enforcement — cannot post unbalanced journal entries
--   2. Period lock enforcement — cannot post to locked/closed periods
--   3. Reconciliation lock — cannot modify reconciled bank transactions
--   4. Audit log immutability — prevent deletion/modification of audit records
--
-- These constraints act as safety nets below the application layer.
-- The app already validates most of these, but DB triggers catch
-- direct SQL access, service key misuse, or app bugs.
-- ============================================================================

-- ── 1. Balance enforcement on journal entry posting ────────────────────────

CREATE OR REPLACE FUNCTION enforce_je_balance_on_post()
RETURNS TRIGGER AS $$
DECLARE
  total_debit  NUMERIC(15,2);
  total_credit NUMERIC(15,2);
  line_count   INTEGER;
BEGIN
  -- Only fire when status changes TO 'posted'
  IF NEW.status = 'posted' AND (OLD.status IS DISTINCT FROM 'posted') THEN
    SELECT
      COALESCE(SUM(debit), 0),
      COALESCE(SUM(credit), 0),
      COUNT(*)
    INTO total_debit, total_credit, line_count
    FROM journal_entry_lines
    WHERE journal_entry_id = NEW.id;

    IF line_count < 2 THEN
      RAISE EXCEPTION 'Cannot post journal entry with fewer than 2 lines (has %)', line_count;
    END IF;

    IF total_debit != total_credit THEN
      RAISE EXCEPTION 'Cannot post unbalanced journal entry: debits ($%) != credits ($%)',
        total_debit, total_credit;
    END IF;

    IF total_debit = 0 THEN
      RAISE EXCEPTION 'Cannot post journal entry with zero amounts';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_je_balance ON journal_entries;
CREATE TRIGGER trg_enforce_je_balance
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_je_balance_on_post();

-- Also enforce on INSERT (year-end close inserts directly as posted)
DROP TRIGGER IF EXISTS trg_enforce_je_balance_insert ON journal_entries;
CREATE TRIGGER trg_enforce_je_balance_insert
  BEFORE INSERT ON journal_entries
  FOR EACH ROW
  WHEN (NEW.status = 'posted')
  EXECUTE FUNCTION enforce_je_balance_on_post();


-- ── 2. Period lock enforcement ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION enforce_period_lock_on_post()
RETURNS TRIGGER AS $$
DECLARE
  period_status TEXT;
  period_label  TEXT;
BEGIN
  -- Only fire when status changes TO 'posted'
  IF NEW.status = 'posted' AND (OLD.status IS DISTINCT FROM 'posted') THEN
    SELECT status, label INTO period_status, period_label
    FROM accounting_periods
    WHERE start_date <= NEW.entry_date
      AND end_date >= NEW.entry_date
    LIMIT 1;

    -- If no period exists, allow (period may not be configured yet)
    IF period_status IS NOT NULL AND period_status IN ('closed', 'locked') THEN
      RAISE EXCEPTION 'Cannot post to % accounting period "%"',
        period_status, COALESCE(period_label, 'unknown');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_period_lock ON journal_entries;
CREATE TRIGGER trg_enforce_period_lock
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_period_lock_on_post();

DROP TRIGGER IF EXISTS trg_enforce_period_lock_insert ON journal_entries;
CREATE TRIGGER trg_enforce_period_lock_insert
  BEFORE INSERT ON journal_entries
  FOR EACH ROW
  WHEN (NEW.status = 'posted')
  EXECUTE FUNCTION enforce_period_lock_on_post();


-- ── 3. Reconciliation lock ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION lock_reconciled_transactions()
RETURNS TRIGGER AS $$
DECLARE
  recon_status TEXT;
BEGIN
  -- If transaction was reconciled (has reconciliation_id) and something changed
  IF OLD.reconciliation_id IS NOT NULL THEN
    -- Check if the reconciliation session is completed
    SELECT status INTO recon_status
    FROM reconciliation_sessions
    WHERE id = OLD.reconciliation_id;

    IF recon_status = 'completed' THEN
      -- Allow only clearing the reconciliation_id (un-reconcile) by blocking other changes
      IF NEW.amount != OLD.amount
        OR NEW.description != OLD.description
        OR NEW.transaction_date != OLD.transaction_date
        OR NEW.type != OLD.type
        OR (NEW.matched_je_id IS DISTINCT FROM OLD.matched_je_id)
      THEN
        RAISE EXCEPTION 'Cannot modify a transaction that belongs to a completed reconciliation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lock_reconciled_tx ON bank_transactions;
CREATE TRIGGER trg_lock_reconciled_tx
  BEFORE UPDATE ON bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION lock_reconciled_transactions();

-- Prevent deletion of reconciled transactions
CREATE OR REPLACE FUNCTION prevent_reconciled_delete()
RETURNS TRIGGER AS $$
DECLARE
  recon_status TEXT;
BEGIN
  IF OLD.reconciliation_id IS NOT NULL THEN
    SELECT status INTO recon_status
    FROM reconciliation_sessions
    WHERE id = OLD.reconciliation_id;

    IF recon_status = 'completed' THEN
      RAISE EXCEPTION 'Cannot delete a transaction that belongs to a completed reconciliation';
    END IF;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_reconciled_delete ON bank_transactions;
CREATE TRIGGER trg_prevent_reconciled_delete
  BEFORE DELETE ON bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_reconciled_delete();


-- ── 4. Audit log immutability ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records cannot be % — audit trail is immutable',
    LOWER(TG_OP);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_audit_update ON audit_log;
CREATE TRIGGER trg_no_audit_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_modification();

DROP TRIGGER IF EXISTS trg_no_audit_delete ON audit_log;
CREATE TRIGGER trg_no_audit_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_modification();


-- ── 5. Import batches table (for QB import tracking) ───────────────────────

CREATE TABLE IF NOT EXISTS import_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type   TEXT NOT NULL CHECK (import_type IN (
    'chart_of_accounts', 'customers', 'vendors', 'invoices', 'bills',
    'journal_entries', 'bank_transactions', 'employees'
  )),
  file_name     TEXT,
  row_count     INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count   INTEGER NOT NULL DEFAULT 0,
  errors        JSONB DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'rolled_back')),
  created_by    TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  rolled_back_at TIMESTAMPTZ,
  rolled_back_by TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_batch_type ON import_batches(import_type);
CREATE INDEX IF NOT EXISTS idx_import_batch_status ON import_batches(status);

-- Add import_batch_id to tables that support batch import
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id);
