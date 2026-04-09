-- ============================================================================
-- Migration 038: Comprehensive Demo Accounting Seed Data
-- ============================================================================
-- Fills ALL empty accounting tables with realistic B&B Metals data so every
-- accounting page shows meaningful content for demos and evaluation.
--
-- Tables seeded:
--   chart_of_accounts     (4 new payroll tax liability accounts)
--   mileage_rates         (IRS 2025 + 2026 rates)
--   bank_accounts         (1 checking account)
--   bank_transactions     (30 transactions, Jan–Apr 2026)
--   reconciliation_sessions (1 completed January reconciliation)
--   employee_tax_profiles (6 employees with W-4 data + YTD)
--   employee_benefits     (health, dental, 401k enrollments)
--   payroll_runs          (1 completed run, week of 3/17–3/22)
--   payroll_run_lines     (6 employee lines with full tax breakdown)
--   fixed_assets          (4 assets: 2 trucks, welder, skid steer)
--   depreciation_entries  (Q1 2026 monthly depreciation)
--   estimates             (3 estimates: accepted, expired, sent)
--   estimate_line_items   (line items for each estimate)
--   credit_card_accounts  (1 Chase Visa)
--   credit_card_transactions (15 transactions, Feb–Apr 2026)
--   recurring_journal_entries (3 templates: rent, insurance, depreciation)
--
-- All inserts use ON CONFLICT / WHERE NOT EXISTS for safe re-runs.
-- Depends on: 009, 012, 017, 018, 019, 020, 022, 023, 024, 025, 037
-- ============================================================================


-- ============================================================================
-- 1. PAYROLL TAX LIABILITY ACCOUNTS
-- ============================================================================
-- The payroll-run API expects accounts 2210–2240. Add them if missing.

INSERT INTO chart_of_accounts (account_number, name, account_type, normal_balance, is_system, description) VALUES
  ('2210', 'Federal Income Tax Payable',  'liability', 'credit', false, 'Federal income tax withheld from employees'),
  ('2220', 'State Income Tax Payable',    'liability', 'credit', false, 'State income tax withheld from employees'),
  ('2230', 'FICA Payable',               'liability', 'credit', false, 'Social Security and Medicare taxes payable'),
  ('2240', 'FUTA/SUTA Payable',          'liability', 'credit', false, 'Federal and state unemployment taxes payable')
ON CONFLICT (account_number) DO NOTHING;


-- ============================================================================
-- 2. IRS MILEAGE RATES
-- ============================================================================

INSERT INTO mileage_rates (effective_date, rate_per_mile, rate_type, description, is_active) VALUES
  ('2025-01-01', 0.7000, 'standard',   'IRS 2025 standard mileage rate',         false),
  ('2025-01-01', 0.2100, 'medical',    'IRS 2025 medical/moving mileage rate',    false),
  ('2025-01-01', 0.1400, 'charitable', 'IRS 2025 charitable mileage rate',        false),
  ('2026-01-01', 0.7000, 'standard',   'IRS 2026 standard mileage rate',         true),
  ('2026-01-01', 0.2200, 'medical',    'IRS 2026 medical/moving mileage rate',    true),
  ('2026-01-01', 0.1400, 'charitable', 'IRS 2026 charitable mileage rate',        true)
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 3. BANK ACCOUNT — B&B Metals Operating (Republic Bank, Shepherdsville)
-- ============================================================================

WITH cash_acct AS (
  SELECT id FROM chart_of_accounts WHERE account_number = '1000' LIMIT 1
)
INSERT INTO bank_accounts (name, institution, account_last4, account_type, gl_account_id, current_balance, is_active)
SELECT 'B&B Metals Operating', 'Republic Bank — Shepherdsville', '7842', 'checking', cash_acct.id, 47832.15, true
FROM cash_acct
WHERE NOT EXISTS (SELECT 1 FROM bank_accounts WHERE account_last4 = '7842');


-- ============================================================================
-- 4. BANK TRANSACTIONS — 30 transactions spanning Jan–Apr 2026
-- ============================================================================
-- Tells the story of a real operating business: customer payments in,
-- payroll and vendor payments out, fuel, insurance, rent, interest.

WITH bank AS (
  SELECT id FROM bank_accounts WHERE account_last4 = '7842' LIMIT 1
)
INSERT INTO bank_transactions (bank_account_id, transaction_date, description, amount, type, reference, cleared)
SELECT bank.id, v.txn_date, v.descr, v.amt, v.txn_type, v.ref, v.clr
FROM bank, (VALUES
  -- ── January 2026 ──
  ('2026-01-02'::date, 'Owner capital deposit',                    50000.00, 'deposit',    'DEP-001',    true),
  ('2026-01-06'::date, 'Republic Bank — monthly service fee',        -25.00, 'fee',        'FEE-JAN',    true),
  ('2026-01-10'::date, 'Norfolk Southern — INV-2025-012 payment',  8500.00, 'deposit',    'CHK-43910',  true),
  ('2026-01-14'::date, 'Payroll — week of 1/4',                   -9850.00, 'withdrawal', 'PR-W01',     true),
  ('2026-01-15'::date, 'Pilot Flying J — fuel card January',      -3920.00, 'withdrawal', 'PFJ-01',     true),
  ('2026-01-22'::date, 'NAPA Auto Parts — brake components',      -1280.00, 'withdrawal', 'CHK-1185',   true),
  ('2026-01-28'::date, 'Payroll — week of 1/18',                  -9850.00, 'withdrawal', 'PR-W03',     true),
  ('2026-01-31'::date, 'KY Farm Bureau — Q1 fleet insurance',     -6200.00, 'withdrawal', 'CHK-1186',   true),
  ('2026-01-31'::date, 'Interest earned',                             12.45, 'interest',   'INT-JAN',    true),
  -- ── February 2026 ──
  ('2026-02-01'::date, 'Shop rent — February',                    -3200.00, 'withdrawal', 'CHK-1187',   true),
  ('2026-02-05'::date, 'CSX Transportation — INV-1002 full pay',   4200.00, 'deposit',    'ACH-9923',   true),
  ('2026-02-06'::date, 'Republic Bank — monthly service fee',        -25.00, 'fee',        'FEE-FEB',    true),
  ('2026-02-11'::date, 'Payroll — week of 2/1',                  -10200.00, 'withdrawal', 'PR-W05',     true),
  ('2026-02-15'::date, 'Pilot Flying J — fuel card February',     -4150.00, 'withdrawal', 'PFJ-02',     true),
  ('2026-02-25'::date, 'Payroll — week of 2/15',                 -10200.00, 'withdrawal', 'PR-W07',     true),
  ('2026-02-28'::date, 'Interest earned',                             11.20, 'interest',   'INT-FEB',    true),
  -- ── March 2026 ──
  ('2026-03-01'::date, 'Shop rent — March',                       -3200.00, 'withdrawal', 'CHK-1188',   true),
  ('2026-03-01'::date, 'Pilot Flying J — fuel card March',        -4875.00, 'withdrawal', 'PFJ-03',     true),
  ('2026-03-06'::date, 'Republic Bank — monthly service fee',        -25.00, 'fee',        'FEE-MAR',    true),
  ('2026-03-10'::date, 'CSX — INV-1002 duplicate (voided)',        4200.00, 'deposit',    'ACH-9923B',  true),
  ('2026-03-14'::date, 'Payroll — week of 3/8',                  -12400.00, 'withdrawal', 'PR-W10',     true),
  ('2026-03-20'::date, 'Norfolk Southern — partial INV-1001',      5000.00, 'deposit',    'CHK-44821',  true),
  ('2026-03-20'::date, 'NAPA Auto Parts — fleet parts order',     -2340.00, 'withdrawal', 'CHK-1190',   true),
  ('2026-03-25'::date, 'Smith Welding & Fab — custom brackets',   -1850.00, 'withdrawal', 'CHK-1191',   true),
  ('2026-03-28'::date, 'Payroll — week of 3/22',                 -11800.00, 'withdrawal', 'PR-W12',     true),
  ('2026-03-31'::date, 'Interest earned',                             13.50, 'interest',   'INT-MAR',    true),
  -- ── April 2026 (uncleared — current month) ──
  ('2026-04-01'::date, 'Shop rent — April',                       -3200.00, 'withdrawal', 'CHK-1192',   false),
  ('2026-04-01'::date, 'KY Farm Bureau — Q2 fleet insurance',     -6200.00, 'withdrawal', 'CHK-1193',   false),
  ('2026-04-04'::date, 'Mack Trucks — DEF fluid bulk order',      -2100.00, 'withdrawal', 'CHK-1194',   false),
  ('2026-04-07'::date, 'Norfolk Southern — progress billing',      8750.00, 'deposit',    'ACH-10044',  false)
) AS v(txn_date, descr, amt, txn_type, ref, clr)
WHERE NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.bank_account_id = bank.id AND bt.reference = 'DEP-001');


-- ============================================================================
-- 5. BANK RECONCILIATION — Completed January 2026 session
-- ============================================================================
-- January statement: starting $0, 9 cleared transactions, ending $27,387.45

WITH bank AS (
  SELECT id FROM bank_accounts WHERE account_last4 = '7842' LIMIT 1
)
INSERT INTO reconciliation_sessions (bank_account_id, statement_date, statement_balance, beginning_balance, cleared_deposits, cleared_withdrawals, difference, status, completed_by, completed_by_name, completed_at, notes)
SELECT bank.id, '2026-01-31', 27387.45, 0.00, 58512.45, 31125.00, 0.00, 'completed', 'seed-admin', 'Andrew Sieg', '2026-02-03 14:00:00-05', 'January 2026 bank reconciliation — opening month'
FROM bank
WHERE NOT EXISTS (
  SELECT 1 FROM reconciliation_sessions rs
  WHERE rs.bank_account_id = bank.id AND rs.statement_date = '2026-01-31'
);


-- ============================================================================
-- 6. EMPLOYEE TAX PROFILES — 6 employees with realistic W-4 data
-- ============================================================================
-- Includes YTD accumulators through Q1 (~13 weeks of pay) so tax reports
-- and payroll preview pages show meaningful numbers.

INSERT INTO employee_tax_profiles (
  user_id, filing_status, multiple_jobs, dependents_credit, other_income,
  deductions, extra_withholding, state, state_withholding, pay_frequency,
  hourly_rate, salary_annual, pay_type,
  ytd_gross_pay, ytd_federal_wh, ytd_state_wh,
  ytd_ss_employee, ytd_medicare_employee,
  ytd_ss_employer, ytd_medicare_employer,
  ytd_futa, ytd_suta,
  w4_signed_date, is_active, work_state
) VALUES
  -- Andrew Sieg — owner/developer, salary $85k, MFJ, 2 dependents ($4k credit)
  ('seed-andrew', 'married_filing_jointly', false, 4000.00, 0, 0, 0,
   'KY', 0.0400, 'weekly', NULL, 85000.00, 'salary',
   21250.00, 1785.00, 850.00, 1317.50, 308.13, 1317.50, 308.13, 127.50, 573.75,
   '2026-01-01', true, 'KY'),

  -- Jake Miller — field crew lead, hourly $32, single
  ('seed-jake', 'single', false, 0, 0, 0, 0,
   'KY', 0.0400, 'weekly', 32.00, NULL, 'hourly',
   19200.00, 2304.00, 768.00, 1190.40, 278.40, 1190.40, 278.40, 115.20, 518.40,
   '2026-01-02', true, 'KY'),

  -- Tommy Reeves — mechanic, hourly $28, single, $25 extra withholding
  ('seed-tommy', 'single', false, 0, 0, 0, 25.00,
   'KY', 0.0400, 'weekly', 28.00, NULL, 'hourly',
   15680.00, 1960.00, 627.20, 972.16, 227.36, 972.16, 227.36, 94.08, 423.36,
   '2026-01-02', true, 'KY'),

  -- Carlos Hernandez — operator, hourly $26, MFJ, 3 dependents ($6k credit)
  ('seed-carlos', 'married_filing_jointly', false, 6000.00, 0, 0, 0,
   'KY', 0.0400, 'weekly', 26.00, NULL, 'hourly',
   16900.00, 845.00, 676.00, 1047.80, 245.05, 1047.80, 245.05, 101.40, 456.30,
   '2026-01-03', true, 'KY'),

  -- Sarah Mitchell — office manager, salary $52k, single
  ('seed-sarah', 'single', false, 0, 0, 0, 0,
   'KY', 0.0400, 'weekly', NULL, 52000.00, 'salary',
   13000.00, 1560.00, 520.00, 806.00, 188.50, 806.00, 188.50, 78.00, 351.00,
   '2026-01-02', true, 'KY'),

  -- Danny Williams — operator, hourly $24, single, lives in IN (reciprocity w/ KY)
  ('seed-danny', 'single', false, 0, 0, 0, 0,
   'IN', 0.0305, 'weekly', 24.00, NULL, 'hourly',
   14400.00, 1728.00, 439.20, 892.80, 208.80, 892.80, 208.80, 86.40, 388.80,
   '2026-01-03', true, 'KY')
ON CONFLICT (user_id) DO NOTHING;


-- ============================================================================
-- 7. EMPLOYEE BENEFITS ENROLLMENT
-- ============================================================================

WITH health AS (SELECT id FROM benefit_plans WHERE name LIKE 'Anthem%' LIMIT 1),
     dental AS (SELECT id FROM benefit_plans WHERE name LIKE 'Delta%' LIMIT 1),
     four01k AS (SELECT id FROM benefit_plans WHERE name LIKE 'Empower%' LIMIT 1)
INSERT INTO employee_benefits (user_id, benefit_plan_id, enrollment_date, employee_amount, employer_amount)
SELECT v.user_id, v.plan_id, v.enroll_date, v.ee, v.er
FROM (
  -- Health (all 6 employees)
  SELECT 'seed-andrew' AS user_id, h.id AS plan_id, '2026-01-01'::date AS enroll_date, 125.00 AS ee, 375.00 AS er FROM health h
  UNION ALL SELECT 'seed-jake',   h.id, '2026-01-01', 125.00, 375.00 FROM health h
  UNION ALL SELECT 'seed-tommy',  h.id, '2026-01-01', 125.00, 375.00 FROM health h
  UNION ALL SELECT 'seed-carlos', h.id, '2026-01-01', 125.00, 375.00 FROM health h
  UNION ALL SELECT 'seed-sarah',  h.id, '2026-01-01', 125.00, 375.00 FROM health h
  UNION ALL SELECT 'seed-danny',  h.id, '2026-01-01', 125.00, 375.00 FROM health h
  -- Dental (4 of 6)
  UNION ALL SELECT 'seed-andrew', d.id, '2026-01-01', 22.50, 22.50 FROM dental d
  UNION ALL SELECT 'seed-jake',   d.id, '2026-01-01', 22.50, 22.50 FROM dental d
  UNION ALL SELECT 'seed-sarah',  d.id, '2026-01-01', 22.50, 22.50 FROM dental d
  UNION ALL SELECT 'seed-carlos', d.id, '2026-01-01', 22.50, 22.50 FROM dental d
  -- 401(k) (3 of 6)
  UNION ALL SELECT 'seed-andrew', k.id, '2026-01-01', 98.08, 49.04 FROM four01k k
  UNION ALL SELECT 'seed-jake',   k.id, '2026-01-01', 36.92, 18.46 FROM four01k k
  UNION ALL SELECT 'seed-sarah',  k.id, '2026-01-01', 60.00, 30.00 FROM four01k k
) AS v
ON CONFLICT (user_id, benefit_plan_id) DO NOTHING;


-- ============================================================================
-- 8. COMPLETED PAYROLL RUN — Week of 3/17–3/22, pay date 3/28
-- ============================================================================
-- Creates JE + payroll_run + 6 payroll_run_lines.

-- Step 1: Create the payroll journal entry (must balance)
-- Gross: $7,940.62 | Employer tax: $869.50
-- Total debits: $8,810.12 = Total credits: $8,810.12

WITH payroll_je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  SELECT '2026-03-28', 'Payroll — week of 3/17–3/22 (6 employees)', 'PR-2026-W12', 'payroll', 'posted', 7940.62, 'seed-admin', 'Andrew Sieg', '2026-03-28 08:00:00-05'
  WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE reference = 'PR-2026-W12' AND source = 'payroll')
  RETURNING id
),
-- Step 2: JE lines
cash_acct AS (SELECT id FROM chart_of_accounts WHERE account_number = '1000'),
payroll_exp AS (SELECT id FROM chart_of_accounts WHERE account_number = '5000'),
tax_exp AS (SELECT id FROM chart_of_accounts WHERE account_number = '5010'),
fed_pay AS (SELECT id FROM chart_of_accounts WHERE account_number = '2210'),
state_pay AS (SELECT id FROM chart_of_accounts WHERE account_number = '2220'),
fica_pay AS (SELECT id FROM chart_of_accounts WHERE account_number = '2230'),
futa_pay AS (SELECT id FROM chart_of_accounts WHERE account_number = '2240'),
payroll_payable AS (SELECT id FROM chart_of_accounts WHERE account_number = '2100'),
je_lines AS (
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
  -- Debits
  SELECT pj.id, pe.id, 7940.62, 0, 'Gross wages — 6 employees', 1
    FROM payroll_je pj, payroll_exp pe
  UNION ALL
  SELECT pj.id, te.id, 869.50, 0, 'Employer FICA + FUTA + SUTA', 2
    FROM payroll_je pj, tax_exp te
  -- Credits
  UNION ALL
  SELECT pj.id, fp.id, 0, 820.08, 'Federal income tax withheld', 3
    FROM payroll_je pj, fed_pay fp
  UNION ALL
  SELECT pj.id, sp.id, 0, 302.85, 'State income tax withheld', 4
    FROM payroll_je pj, state_pay sp
  UNION ALL
  SELECT pj.id, fcp.id, 0, 1214.92, 'FICA — employee + employer SS & Medicare', 5
    FROM payroll_je pj, fica_pay fcp
  UNION ALL
  SELECT pj.id, pp.id, 0, 1035.00, 'Employee benefit deductions', 6
    FROM payroll_je pj, payroll_payable pp
  UNION ALL
  SELECT pj.id, fu.id, 0, 262.04, 'FUTA + KY SUTA', 7
    FROM payroll_je pj, futa_pay fu
  UNION ALL
  SELECT pj.id, ca.id, 0, 5175.23, 'Net pay disbursed', 8
    FROM payroll_je pj, cash_acct ca
  RETURNING journal_entry_id
),
-- Step 3: Payroll run header
payroll_run AS (
  INSERT INTO payroll_runs (
    pay_period_start, pay_period_end, pay_date, status,
    total_gross, total_net, total_employer_tax, total_deductions,
    employee_count, journal_entry_id, created_by, created_by_name,
    approved_by, approved_by_name, approved_at, posted_at, notes
  )
  SELECT '2026-03-17', '2026-03-22', '2026-03-28', 'posted',
    7940.62, 5175.23, 869.50, 2765.39,
    6, pj.id, 'seed-admin', 'Andrew Sieg',
    'seed-admin', 'Andrew Sieg', '2026-03-27 16:00:00-05', '2026-03-28 08:00:00-05',
    'Weekly payroll — Jake at NS Corbin, Tommy CSX Louisville, Carlos at NS Shepherdsville'
  FROM payroll_je pj
  RETURNING id
)
-- Step 4: Payroll run lines (per-employee breakdown)
INSERT INTO payroll_run_lines (
  payroll_run_id, user_id, employee_name,
  regular_hours, overtime_hours, hourly_rate,
  regular_pay, overtime_pay, gross_pay,
  federal_wh, state_wh, ss_employee, medicare_employee,
  benefits_deduction, total_deductions, net_pay,
  ss_employer, medicare_employer, futa, suta, total_employer_tax,
  per_diem
)
SELECT pr.id, v.*
FROM payroll_run pr, (VALUES
  ('seed-andrew', 'Andrew Sieg',       40.0, 0.0, 40.87, 1634.62,  0.00, 1634.62, 163.46, 65.38, 101.35, 23.70, 245.58, 599.47, 1035.15, 101.35, 23.70,  9.81, 44.13, 178.99,    0.00),
  ('seed-jake',   'Jake Miller',       40.0, 7.0, 32.00, 1280.00, 336.00, 1616.00, 193.92, 64.64, 100.19, 23.43, 184.42, 566.60, 1049.40, 100.19, 23.43, 9.70, 43.63, 176.95, 325.00),
  ('seed-tommy',  'Tommy Reeves',      40.0, 0.0, 28.00, 1120.00,  0.00, 1120.00, 134.40, 44.80,  69.44, 16.24, 125.00, 389.88,  730.12,  69.44, 16.24, 6.72, 30.24, 122.64,    0.00),
  ('seed-carlos', 'Carlos Hernandez',  40.0, 10.0, 26.00, 1040.00, 390.00, 1430.00,  71.50, 57.20,  88.66, 20.74, 147.50, 385.60, 1044.40,  88.66, 20.74, 8.58, 38.61, 156.59, 325.00),
  ('seed-sarah',  'Sarah Mitchell',    40.0, 0.0, 25.00, 1000.00,  0.00, 1000.00, 120.00, 40.00,  62.00, 14.50, 207.50, 444.00,  556.00,  62.00, 14.50, 6.00, 27.00, 109.50,    0.00),
  ('seed-danny',  'Danny Williams',    40.0, 5.0, 24.00,  960.00, 180.00, 1140.00, 136.80, 30.83,  70.68, 16.53, 125.00, 379.84,  760.16,  70.68, 16.53, 6.84, 30.78, 124.83,    0.00)
) AS v(user_id, employee_name, reg_hrs, ot_hrs, rate, reg_pay, ot_pay, gross,
       fed_wh, st_wh, ss_ee, med_ee, benefits, total_ded, net,
       ss_er, med_er, futa, suta, total_er, per_diem);


-- ============================================================================
-- 9. FIXED ASSETS — 2 trucks, 1 welder, 1 skid steer
-- ============================================================================

WITH asset_acct AS (SELECT id FROM chart_of_accounts WHERE account_number = '1300'),
     depr_acct AS (SELECT id FROM chart_of_accounts WHERE account_number = '6000'),
     accum_acct AS (SELECT id FROM chart_of_accounts WHERE account_number = '1310')
INSERT INTO fixed_assets (
  name, description, asset_tag, category, purchase_date, in_service_date,
  purchase_cost, salvage_value, useful_life_months, depreciation_method,
  accumulated_depreciation, book_value, status, linked_truck_id,
  gl_asset_account_id, gl_depreciation_account_id, gl_accum_depr_account_id,
  created_by, created_by_name
)
SELECT v.name, v.descr, v.tag, v.cat, v.purchase_date, v.in_service_date,
       v.cost, v.salvage, v.life_mo, v.method,
       v.accum_depr, v.book_val, v.status, v.truck_id,
       asset_acct.id, depr_acct.id, accum_acct.id,
       'seed-admin', 'Andrew Sieg'
FROM asset_acct, depr_acct, accum_acct, (VALUES
  -- Truck 01 — 2018 Mack Granite GU713
  -- $1,000/mo depr, 93 months as of 2026-03-31
  ('2018 Mack Granite GU713', 'Truck 01 — primary TPS deployment vehicle. VIN: 1M2AX04C5JM038291',
   'FA-V-001', 'vehicle', '2018-06-01'::date, '2018-06-15'::date,
   145000.00, 25000.00, 120, 'straight_line',
   93000.00, 52000.00, 'active', '01'),

  -- Truck 03 — 2020 Mack Granite GU713
  -- $1,125/mo depr, 72 months as of 2026-03-31
  ('2020 Mack Granite GU713', 'Truck 03 — secondary crew truck. VIN: 1M2AX04C0LM042187',
   'FA-V-003', 'vehicle', '2020-03-15'::date, '2020-04-01'::date,
   165000.00, 30000.00, 120, 'straight_line',
   81000.00, 84000.00, 'active', NULL),

  -- Lincoln Electric Ranger 305D — Welder/generator
  -- $148.81/mo depr, 78 months as of 2026-03-31
  ('Lincoln Electric Ranger 305D', 'Portable welder/generator for field work. S/N: U1170405742',
   'FA-E-010', 'equipment', '2019-09-01'::date, '2019-09-01'::date,
   14500.00, 2000.00, 84, 'straight_line',
   11607.14, 2892.86, 'active', NULL),

  -- John Deere 333G CTL — Compact track loader
  -- $593.75/mo depr, 47 months as of 2026-03-31
  ('John Deere 333G CTL', 'Compact track loader for site prep and material handling. S/N: 1T0333GXNP410892',
   'FA-E-020', 'equipment', '2022-04-01'::date, '2022-04-15'::date,
   72000.00, 15000.00, 96, 'straight_line',
   27906.25, 44093.75, 'active', NULL)
) AS v(name, descr, tag, cat, purchase_date, in_service_date, cost, salvage, life_mo, method, accum_depr, book_val, status, truck_id)
WHERE NOT EXISTS (SELECT 1 FROM fixed_assets WHERE asset_tag = 'FA-V-001');


-- ============================================================================
-- 10. DEPRECIATION ENTRIES — Q1 2026 (Jan, Feb, Mar)
-- ============================================================================
-- Creates 3 months × 4 assets = 12 entries (no linked JEs for simplicity).

INSERT INTO depreciation_entries (fixed_asset_id, period_date, depreciation_amount, accumulated_total, book_value_after)
SELECT fa.id, v.period_date, v.depr_amt, v.accum_total, v.book_after
FROM fixed_assets fa, (VALUES
  -- Truck 01 ($1,000/mo)
  ('FA-V-001', '2026-01-31'::date, 1000.00, 91000.00, 54000.00),
  ('FA-V-001', '2026-02-28'::date, 1000.00, 92000.00, 53000.00),
  ('FA-V-001', '2026-03-31'::date, 1000.00, 93000.00, 52000.00),
  -- Truck 03 ($1,125/mo)
  ('FA-V-003', '2026-01-31'::date, 1125.00, 79875.00, 85125.00),
  ('FA-V-003', '2026-02-28'::date, 1125.00, 81000.00, 84000.00),
  ('FA-V-003', '2026-03-31'::date, 1125.00, 82125.00, 82875.00),
  -- Welder ($148.81/mo)
  ('FA-E-010', '2026-01-31'::date, 148.81, 11160.71, 3339.29),
  ('FA-E-010', '2026-02-28'::date, 148.81, 11309.52, 3190.48),
  ('FA-E-010', '2026-03-31'::date, 148.81, 11458.33, 3041.67),
  -- Skid steer ($593.75/mo)
  ('FA-E-020', '2026-01-31'::date, 593.75, 26718.75, 45281.25),
  ('FA-E-020', '2026-02-28'::date, 593.75, 27312.50, 44687.50),
  ('FA-E-020', '2026-03-31'::date, 593.75, 27906.25, 44093.75)
) AS v(asset_tag, period_date, depr_amt, accum_total, book_after)
WHERE fa.asset_tag = v.asset_tag
ON CONFLICT (fixed_asset_id, period_date) DO NOTHING;


-- ============================================================================
-- 11. ESTIMATES — 3 estimates showing different lifecycle stages
-- ============================================================================

-- Estimate 1: Norfolk Southern — Q2 maintenance contract (accepted)
WITH ns AS (SELECT id FROM customers WHERE company_name = 'Norfolk Southern Corporation' LIMIT 1)
INSERT INTO estimates (estimate_number, customer_id, estimate_date, expiry_date, status, subtotal, tax_rate, tax_amount, total, notes, terms, created_by, created_by_name, sent_at, accepted_at)
SELECT nextval('estimate_number_seq'), ns.id, '2026-03-15', '2026-04-15', 'accepted',
  38500.00, 0, 0, 38500.00,
  'Q2 2026 TPS maintenance — Shepherdsville and Corbin yards. Includes 20 unit inspections + 4 emergency call-outs.',
  'Net 45 from acceptance. 50% on acceptance, 50% on completion.',
  'seed-admin', 'Andrew Sieg', '2026-03-15 10:00:00-05', '2026-03-25 14:30:00-05'
FROM ns
WHERE NOT EXISTS (SELECT 1 FROM estimates WHERE notes LIKE '%Q2 2026 TPS maintenance%');

-- Estimate 1 line items
WITH est AS (SELECT id FROM estimates WHERE notes LIKE '%Q2 2026 TPS maintenance%' LIMIT 1)
INSERT INTO estimate_line_items (estimate_id, description, quantity, unit_price, amount, line_order)
SELECT est.id, v.descr, v.qty, v.price, v.amt, v.ord
FROM est, (VALUES
  ('TPS System Inspection & Calibration — per unit',    20,  750.00, 15000.00, 0),
  ('Preventive Maintenance — per unit',                 20,  650.00, 13000.00, 1),
  ('Emergency Call-Out (estimated 4 trips)',              4, 1500.00,  6000.00, 2),
  ('Parts & Materials Allowance',                        1, 4500.00,  4500.00, 3)
) AS v(descr, qty, price, amt, ord)
WHERE NOT EXISTS (SELECT 1 FROM estimate_line_items WHERE estimate_id = est.id);

-- Estimate 2: CSX — Signal upgrade proposal (expired)
WITH csx AS (SELECT id FROM customers WHERE company_name = 'CSX Transportation' LIMIT 1)
INSERT INTO estimates (estimate_number, customer_id, estimate_date, expiry_date, status, subtotal, tax_rate, tax_amount, total, notes, terms, created_by, created_by_name, sent_at)
SELECT nextval('estimate_number_seq'), csx.id, '2026-02-01', '2026-03-03', 'expired',
  8750.00, 0, 0, 8750.00,
  'Railroad signal crossing upgrade — 5 crossings on Louisville subdivision.',
  'Net 45. Valid 30 days from estimate date.',
  'seed-admin', 'Andrew Sieg', '2026-02-01 11:00:00-05'
FROM csx
WHERE NOT EXISTS (SELECT 1 FROM estimates WHERE notes LIKE '%signal crossing upgrade%');

-- Estimate 2 line items
WITH est AS (SELECT id FROM estimates WHERE notes LIKE '%signal crossing upgrade%' LIMIT 1)
INSERT INTO estimate_line_items (estimate_id, description, quantity, unit_price, amount, line_order)
SELECT est.id, v.descr, v.qty, v.price, v.amt, v.ord
FROM est, (VALUES
  ('Signal Equipment Survey — per crossing',     5,  450.00, 2250.00, 0),
  ('Signal Upgrade Labor — per crossing',        5, 1100.00, 5500.00, 1),
  ('Travel & Mobilization',                      1, 1000.00, 1000.00, 2)
) AS v(descr, qty, price, amt, ord)
WHERE NOT EXISTS (SELECT 1 FROM estimate_line_items WHERE estimate_id = est.id);

-- Estimate 3: Union Pacific — Phase 2 expansion (sent, pending)
WITH up AS (SELECT id FROM customers WHERE company_name = 'Union Pacific Railroad' LIMIT 1)
INSERT INTO estimates (estimate_number, customer_id, estimate_date, expiry_date, status, subtotal, tax_rate, tax_amount, total, notes, terms, created_by, created_by_name, sent_at)
SELECT nextval('estimate_number_seq'), up.id, '2026-04-01', '2026-05-01', 'sent',
  25000.00, 0, 0, 25000.00,
  'TPS Western Corridor Phase 2 — 8 additional units, site prep, and commissioning.',
  'Net 60. Mobilization fee due on acceptance.',
  'seed-admin', 'Andrew Sieg', '2026-04-01 09:00:00-05'
FROM up
WHERE NOT EXISTS (SELECT 1 FROM estimates WHERE notes LIKE '%Western Corridor Phase 2%');

-- Estimate 3 line items
WITH est AS (SELECT id FROM estimates WHERE notes LIKE '%Western Corridor Phase 2%' LIMIT 1)
INSERT INTO estimate_line_items (estimate_id, description, quantity, unit_price, amount, line_order)
SELECT est.id, v.descr, v.qty, v.price, v.amt, v.ord
FROM est, (VALUES
  ('TPS Unit Installation',       8, 2500.00, 20000.00, 0),
  ('Site Preparation & Grading',  2, 1500.00,  3000.00, 1),
  ('Commissioning & Training',    1, 2000.00,  2000.00, 2)
) AS v(descr, qty, price, amt, ord)
WHERE NOT EXISTS (SELECT 1 FROM estimate_line_items WHERE estimate_id = est.id);


-- ============================================================================
-- 12. CREDIT CARD ACCOUNT + TRANSACTIONS
-- ============================================================================

-- Credit card account
WITH cc_acct AS (SELECT id FROM chart_of_accounts WHERE account_number = '2300' LIMIT 1)
INSERT INTO credit_card_accounts (name, last_four, gl_account_id, is_active)
SELECT 'Chase Visa — B&B Metals', '4829', cc_acct.id, true
FROM cc_acct
WHERE NOT EXISTS (SELECT 1 FROM credit_card_accounts WHERE last_four = '4829');

-- 15 credit card transactions (mix of pending, categorized, posted)
WITH cc AS (SELECT id FROM credit_card_accounts WHERE last_four = '4829' LIMIT 1),
     fuel_acct AS (SELECT id FROM chart_of_accounts WHERE account_number = '5400'),
     meals_acct AS (SELECT id FROM chart_of_accounts WHERE account_number = '5410'),
     travel_acct AS (SELECT id FROM chart_of_accounts WHERE account_number = '5420'),
     tools_acct AS (SELECT id FROM chart_of_accounts WHERE account_number = '5600'),
     office_acct AS (SELECT id FROM chart_of_accounts WHERE account_number = '5910')
INSERT INTO credit_card_transactions (
  credit_card_account_id, transaction_date, posted_date, description, amount,
  category, gl_account_id, status, import_batch
)
SELECT cc.id, v.txn_date, v.post_date, v.descr, v.amt,
  v.cat,
  CASE v.cat
    WHEN 'Fuel'           THEN fuel_acct.id
    WHEN 'Meals'          THEN meals_acct.id
    WHEN 'Travel/Lodging' THEN travel_acct.id
    WHEN 'Tools/Hardware' THEN tools_acct.id
    WHEN 'Office'         THEN office_acct.id
    ELSE NULL
  END,
  v.status, v.batch
FROM cc, fuel_acct, meals_acct, travel_acct, tools_acct, office_acct,
(VALUES
  -- February (posted to GL)
  ('2026-02-03'::date, '2026-02-04'::date, 'SHELL OIL 57442 SHEPHERDSVILLE KY',  87.42, 'Fuel',           'posted',     'import-2026-02'),
  ('2026-02-08'::date, '2026-02-10'::date, 'HAMPTON INN CORBIN KY',              149.00, 'Travel/Lodging', 'posted',     'import-2026-02'),
  ('2026-02-12'::date, '2026-02-13'::date, 'CRACKER BARREL 612 SHEPHERDSVILLE',   32.18, 'Meals',          'posted',     'import-2026-02'),
  ('2026-02-19'::date, '2026-02-20'::date, 'HARBOR FREIGHT TOOLS 0482',          145.60, 'Tools/Hardware', 'posted',     'import-2026-02'),
  ('2026-02-24'::date, '2026-02-25'::date, 'LOVES TRAVEL STOP 442 CORBIN KY',    112.33, 'Fuel',           'posted',     'import-2026-02'),
  -- March (categorized, ready to post)
  ('2026-03-05'::date, '2026-03-06'::date, 'PILOT TRAVEL CENTER LOUISVILLE KY',   94.18, 'Fuel',           'categorized','import-2026-03'),
  ('2026-03-10'::date, '2026-03-11'::date, 'BEST WESTERN PLUS LOUISVILLE KY',    129.00, 'Travel/Lodging', 'categorized','import-2026-03'),
  ('2026-03-12'::date, '2026-03-13'::date, 'WAFFLE HOUSE 1843 LOUISVILLE KY',     24.67, 'Meals',          'categorized','import-2026-03'),
  ('2026-03-14'::date, '2026-03-15'::date, 'HOME DEPOT 3981 SHEPHERDSVILLE KY',  218.44, 'Tools/Hardware', 'categorized','import-2026-03'),
  ('2026-03-22'::date, '2026-03-23'::date, 'AMAZON.COM AMZN.COM/BILL WA',         67.92, 'Office',         'categorized','import-2026-03'),
  -- April (pending — not yet categorized)
  ('2026-04-01'::date, '2026-04-02'::date, 'SHELL OIL 57442 SHEPHERDSVILLE KY',   91.28, 'Fuel',           'pending',    'import-2026-04'),
  ('2026-04-03'::date, '2026-04-04'::date, 'CHICK-FIL-A #03842 LOUISVILLE KY',    18.43, NULL,             'pending',    'import-2026-04'),
  ('2026-04-04'::date, '2026-04-05'::date, 'LOWES #02481 SHEPHERDSVILLE KY',     312.90, NULL,             'pending',    'import-2026-04'),
  ('2026-04-07'::date, '2026-04-08'::date, 'CHEVRON 94182 CORBIN KY',             76.55, NULL,             'pending',    'import-2026-04'),
  ('2026-04-08'::date, NULL,               'HOLIDAY INN EXPRESS CORBIN KY',       139.00, NULL,             'pending',    'import-2026-04')
) AS v(txn_date, post_date, descr, amt, cat, status, batch)
WHERE NOT EXISTS (
  SELECT 1 FROM credit_card_transactions ct
  WHERE ct.credit_card_account_id = cc.id AND ct.description = 'SHELL OIL 57442 SHEPHERDSVILLE KY'
  AND ct.transaction_date = '2026-02-03'
);


-- ============================================================================
-- 13. RECURRING JOURNAL ENTRY TEMPLATES
-- ============================================================================

INSERT INTO recurring_journal_entries (description, reference, frequency, next_date, end_date, is_active, created_by, created_by_name) VALUES
  ('Monthly shop rent — Shepherdsville facility', 'RENT-MONTHLY', 'monthly', '2026-05-01', NULL, true, 'seed-admin', 'Andrew Sieg'),
  ('Quarterly fleet insurance — KY Farm Bureau',  'INS-QUARTERLY', 'quarterly', '2026-07-01', NULL, true, 'seed-admin', 'Andrew Sieg'),
  ('Monthly equipment depreciation',              'DEPR-MONTHLY', 'monthly', '2026-05-01', NULL, true, 'seed-admin', 'Andrew Sieg')
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 14. UPDATE COA BALANCES — Reflect all new posted JEs
-- ============================================================================
-- Recalculates balances for all accounts that have posted journal entry lines.

UPDATE chart_of_accounts SET current_balance = sub.balance
FROM (
  SELECT jel.account_id,
    COALESCE(SUM(jel.debit) - SUM(jel.credit), 0) AS balance
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE je.status = 'posted'
  GROUP BY jel.account_id
) sub
WHERE chart_of_accounts.id = sub.account_id;
