-- Migration 023: Estimates / Quotes
-- Mirrors invoice structure. Can be converted to invoices on acceptance.

CREATE TABLE IF NOT EXISTS estimates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_number     INT NOT NULL,
  customer_id         UUID NOT NULL REFERENCES customers(id),
  estimate_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date         DATE,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted')),
  subtotal            NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate            NUMERIC(6,4) NOT NULL DEFAULT 0,
  tax_amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  total               NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes               TEXT,
  terms               TEXT,
  converted_invoice_id UUID REFERENCES invoices(id),
  created_by          TEXT NOT NULL,
  created_by_name     TEXT NOT NULL,
  sent_at             TIMESTAMPTZ,
  accepted_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS estimate_number_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS estimate_line_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id         UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  description         TEXT NOT NULL,
  quantity            NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price          NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount              NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_order          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_estimates_customer ON estimates(customer_id);
CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(status);
CREATE INDEX IF NOT EXISTS idx_estimate_lines_estimate ON estimate_line_items(estimate_id);
