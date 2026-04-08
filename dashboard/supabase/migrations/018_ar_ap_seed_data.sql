-- ============================================================================
-- Migration 018: AR/AP Seed Data — Sample Invoices and Bills
-- ============================================================================
-- Creates realistic sample invoices and bills so the accounting UI
-- is usable immediately after migration.
--
-- Uses existing seed customers/vendors from migration 017.
-- Does NOT auto-generate journal entries — those are created by the API
-- when invoices are sent and bills are created. This seed data represents
-- draft invoices (no JE yet) and manually tracks status for display.
-- ============================================================================

-- ── Sample Invoices (AR) ───────────────────────────────────────────

-- Invoice 1: Norfolk Southern — Sent, partially paid
WITH ns_customer AS (
  SELECT id FROM customers WHERE company_name = 'Norfolk Southern Corporation' LIMIT 1
),
rev_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '4010' LIMIT 1
),
ar_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '1100' LIMIT 1
),
cash_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '1000' LIMIT 1
),
-- Create the AR journal entry for the sent invoice
ns_je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  SELECT '2026-03-01', 'Invoice #1001 sent — Norfolk Southern TPS Maintenance', 'INV-1001', 'invoice', 'posted', 12750.00, 'seed', 'System Seed', now()
  WHERE EXISTS (SELECT 1 FROM ns_customer)
  RETURNING id
),
ns_je_lines AS (
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
  SELECT ns_je.id, ar_account.id, 12750.00, 0, 'AR — Invoice #1001', 0
  FROM ns_je, ar_account
  UNION ALL
  SELECT ns_je.id, rev_account.id, 0, 12750.00, 'Railroad Services Revenue', 1
  FROM ns_je, rev_account
  RETURNING id
),
ns_invoice AS (
  INSERT INTO invoices (customer_id, invoice_date, due_date, status, subtotal, tax_rate, tax_amount, total, amount_paid, balance_due, notes, terms, journal_entry_id, created_by, created_by_name, sent_at)
  SELECT ns_customer.id, '2026-03-01', '2026-04-15', 'partial', 12750.00, 0, 0, 12750.00, 5000.00, 7750.00,
    'Monthly TPS maintenance contract — March 2026', 'Net 45', ns_je.id, 'seed', 'System Seed', now()
  FROM ns_customer, ns_je
  RETURNING id
),
ns_lines AS (
  INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, account_id, line_order)
  SELECT ns_invoice.id, 'TPS System Maintenance — 15 units', 15, 650.00, 9750.00, rev_account.id, 0
  FROM ns_invoice, rev_account
  UNION ALL
  SELECT ns_invoice.id, 'Emergency Call-Out (2 trips)', 2, 1500.00, 3000.00, rev_account.id, 1
  FROM ns_invoice, rev_account
  RETURNING id
),
-- Payment JE for the $5000 partial payment
ns_pmt_je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  SELECT '2026-03-20', 'Payment received — Invoice #1001', 'PMT-INV-1001', 'invoice', 'posted', 5000.00, 'seed', 'System Seed', now()
  WHERE EXISTS (SELECT 1 FROM ns_invoice)
  RETURNING id
),
ns_pmt_je_lines AS (
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
  SELECT ns_pmt_je.id, cash_account.id, 5000.00, 0, 'Cash received', 0
  FROM ns_pmt_je, cash_account
  UNION ALL
  SELECT ns_pmt_je.id, ar_account.id, 0, 5000.00, 'AR reduction', 1
  FROM ns_pmt_je, ar_account
  RETURNING id
),
ns_payment AS (
  INSERT INTO invoice_payments (invoice_id, payment_date, amount, payment_method, reference, notes, journal_entry_id, recorded_by, recorded_by_name)
  SELECT ns_invoice.id, '2026-03-20', 5000.00, 'check', 'CHK-44821', 'Partial payment received', ns_pmt_je.id, 'seed', 'System Seed'
  FROM ns_invoice, ns_pmt_je
  RETURNING id
)
SELECT 1;

-- Invoice 2: CSX — Sent, fully paid
WITH csx_customer AS (
  SELECT id FROM customers WHERE company_name = 'CSX Transportation' LIMIT 1
),
rev_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '4010' LIMIT 1
),
ar_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '1100' LIMIT 1
),
cash_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '1000' LIMIT 1
),
csx_je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  SELECT '2026-02-15', 'Invoice #1002 sent — CSX Signal Inspection', 'INV-1002', 'invoice', 'posted', 4200.00, 'seed', 'System Seed', now()
  WHERE EXISTS (SELECT 1 FROM csx_customer)
  RETURNING id
),
csx_je_lines AS (
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
  SELECT csx_je.id, ar_account.id, 4200.00, 0, 'AR — Invoice #1002', 0
  FROM csx_je, ar_account
  UNION ALL
  SELECT csx_je.id, rev_account.id, 0, 4200.00, 'Railroad Services Revenue', 1
  FROM csx_je, rev_account
  RETURNING id
),
csx_invoice AS (
  INSERT INTO invoices (customer_id, invoice_date, due_date, status, subtotal, tax_rate, tax_amount, total, amount_paid, balance_due, notes, terms, journal_entry_id, created_by, created_by_name, sent_at)
  SELECT csx_customer.id, '2026-02-15', '2026-04-01', 'paid', 4200.00, 0, 0, 4200.00, 4200.00, 0,
    'Quarterly signal inspection — Q1 2026', 'Net 45', csx_je.id, 'seed', 'System Seed', now()
  FROM csx_customer, csx_je
  RETURNING id
),
csx_lines AS (
  INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, account_id, line_order)
  SELECT csx_invoice.id, 'Signal Inspection — 6 crossings', 6, 700.00, 4200.00, rev_account.id, 0
  FROM csx_invoice, rev_account
  RETURNING id
),
csx_pmt_je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  SELECT '2026-03-10', 'Payment received — Invoice #1002', 'PMT-INV-1002', 'invoice', 'posted', 4200.00, 'seed', 'System Seed', now()
  WHERE EXISTS (SELECT 1 FROM csx_invoice)
  RETURNING id
),
csx_pmt_je_lines AS (
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
  SELECT csx_pmt_je.id, cash_account.id, 4200.00, 0, 'Cash received', 0
  FROM csx_pmt_je, cash_account
  UNION ALL
  SELECT csx_pmt_je.id, ar_account.id, 0, 4200.00, 'AR reduction', 1
  FROM csx_pmt_je, ar_account
  RETURNING id
),
csx_payment AS (
  INSERT INTO invoice_payments (invoice_id, payment_date, amount, payment_method, reference, notes, journal_entry_id, recorded_by, recorded_by_name)
  SELECT csx_invoice.id, '2026-03-10', 4200.00, 'ach', 'ACH-9923', 'Payment in full', csx_pmt_je.id, 'seed', 'System Seed'
  FROM csx_invoice, csx_pmt_je
  RETURNING id
)
SELECT 1;

-- Invoice 3: Union Pacific — Draft (not yet sent, no JE)
WITH up_customer AS (
  SELECT id FROM customers WHERE company_name = 'Union Pacific Railroad' LIMIT 1
),
rev_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '4010' LIMIT 1
),
up_invoice AS (
  INSERT INTO invoices (customer_id, invoice_date, due_date, status, subtotal, tax_rate, tax_amount, total, amount_paid, balance_due, notes, terms, created_by, created_by_name)
  SELECT up_customer.id, '2026-04-01', '2026-06-01', 'draft', 18500.00, 0, 0, 18500.00, 0, 18500.00,
    'TPS deployment — Western corridor Phase 1', 'Net 60', 'seed', 'System Seed'
  FROM up_customer
  RETURNING id
)
INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, account_id, line_order)
SELECT up_invoice.id, 'TPS Unit Installation', 5, 2500.00, 12500.00, rev_account.id, 0
FROM up_invoice, rev_account
UNION ALL
SELECT up_invoice.id, 'Site Survey & Planning', 3, 2000.00, 6000.00, rev_account.id, 1
FROM up_invoice, rev_account;


-- ── Sample Bills (AP) ──────────────────────────────────────────────

-- Bill 1: NAPA Auto Parts — Open
WITH napa_vendor AS (
  SELECT id FROM vendors WHERE company_name LIKE 'NAPA%' LIMIT 1
),
expense_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '5500' LIMIT 1
),
ap_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '2000' LIMIT 1
),
napa_je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  SELECT '2026-03-20', 'Bill from vendor — NAPA-38291', 'NAPA-38291', 'manual', 'posted', 2340.00, 'seed', 'System Seed', now()
  WHERE EXISTS (SELECT 1 FROM napa_vendor)
  RETURNING id
),
napa_je_lines AS (
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
  SELECT napa_je.id, expense_account.id, 2340.00, 0, 'Fleet parts — brake pads, filters, belts', 0
  FROM napa_je, expense_account
  UNION ALL
  SELECT napa_je.id, ap_account.id, 0, 2340.00, 'AP — NAPA-38291', 1
  FROM napa_je, ap_account
  RETURNING id
),
napa_bill AS (
  INSERT INTO bills (vendor_id, bill_number, bill_date, due_date, status, subtotal, tax_amount, total, amount_paid, balance_due, notes, journal_entry_id, created_by, created_by_name)
  SELECT napa_vendor.id, 'NAPA-38291', '2026-03-20', '2026-04-19', 'open', 2340.00, 0, 2340.00, 0, 2340.00,
    'Monthly fleet parts order — brake pads, oil filters, serpentine belts', napa_je.id, 'seed', 'System Seed'
  FROM napa_vendor, napa_je
  RETURNING id
)
INSERT INTO bill_line_items (bill_id, description, quantity, unit_price, amount, account_id, line_order)
SELECT napa_bill.id, 'Brake pad set — Mack Granite (×6)', 6, 185.00, 1110.00, expense_account.id, 0
FROM napa_bill, expense_account
UNION ALL
SELECT napa_bill.id, 'Oil filter — Mack MP8 (×8)', 8, 42.50, 340.00, expense_account.id, 1
FROM napa_bill, expense_account
UNION ALL
SELECT napa_bill.id, 'Serpentine belt — Mack Granite (×3)', 3, 296.67, 890.00, expense_account.id, 2
FROM napa_bill, expense_account;


-- Bill 2: Pilot Flying J — Paid (fuel)
WITH pilot_vendor AS (
  SELECT id FROM vendors WHERE company_name LIKE 'Pilot%' LIMIT 1
),
fuel_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '5400' LIMIT 1
),
ap_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '2000' LIMIT 1
),
cash_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '1000' LIMIT 1
),
pilot_je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  SELECT '2026-03-01', 'Bill from vendor — PFJ-2026-03', 'PFJ-2026-03', 'manual', 'posted', 4875.00, 'seed', 'System Seed', now()
  WHERE EXISTS (SELECT 1 FROM pilot_vendor)
  RETURNING id
),
pilot_je_lines AS (
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
  SELECT pilot_je.id, fuel_account.id, 4875.00, 0, 'Fleet diesel — March 2026', 0
  FROM pilot_je, fuel_account
  UNION ALL
  SELECT pilot_je.id, ap_account.id, 0, 4875.00, 'AP — PFJ-2026-03', 1
  FROM pilot_je, ap_account
  RETURNING id
),
pilot_bill AS (
  INSERT INTO bills (vendor_id, bill_number, bill_date, due_date, status, subtotal, tax_amount, total, amount_paid, balance_due, notes, journal_entry_id, created_by, created_by_name)
  SELECT pilot_vendor.id, 'PFJ-2026-03', '2026-03-01', '2026-03-16', 'paid', 4875.00, 0, 4875.00, 4875.00, 0,
    'Fleet fuel card — March 2026 (1250 gal diesel @ $3.90)', pilot_je.id, 'seed', 'System Seed'
  FROM pilot_vendor, pilot_je
  RETURNING id
),
pilot_lines AS (
  INSERT INTO bill_line_items (bill_id, description, quantity, unit_price, amount, account_id, line_order)
  SELECT pilot_bill.id, 'Diesel fuel — fleet card March 2026', 1250, 3.90, 4875.00, fuel_account.id, 0
  FROM pilot_bill, fuel_account
  RETURNING id
),
pilot_pmt_je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  SELECT '2026-03-15', 'Bill payment — PFJ-2026-03', 'CHK-1190', 'manual', 'posted', 4875.00, 'seed', 'System Seed', now()
  WHERE EXISTS (SELECT 1 FROM pilot_bill)
  RETURNING id
),
pilot_pmt_je_lines AS (
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
  SELECT pilot_pmt_je.id, ap_account.id, 4875.00, 0, 'AP payment', 0
  FROM pilot_pmt_je, ap_account
  UNION ALL
  SELECT pilot_pmt_je.id, cash_account.id, 0, 4875.00, 'Cash disbursement', 1
  FROM pilot_pmt_je, cash_account
  RETURNING id
),
pilot_payment AS (
  INSERT INTO bill_payments (bill_id, payment_date, amount, payment_method, check_number, notes, journal_entry_id, recorded_by, recorded_by_name)
  SELECT pilot_bill.id, '2026-03-15', 4875.00, 'check', '1190', 'Paid in full', pilot_pmt_je.id, 'seed', 'System Seed'
  FROM pilot_bill, pilot_pmt_je
  RETURNING id
)
SELECT 1;


-- Bill 3: KY Farm Bureau Insurance — Open
WITH kyfb_vendor AS (
  SELECT id FROM vendors WHERE company_name LIKE 'Kentucky Farm%' LIMIT 1
),
insurance_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '5700' LIMIT 1
),
ap_account AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '2000' LIMIT 1
),
kyfb_je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  SELECT '2026-04-01', 'Bill from vendor — Q2 fleet insurance', 'KYFB-Q2-2026', 'manual', 'posted', 6200.00, 'seed', 'System Seed', now()
  WHERE EXISTS (SELECT 1 FROM kyfb_vendor)
  RETURNING id
),
kyfb_je_lines AS (
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
  SELECT kyfb_je.id, insurance_account.id, 6200.00, 0, 'Fleet insurance — Q2 2026', 0
  FROM kyfb_je, insurance_account
  UNION ALL
  SELECT kyfb_je.id, ap_account.id, 0, 6200.00, 'AP — KYFB-Q2-2026', 1
  FROM kyfb_je, ap_account
  RETURNING id
),
kyfb_bill AS (
  INSERT INTO bills (vendor_id, bill_number, bill_date, due_date, status, subtotal, tax_amount, total, amount_paid, balance_due, notes, journal_entry_id, created_by, created_by_name)
  SELECT kyfb_vendor.id, 'KYFB-Q2-2026', '2026-04-01', '2026-05-01', 'open', 6200.00, 0, 6200.00, 0, 6200.00,
    'Quarterly fleet insurance — liability, collision, comprehensive', kyfb_je.id, 'seed', 'System Seed'
  FROM kyfb_vendor, kyfb_je
  RETURNING id
)
INSERT INTO bill_line_items (bill_id, description, quantity, unit_price, amount, account_id, line_order)
SELECT kyfb_bill.id, 'Fleet liability insurance — Q2 2026', 1, 3800.00, 3800.00, insurance_account.id, 0
FROM kyfb_bill, insurance_account
UNION ALL
SELECT kyfb_bill.id, 'Collision & comprehensive — Q2 2026', 1, 2400.00, 2400.00, insurance_account.id, 1
FROM kyfb_bill, insurance_account;
