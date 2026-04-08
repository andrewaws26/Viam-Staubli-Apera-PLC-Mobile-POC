-- Migration 026: Sales Tax Configuration
-- Adds tax rate management, customer exemptions, and tax collection tracking.

-- ============================================================
-- Tax Rates
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_tax_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  jurisdiction    TEXT NOT NULL,
  rate            NUMERIC(8,6) NOT NULL,
  tax_type        TEXT NOT NULL DEFAULT 'sales' CHECK (tax_type IN ('sales', 'use', 'excise', 'other')),
  applies_to      TEXT NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'goods', 'services', 'specific')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  effective_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  expiration_date DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Tax Exemptions
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_tax_exemptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        UUID NOT NULL REFERENCES customers(id),
  exemption_type     TEXT NOT NULL CHECK (exemption_type IN ('resale', 'government', 'nonprofit', 'railroad', 'manufacturing', 'other')),
  certificate_number TEXT,
  effective_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  expiration_date    DATE,
  notes              TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Tax Collected Tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_tax_collected (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID REFERENCES invoices(id),
  tax_rate_id     UUID REFERENCES sales_tax_rates(id),
  taxable_amount  NUMERIC(14,2) NOT NULL,
  tax_amount      NUMERIC(14,2) NOT NULL,
  period_date     DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'collected' CHECK (status IN ('collected', 'filed', 'remitted')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sales_tax_exemptions_customer ON sales_tax_exemptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_tax_collected_invoice ON sales_tax_collected(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_tax_collected_period ON sales_tax_collected(period_date);

-- ============================================================
-- Seed Data
-- ============================================================
-- Kentucky Sales Tax: 6% on goods, effective 2026-01-01
INSERT INTO sales_tax_rates (name, jurisdiction, rate, tax_type, applies_to, effective_date)
VALUES ('Kentucky Sales Tax', 'KY', 0.060000, 'sales', 'goods', '2026-01-01');

-- Note: Railroad construction services are generally exempt from KY sales tax.
-- Customers with railroad exemptions should be added to sales_tax_exemptions
-- with exemption_type = 'railroad'.
