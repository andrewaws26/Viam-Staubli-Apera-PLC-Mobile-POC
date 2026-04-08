-- ============================================================================
-- Migration 012: Seed Data — Journal Entries, Timesheets (Payroll), Usage Log, Alerts
-- ============================================================================
-- Populates realistic sample data so the accounting, payroll, inventory, and
-- alerts modules have something to display immediately.
-- ============================================================================

-- ── Helper: system user ID for seed data ────────────────────────────────
-- We use a consistent fake user ID so seed data is identifiable.
DO $$ BEGIN PERFORM set_config('app.seed_user', 'seed-system', false); END $$;

-- ============================================================================
-- 1. JOURNAL ENTRIES — 8 realistic entries covering multiple sources
-- ============================================================================

-- JE-1: Owner capital contribution (posted)
WITH je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  VALUES ('2026-03-01', 'Owner capital contribution — initial funding', 'OC-2026-001', 'manual', 'posted', 50000.00, 'seed-system', 'System Seed', now())
  RETURNING id
)
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
SELECT je.id, coa.id,
  CASE WHEN coa.account_number = '1000' THEN 50000.00 ELSE 0 END,
  CASE WHEN coa.account_number = '3000' THEN 50000.00 ELSE 0 END,
  CASE WHEN coa.account_number = '1000' THEN 'Cash deposit' ELSE 'Owner equity' END,
  CASE WHEN coa.account_number = '1000' THEN 1 ELSE 2 END
FROM je, chart_of_accounts coa
WHERE coa.account_number IN ('1000', '3000');

-- JE-2: Norfolk Southern invoice for railroad services (posted)
WITH je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  VALUES ('2026-03-05', 'Norfolk Southern — TPS installation, Shepherdsville yard', 'INV-2026-001', 'invoice', 'posted', 18500.00, 'seed-system', 'System Seed', now())
  RETURNING id
)
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
SELECT je.id, coa.id,
  CASE WHEN coa.account_number = '1100' THEN 18500.00 ELSE 0 END,
  CASE WHEN coa.account_number = '4010' THEN 18500.00 ELSE 0 END,
  CASE WHEN coa.account_number = '1100' THEN 'AR — Norfolk Southern' ELSE 'Railroad TPS services' END,
  CASE WHEN coa.account_number = '1100' THEN 1 ELSE 2 END
FROM je, chart_of_accounts coa
WHERE coa.account_number IN ('1100', '4010');

-- JE-3: Payroll expense — week of 3/8 (posted)
WITH je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  VALUES ('2026-03-08', 'Weekly payroll — crew of 6', 'PR-2026-W10', 'payroll', 'posted', 12400.00, 'seed-system', 'System Seed', now())
  RETURNING id
)
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
SELECT je.id, coa.id,
  CASE WHEN coa.account_number = '5000' THEN 10200.00
       WHEN coa.account_number = '5010' THEN 2200.00
       ELSE 0 END,
  CASE WHEN coa.account_number = '1000' THEN 12400.00 ELSE 0 END,
  CASE WHEN coa.account_number = '5000' THEN 'Gross wages'
       WHEN coa.account_number = '5010' THEN 'Employer FICA + FUTA'
       ELSE 'Cash disbursement' END,
  CASE WHEN coa.account_number = '5000' THEN 1
       WHEN coa.account_number = '5010' THEN 2
       ELSE 3 END
FROM je, chart_of_accounts coa
WHERE coa.account_number IN ('5000', '5010', '1000');

-- JE-4: Per diem — field crew week 3/8 (posted, auto-generated style)
WITH je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  VALUES ('2026-03-08', 'Per diem — 4 crew × 5 nights × $65', 'PD-2026-W10', 'per_diem', 'posted', 1300.00, 'seed-system', 'System Seed', now())
  RETURNING id
)
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
SELECT je.id, coa.id,
  CASE WHEN coa.account_number = '5100' THEN 1300.00 ELSE 0 END,
  CASE WHEN coa.account_number = '2110' THEN 1300.00 ELSE 0 END,
  CASE WHEN coa.account_number = '5100' THEN 'Per diem expense' ELSE 'Per diem payable' END,
  CASE WHEN coa.account_number = '5100' THEN 1 ELSE 2 END
FROM je, chart_of_accounts coa
WHERE coa.account_number IN ('5100', '2110');

-- JE-5: Fuel purchase (posted)
WITH je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  VALUES ('2026-03-12', 'Diesel fuel — fleet fill-up, Pilot Travel Center', 'FUEL-0312', 'manual', 'posted', 2850.00, 'seed-system', 'System Seed', now())
  RETURNING id
)
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
SELECT je.id, coa.id,
  CASE WHEN coa.account_number = '5400' THEN 2850.00 ELSE 0 END,
  CASE WHEN coa.account_number = '2300' THEN 2850.00 ELSE 0 END,
  CASE WHEN coa.account_number = '5400' THEN 'Diesel 680 gal @ $4.19' ELSE 'Company card' END,
  CASE WHEN coa.account_number = '5400' THEN 1 ELSE 2 END
FROM je, chart_of_accounts coa
WHERE coa.account_number IN ('5400', '2300');

-- JE-6: Equipment maintenance (posted)
WITH je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  VALUES ('2026-03-18', 'Truck 01 — brake shoe replacement + hydraulic hose repair', 'MX-T01-0318', 'manual', 'posted', 1420.00, 'seed-system', 'System Seed', now())
  RETURNING id
)
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
SELECT je.id, coa.id,
  CASE WHEN coa.account_number = '5500' THEN 1420.00 ELSE 0 END,
  CASE WHEN coa.account_number = '1400' THEN 1420.00 ELSE 0 END,
  CASE WHEN coa.account_number = '5500' THEN 'Equipment maintenance labor + parts' ELSE 'Parts from inventory' END,
  CASE WHEN coa.account_number = '5500' THEN 1 ELSE 2 END
FROM je, chart_of_accounts coa
WHERE coa.account_number IN ('5500', '1400');

-- JE-7: Employee expense reimbursement (posted)
WITH je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name, posted_at)
  VALUES ('2026-03-22', 'Expense reimbursement — Jake Miller, safety boots + PPE', 'EXP-JM-0322', 'expense_approved', 'posted', 285.00, 'seed-system', 'System Seed', now())
  RETURNING id
)
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
SELECT je.id, coa.id,
  CASE WHEN coa.account_number = '5600' THEN 285.00 ELSE 0 END,
  CASE WHEN coa.account_number = '2120' THEN 285.00 ELSE 0 END,
  CASE WHEN coa.account_number = '5600' THEN 'PPE — safety boots, gloves, glasses' ELSE 'Reimbursement payable' END,
  CASE WHEN coa.account_number = '5600' THEN 1 ELSE 2 END
FROM je, chart_of_accounts coa
WHERE coa.account_number IN ('5600', '2120');

-- JE-8: Monthly shop rent (draft — not yet posted)
WITH je AS (
  INSERT INTO journal_entries (entry_date, description, reference, source, status, total_amount, created_by, created_by_name)
  VALUES ('2026-04-01', 'April shop rent — Shepherdsville facility', 'RENT-APR26', 'manual', 'draft', 3200.00, 'seed-system', 'System Seed')
  RETURNING id
)
INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description, line_order)
SELECT je.id, coa.id,
  CASE WHEN coa.account_number = '5800' THEN 3200.00 ELSE 0 END,
  CASE WHEN coa.account_number = '1000' THEN 3200.00 ELSE 0 END,
  CASE WHEN coa.account_number = '5800' THEN 'Shop rent' ELSE 'Cash payment' END,
  CASE WHEN coa.account_number = '5800' THEN 1 ELSE 2 END
FROM je, chart_of_accounts coa
WHERE coa.account_number IN ('5800', '1000');

-- Update COA balances for all posted entries
UPDATE chart_of_accounts SET current_balance = (
  SELECT COALESCE(SUM(jel.debit) - SUM(jel.credit), 0)
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = chart_of_accounts.id
    AND je.status = 'posted'
)
WHERE id IN (
  SELECT DISTINCT jel.account_id
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  WHERE je.created_by = 'seed-system'
    AND je.status = 'posted'
);


-- ============================================================================
-- 2. TIMESHEETS — Approved timesheets for payroll export testing
-- ============================================================================

-- Employee 1: Jake Miller — field crew lead
INSERT INTO timesheets (user_id, user_name, user_email, week_ending, status, railroad_working_on, work_location, nights_out, layovers, submitted_at, approved_by, approved_by_name, approved_at, notes)
VALUES
  ('seed-jake', 'Jake Miller', 'jake@bandbmetals.com', '2026-03-08', 'approved', 'Norfolk Southern', 'Shepherdsville, KY', 5, 1, '2026-03-09 08:00:00-05', 'seed-admin', 'Andrew Sieg', '2026-03-09 10:00:00-05', 'Full week on NS yard'),
  ('seed-jake', 'Jake Miller', 'jake@bandbmetals.com', '2026-03-15', 'approved', 'Norfolk Southern', 'Shepherdsville, KY', 4, 0, '2026-03-16 08:00:00-05', 'seed-admin', 'Andrew Sieg', '2026-03-16 10:00:00-05', NULL),
  ('seed-jake', 'Jake Miller', 'jake@bandbmetals.com', '2026-03-22', 'approved', 'Norfolk Southern', 'Corbin, KY', 5, 1, '2026-03-23 08:00:00-05', 'seed-admin', 'Andrew Sieg', '2026-03-23 10:00:00-05', 'Corbin job site')
ON CONFLICT (user_id, week_ending) DO NOTHING;

-- Employee 2: Tommy Reeves — mechanic
INSERT INTO timesheets (user_id, user_name, user_email, week_ending, status, railroad_working_on, work_location, nights_out, layovers, submitted_at, approved_by, approved_by_name, approved_at, notes)
VALUES
  ('seed-tommy', 'Tommy Reeves', 'tommy@bandbmetals.com', '2026-03-08', 'approved', 'Norfolk Southern', 'Shepherdsville, KY', 3, 0, '2026-03-09 09:00:00-05', 'seed-admin', 'Andrew Sieg', '2026-03-09 10:30:00-05', NULL),
  ('seed-tommy', 'Tommy Reeves', 'tommy@bandbmetals.com', '2026-03-15', 'approved', 'Norfolk Southern', 'Shepherdsville, KY', 4, 1, '2026-03-16 09:00:00-05', 'seed-admin', 'Andrew Sieg', '2026-03-16 10:30:00-05', NULL),
  ('seed-tommy', 'Tommy Reeves', 'tommy@bandbmetals.com', '2026-03-22', 'approved', 'CSX', 'Louisville, KY', 5, 1, '2026-03-23 09:00:00-05', 'seed-admin', 'Andrew Sieg', '2026-03-23 10:30:00-05', 'CSX Louisville yard')
ON CONFLICT (user_id, week_ending) DO NOTHING;

-- Employee 3: Carlos Hernandez — operator
INSERT INTO timesheets (user_id, user_name, user_email, week_ending, status, railroad_working_on, work_location, nights_out, layovers, submitted_at, approved_by, approved_by_name, approved_at, notes)
VALUES
  ('seed-carlos', 'Carlos Hernandez', 'carlos@bandbmetals.com', '2026-03-08', 'approved', 'Norfolk Southern', 'Shepherdsville, KY', 5, 1, '2026-03-09 07:00:00-05', 'seed-admin', 'Andrew Sieg', '2026-03-09 10:00:00-05', NULL),
  ('seed-carlos', 'Carlos Hernandez', 'carlos@bandbmetals.com', '2026-03-15', 'approved', 'Norfolk Southern', 'Shepherdsville, KY', 5, 1, '2026-03-16 07:00:00-05', 'seed-admin', 'Andrew Sieg', '2026-03-16 10:00:00-05', NULL)
ON CONFLICT (user_id, week_ending) DO NOTHING;

-- Daily logs for Jake's week of 3/8
INSERT INTO timesheet_daily_logs (timesheet_id, log_date, start_time, end_time, hours_worked, travel_hours, description, sort_order)
SELECT t.id, d.log_date, d.start_time, d.end_time, d.hours_worked, d.travel_hours, d.description, d.sort_order
FROM timesheets t,
(VALUES
  ('2026-03-03'::date, '06:00'::time, '16:30'::time, 10.0, 0.5, 'TPS install — track 3, 142 ties', 1),
  ('2026-03-04'::date, '06:00'::time, '16:00'::time, 9.5, 0.5, 'TPS install — track 3, 138 ties', 2),
  ('2026-03-05'::date, '06:00'::time, '17:00'::time, 10.5, 0.5, 'TPS install — track 4, 155 ties', 3),
  ('2026-03-06'::date, '06:00'::time, '16:00'::time, 9.5, 0.5, 'TPS calibration + test run', 4),
  ('2026-03-07'::date, '06:00'::time, '14:00'::time, 7.5, 1.0, 'Punch list + drive home', 5)
) AS d(log_date, start_time, end_time, hours_worked, travel_hours, description, sort_order)
WHERE t.user_id = 'seed-jake' AND t.week_ending = '2026-03-08'
ON CONFLICT DO NOTHING;

-- Daily logs for Tommy's week of 3/8
INSERT INTO timesheet_daily_logs (timesheet_id, log_date, start_time, end_time, hours_worked, travel_hours, description, sort_order)
SELECT t.id, d.log_date, d.start_time, d.end_time, d.hours_worked, d.travel_hours, d.description, d.sort_order
FROM timesheets t,
(VALUES
  ('2026-03-04'::date, '07:00'::time, '16:00'::time, 8.5, 0.5, 'Truck 01 brake inspection + repair', 1),
  ('2026-03-05'::date, '07:00'::time, '17:00'::time, 9.5, 0.5, 'Hydraulic hose replacement T01', 2),
  ('2026-03-06'::date, '07:00'::time, '16:30'::time, 9.0, 0.5, 'Fleet PM — oil change T01 + T03', 3)
) AS d(log_date, start_time, end_time, hours_worked, travel_hours, description, sort_order)
WHERE t.user_id = 'seed-tommy' AND t.week_ending = '2026-03-08'
ON CONFLICT DO NOTHING;

-- Daily logs for Carlos's week of 3/8
INSERT INTO timesheet_daily_logs (timesheet_id, log_date, start_time, end_time, hours_worked, travel_hours, description, sort_order)
SELECT t.id, d.log_date, d.start_time, d.end_time, d.hours_worked, d.travel_hours, d.description, d.sort_order
FROM timesheets t,
(VALUES
  ('2026-03-03'::date, '06:00'::time, '16:00'::time, 9.5, 0.5, 'Operated TPS — track 3', 1),
  ('2026-03-04'::date, '06:00'::time, '16:30'::time, 10.0, 0.5, 'Operated TPS — track 3', 2),
  ('2026-03-05'::date, '06:00'::time, '17:00'::time, 10.5, 0.5, 'Operated TPS — track 4', 3),
  ('2026-03-06'::date, '06:00'::time, '16:00'::time, 9.5, 0.5, 'Operated TPS — track 4', 4),
  ('2026-03-07'::date, '06:00'::time, '15:00'::time, 8.5, 0.5, 'Clean-up + load-out', 5)
) AS d(log_date, start_time, end_time, hours_worked, travel_hours, description, sort_order)
WHERE t.user_id = 'seed-carlos' AND t.week_ending = '2026-03-08'
ON CONFLICT DO NOTHING;

-- Note: Per diem entries require a rate_id FK to per_diem_rates.
-- Payroll export works from timesheets + daily_logs. Per diem entries
-- are auto-generated when timesheets are approved through the UI.


-- ============================================================================
-- 3. PART USAGE LOG — Realistic maintenance/repair usage entries
-- ============================================================================

-- Usage 1: Brake shoe replacement on Truck 01
INSERT INTO part_usage (part_id, quantity_used, usage_type, truck_id, truck_name, used_by, used_by_name, usage_date, notes)
SELECT p.id, 1, 'replacement', '01', 'Truck 01', 'seed-tommy', 'Tommy Reeves', '2026-03-05', 'Drive axle brake shoe swap — 180k miles'
FROM parts p WHERE p.part_number = 'BRK-001';

-- Usage 2: Hydraulic hose replacement
INSERT INTO part_usage (part_id, quantity_used, usage_type, truck_id, truck_name, used_by, used_by_name, usage_date, notes)
SELECT p.id, 2, 'repair', '01', 'Truck 01', 'seed-tommy', 'Tommy Reeves', '2026-03-05', 'Replaced both feed & return hoses on main cylinder'
FROM parts p WHERE p.part_number = 'HYD-001';

-- Usage 3: Hydraulic fittings for hose repair
INSERT INTO part_usage (part_id, quantity_used, usage_type, truck_id, truck_name, used_by, used_by_name, usage_date, notes)
SELECT p.id, 4, 'repair', '01', 'Truck 01', 'seed-tommy', 'Tommy Reeves', '2026-03-05', 'JIC fittings for hose replacement'
FROM parts p WHERE p.part_number = 'HYD-002';

-- Usage 4: Oil filter — PM service
INSERT INTO part_usage (part_id, quantity_used, usage_type, truck_id, truck_name, used_by, used_by_name, usage_date, notes)
SELECT p.id, 2, 'maintenance', '01', 'Truck 01', 'seed-tommy', 'Tommy Reeves', '2026-03-06', 'Oil change PM — T01 + T03'
FROM parts p WHERE p.part_number = 'ENG-001';

-- Usage 5: Fuel filters
INSERT INTO part_usage (part_id, quantity_used, usage_type, truck_id, truck_name, used_by, used_by_name, usage_date, notes)
SELECT p.id, 1, 'maintenance', '01', 'Truck 01', 'seed-tommy', 'Tommy Reeves', '2026-03-06', 'Primary fuel filter — PM service'
FROM parts p WHERE p.part_number = 'ENG-002';

-- Usage 6: DEF top-off
INSERT INTO part_usage (part_id, quantity_used, usage_type, truck_id, truck_name, used_by, used_by_name, usage_date, notes)
SELECT p.id, 3, 'maintenance', '01', 'Truck 01', 'seed-tommy', 'Tommy Reeves', '2026-03-10', 'DEF level low on Truck 01 — topped off'
FROM parts p WHERE p.part_number = 'ENG-004';

-- Usage 7: Headlight bulb
INSERT INTO part_usage (part_id, quantity_used, usage_type, truck_id, truck_name, used_by, used_by_name, usage_date, notes)
SELECT p.id, 1, 'replacement', '01', 'Truck 01', 'seed-jake', 'Jake Miller', '2026-03-12', 'Driver side low beam out'
FROM parts p WHERE p.part_number = 'ELE-001';

-- Usage 8: Marker lights
INSERT INTO part_usage (part_id, quantity_used, usage_type, truck_id, truck_name, used_by, used_by_name, usage_date, notes)
SELECT p.id, 3, 'replacement', '01', 'Truck 01', 'seed-jake', 'Jake Miller', '2026-03-12', 'DOT inspection — 3 marker lights out'
FROM parts p WHERE p.part_number = 'ELE-002';

-- Usage 9: Slack adjuster
INSERT INTO part_usage (part_id, quantity_used, usage_type, truck_id, truck_name, used_by, used_by_name, usage_date, notes)
SELECT p.id, 2, 'repair', '01', 'Truck 01', 'seed-tommy', 'Tommy Reeves', '2026-03-18', 'Steer axle slack adjusters not holding — replaced both'
FROM parts p WHERE p.part_number = 'BRK-003';

-- Usage 10: Consumables — shop towels and gloves
INSERT INTO part_usage (part_id, quantity_used, usage_type, truck_id, truck_name, used_by, used_by_name, usage_date, notes)
SELECT p.id, 2, 'other', NULL, NULL, 'seed-tommy', 'Tommy Reeves', '2026-03-20', 'Shop restock'
FROM parts p WHERE p.part_number = 'CON-001';

INSERT INTO part_usage (part_id, quantity_used, usage_type, truck_id, truck_name, used_by, used_by_name, usage_date, notes)
SELECT p.id, 2, 'other', NULL, NULL, 'seed-tommy', 'Tommy Reeves', '2026-03-20', 'Shop restock'
FROM parts p WHERE p.part_number = 'CON-002';

-- Usage 11: Coolant top-off
INSERT INTO part_usage (part_id, quantity_used, usage_type, truck_id, truck_name, used_by, used_by_name, usage_date, notes)
SELECT p.id, 2, 'maintenance', '01', 'Truck 01', 'seed-tommy', 'Tommy Reeves', '2026-03-25', 'Coolant level low — topped off reservoir'
FROM parts p WHERE p.part_number = 'ENG-005';


-- ============================================================================
-- 4. ALERTS & REORDER — Adjust quantities to trigger low-stock and out-of-stock
-- ============================================================================

-- Deplete quantities based on usage above + additional draw-down
-- BRK-001: Started at 4, used 1 → 3, then draw to 2 (= reorder_point, triggers low_stock)
UPDATE parts SET quantity_on_hand = 2, status = 'low_stock', last_used = '2026-03-18'
WHERE part_number = 'BRK-001';

-- BRK-002: Started at 2, draw to 0 (out_of_stock — drum cracked, both used)
UPDATE parts SET quantity_on_hand = 0, status = 'out_of_stock', last_used = '2026-03-22'
WHERE part_number = 'BRK-002';

-- BRK-003: Started at 4, used 2 → 2 (= reorder_point, triggers low_stock)
UPDATE parts SET quantity_on_hand = 2, status = 'low_stock', last_used = '2026-03-18'
WHERE part_number = 'BRK-003';

-- HYD-001: Started at 8, used 2 → 6, draw to 3 (= reorder_point, triggers low_stock)
UPDATE parts SET quantity_on_hand = 3, status = 'low_stock', last_used = '2026-03-25'
WHERE part_number = 'HYD-001';

-- HYD-003: Hydraulic fluid — draw to 1 (below reorder_point of 2)
UPDATE parts SET quantity_on_hand = 1, status = 'low_stock', last_used = '2026-03-28'
WHERE part_number = 'HYD-003';

-- ENG-004: DEF — started at 6, used 3 → 3, draw to 1 (below reorder_point of 2)
UPDATE parts SET quantity_on_hand = 1, status = 'low_stock', last_used = '2026-03-28'
WHERE part_number = 'ENG-004';

-- ELE-003: Fuse kit — started at 3, draw to 0 (out_of_stock)
UPDATE parts SET quantity_on_hand = 0, status = 'out_of_stock', last_used = '2026-04-01'
WHERE part_number = 'ELE-003';

-- CON-001: Shop towels — started at 5, used 2 → 3, draw to 1 (below reorder_point of 2)
UPDATE parts SET quantity_on_hand = 1, status = 'low_stock', last_used = '2026-03-30'
WHERE part_number = 'CON-001';

-- Update remaining parts that had usage to reflect post-usage quantities
UPDATE parts SET quantity_on_hand = quantity_on_hand - 4, last_used = '2026-03-05'
WHERE part_number = 'HYD-002' AND quantity_on_hand >= 4;

UPDATE parts SET quantity_on_hand = quantity_on_hand - 2, last_used = '2026-03-06'
WHERE part_number = 'ENG-001' AND quantity_on_hand >= 2;

UPDATE parts SET quantity_on_hand = quantity_on_hand - 1, last_used = '2026-03-06'
WHERE part_number = 'ENG-002' AND quantity_on_hand >= 1;

UPDATE parts SET quantity_on_hand = quantity_on_hand - 1, last_used = '2026-03-12'
WHERE part_number = 'ELE-001' AND quantity_on_hand >= 1;

UPDATE parts SET quantity_on_hand = quantity_on_hand - 3, last_used = '2026-03-12'
WHERE part_number = 'ELE-002' AND quantity_on_hand >= 3;

UPDATE parts SET quantity_on_hand = quantity_on_hand - 2, last_used = '2026-03-25'
WHERE part_number = 'ENG-005' AND quantity_on_hand >= 2;

UPDATE parts SET quantity_on_hand = quantity_on_hand - 2, last_used = '2026-03-20'
WHERE part_number = 'CON-002' AND quantity_on_hand >= 2;


-- ============================================================================
-- 5. FLEET TRUCKS TABLE — DB-backed truck registry for CRUD management
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_trucks (
  id            TEXT PRIMARY KEY,                 -- e.g. "01", "02", "03"
  name          TEXT NOT NULL,                    -- e.g. "Truck 01"
  vin           TEXT,
  year          INTEGER,
  make          TEXT DEFAULT 'Mack',
  model         TEXT DEFAULT 'Granite',
  license_plate TEXT,
  viam_part_id  TEXT NOT NULL DEFAULT '',         -- Viam machine Part ID
  viam_machine_address TEXT NOT NULL DEFAULT '',
  home_base     TEXT DEFAULT 'Shepherdsville, KY',
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive', 'maintenance', 'decommissioned')),
  has_tps       BOOLEAN NOT NULL DEFAULT true,
  has_cell      BOOLEAN NOT NULL DEFAULT false,
  has_j1939     BOOLEAN NOT NULL DEFAULT true,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_trucks_status ON fleet_trucks(status);

-- Seed the two existing trucks
INSERT INTO fleet_trucks (id, name, vin, year, make, model, viam_part_id, status, has_tps, has_cell, has_j1939, notes) VALUES
  ('00', 'Demo Truck', NULL, NULL, NULL, NULL, '', 'active', true, true, true, 'Simulated data — no real hardware'),
  ('01', 'Truck 01', NULL, 2013, 'Mack', 'Granite', '', 'active', true, true, true, 'First production truck — fully outfitted with TPS, robot cell, J1939')
ON CONFLICT (id) DO NOTHING;

-- Updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_fleet_trucks_updated') THEN
    CREATE TRIGGER trg_fleet_trucks_updated
      BEFORE UPDATE ON fleet_trucks
      FOR EACH ROW EXECUTE FUNCTION update_accounting_timestamp();
  END IF;
END;
$$;
