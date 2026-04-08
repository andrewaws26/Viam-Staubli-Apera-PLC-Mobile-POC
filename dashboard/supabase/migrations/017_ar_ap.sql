-- ============================================================================
-- Migration 017: Accounts Receivable & Accounts Payable
-- ============================================================================
-- Customers, vendors, invoices, bills, and payment tracking.
-- Foundation for replacing QuickBooks invoicing and bill pay.
--
-- Legal risk note: Invoice numbering uses auto-increment sequences
-- to avoid gaps (IRS scrutinizes gaps in invoice sequences for fraud).
-- ============================================================================

-- ── Customers ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    TEXT NOT NULL,
  contact_name    TEXT,
  email           TEXT,
  phone           TEXT,
  billing_address TEXT,
  payment_terms   TEXT NOT NULL DEFAULT 'Net 30' CHECK (payment_terms IN ('Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'Due on Receipt')),
  credit_limit    NUMERIC(14,2),
  tax_id          TEXT,                  -- EIN / Tax ID for 1099 tracking
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Vendors ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name          TEXT NOT NULL,
  contact_name          TEXT,
  email                 TEXT,
  phone                 TEXT,
  address               TEXT,
  payment_terms         TEXT NOT NULL DEFAULT 'Net 30' CHECK (payment_terms IN ('Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'Due on Receipt')),
  default_expense_account_id UUID REFERENCES chart_of_accounts(id),
  tax_id                TEXT,            -- EIN for 1099 tracking
  is_1099_vendor        BOOLEAN NOT NULL DEFAULT false,
  notes                 TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Invoice Numbering ────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1001;

-- ── Invoices (AR) ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  INT NOT NULL DEFAULT nextval('invoice_number_seq') UNIQUE,
  customer_id     UUID NOT NULL REFERENCES customers(id),
  invoice_date    DATE NOT NULL,
  due_date        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partial', 'paid', 'voided', 'overdue')),
  subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(5,4) NOT NULL DEFAULT 0,     -- e.g. 0.06 for 6%
  tax_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total           NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid     NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_due     NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  terms           TEXT,                   -- payment terms text on invoice
  journal_entry_id UUID REFERENCES journal_entries(id),  -- auto-generated JE
  created_by      TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  quantity        NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price      NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  account_id      UUID REFERENCES chart_of_accounts(id),  -- revenue account
  timesheet_id    UUID REFERENCES timesheets(id),          -- optional link
  line_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Invoice Payments ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoice_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_date    DATE NOT NULL,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL DEFAULT 'check' CHECK (payment_method IN ('check', 'ach', 'wire', 'cash', 'credit_card', 'other')),
  reference       TEXT,                   -- check number, transaction ID
  notes           TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id),
  recorded_by     TEXT NOT NULL,
  recorded_by_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Bills (AP) ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID NOT NULL REFERENCES vendors(id),
  bill_number     TEXT,                   -- vendor's invoice number
  bill_date       DATE NOT NULL,
  due_date        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'paid', 'voided')),
  subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total           NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid     NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance_due     NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_by      TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bill_line_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id         UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  quantity        NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price      NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
  account_id      UUID REFERENCES chart_of_accounts(id),  -- expense account
  line_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Bill Payments ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bill_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id         UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  payment_date    DATE NOT NULL,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL DEFAULT 'check' CHECK (payment_method IN ('check', 'ach', 'wire', 'cash', 'credit_card', 'other')),
  check_number    TEXT,
  reference       TEXT,
  notes           TEXT,
  journal_entry_id UUID REFERENCES journal_entries(id),
  recorded_by     TEXT NOT NULL,
  recorded_by_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices (due_date) WHERE status IN ('sent', 'partial', 'overdue');
CREATE INDEX IF NOT EXISTS idx_bills_vendor ON bills (vendor_id);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills (status);
CREATE INDEX IF NOT EXISTS idx_bills_due_date ON bills (due_date) WHERE status IN ('open', 'partial');

-- ── Seed Data: Customers ─────────────────────────────────────────────

INSERT INTO customers (company_name, contact_name, email, phone, billing_address, payment_terms, notes) VALUES
  ('Norfolk Southern Corporation',
   'James Mitchell',
   'j.mitchell@nscorp.com',
   '(404) 555-2100',
   '650 W Peachtree St NW, Atlanta, GA 30308',
   'Net 45',
   'Primary railroad customer. TPS and maintenance contracts.'),
  ('CSX Transportation',
   'Sarah Chen',
   's.chen@csx.com',
   '(904) 555-3400',
   '500 Water St, Jacksonville, FL 32202',
   'Net 45',
   'Secondary railroad customer. Occasional TPS deployment.'),
  ('Union Pacific Railroad',
   'Robert Davis',
   'r.davis@up.com',
   '(402) 555-1000',
   '1400 Douglas St, Omaha, NE 68179',
   'Net 60',
   'Western region contracts. Higher mileage reimbursement.')
ON CONFLICT DO NOTHING;

-- ── Seed Data: Vendors ───────────────────────────────────────────────

INSERT INTO vendors (company_name, contact_name, email, phone, address, payment_terms, is_1099_vendor, notes) VALUES
  ('NAPA Auto Parts — Shepherdsville',
   'Mike Johnson',
   'shepherdsville@napaonline.com',
   '(502) 555-6272',
   '250 Conestoga Pkwy, Shepherdsville, KY 40165',
   'Net 30',
   false,
   'Primary parts supplier for fleet maintenance.'),
  ('Pilot Flying J',
   NULL,
   NULL,
   '(865) 555-4441',
   'Corporate: 5508 Lonas Dr, Knoxville, TN 37909',
   'Net 15',
   false,
   'Fleet fuel card. All truck diesel.'),
  ('Shell Fleet Solutions',
   NULL,
   'fleet@shell.com',
   '(800) 555-7435',
   NULL,
   'Net 15',
   false,
   'Backup fuel card.'),
  ('Kentucky Farm Bureau Insurance',
   'Linda Thompson',
   'l.thompson@kyfb.com',
   '(502) 555-4040',
   '9201 Bunsen Pkwy, Louisville, KY 40220',
   'Net 30',
   false,
   'Fleet insurance — liability, collision, comprehensive.'),
  ('Mack Trucks — Louisville',
   'Dave Kowalski',
   'd.kowalski@macktrucks.com',
   '(502) 555-6225',
   '4400 Dixie Hwy, Louisville, KY 40216',
   'Net 30',
   false,
   'OEM parts and warranty service.'),
  ('Smith Welding & Fabrication',
   'Terry Smith',
   'terry@smithwelding.com',
   '(502) 555-8833',
   '112 Industrial Dr, Shepherdsville, KY 40165',
   'Net 30',
   true,
   '1099 contractor — custom fabrication for TPS mounting brackets.')
ON CONFLICT DO NOTHING;
