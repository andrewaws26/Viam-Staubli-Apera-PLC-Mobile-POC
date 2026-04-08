-- Migration 025: Mileage Rates & Payment Reminders
-- Adds IRS mileage rate tracking and late-payment reminder scheduling.

-- ============================================================
-- Mileage Rates
-- ============================================================
CREATE TABLE IF NOT EXISTS mileage_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_date  DATE NOT NULL,
  rate_per_mile   NUMERIC(6,4) NOT NULL,
  rate_type       TEXT NOT NULL DEFAULT 'standard' CHECK (rate_type IN ('standard', 'medical', 'charitable', 'custom')),
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed IRS rates
INSERT INTO mileage_rates (effective_date, rate_per_mile, rate_type, description) VALUES
  ('2026-01-01', 0.7000, 'standard',   '2026 IRS standard mileage rate'),
  ('2025-01-01', 0.6700, 'standard',   '2025 IRS standard mileage rate'),
  ('2026-01-01', 0.2100, 'medical',    '2026 IRS medical / moving rate'),
  ('2026-01-01', 0.1400, 'charitable', '2026 IRS charitable mileage rate');

-- ============================================================
-- Payment Reminders
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_reminders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id),
  reminder_type   TEXT NOT NULL CHECK (reminder_type IN ('upcoming', 'overdue_7', 'overdue_30', 'overdue_60', 'overdue_90', 'final_notice')),
  scheduled_date  DATE NOT NULL,
  sent_at         TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'cancelled')),
  notes           TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_reminders_invoice ON payment_reminders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_status_date ON payment_reminders(status, scheduled_date);
