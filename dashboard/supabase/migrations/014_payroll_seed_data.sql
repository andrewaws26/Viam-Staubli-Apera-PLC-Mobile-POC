-- ============================================================================
-- Migration 014: Payroll Seed Data
-- ============================================================================
-- Adds expenses and mileage to existing approved timesheets so the
-- payroll export page shows realistic data. Also adds maintenance_time
-- and shop_time entries.
-- ============================================================================

-- ── Expenses for Jake's week of 3/8 ────────────────────────────────────

INSERT INTO timesheet_expenses (timesheet_id, expense_date, amount, category, description, needs_reimbursement, payment_type, is_fuel, fuel_vehicle_type, fuel_vehicle_number)
SELECT t.id, d.expense_date, d.amount, d.category, d.description, d.needs_reimbursement, d.payment_type, d.is_fuel, d.fuel_vehicle_type, d.fuel_vehicle_number
FROM timesheets t,
(VALUES
  ('2026-03-03'::date, 85.50, 'fuel', 'Diesel — Pilot, Shepherdsville', false, 'credit', true, 'chase', 'CV-12'),
  ('2026-03-05'::date, 92.30, 'fuel', 'Diesel — Pilot, Corbin', false, 'credit', true, 'chase', 'CV-12'),
  ('2026-03-04'::date, 32.00, 'meals', 'Lunch crew — Waffle House', true, 'cash', false, NULL, NULL),
  ('2026-03-06'::date, 45.00, 'supplies', 'Safety glasses + ear plugs', true, 'cash', false, NULL, NULL)
) AS d(expense_date, amount, category, description, needs_reimbursement, payment_type, is_fuel, fuel_vehicle_type, fuel_vehicle_number)
WHERE t.user_id = 'seed-jake' AND t.week_ending = '2026-03-08';

-- ── Expenses for Tommy's week of 3/8 ──────────────────────────────────

INSERT INTO timesheet_expenses (timesheet_id, expense_date, amount, category, description, needs_reimbursement, payment_type, is_fuel)
SELECT t.id, d.expense_date, d.amount, d.category, d.description, d.needs_reimbursement, d.payment_type, d.is_fuel
FROM timesheets t,
(VALUES
  ('2026-03-04'::date, 125.00, 'parts', 'Brake pads from NAPA — emergency', true, 'cash', false),
  ('2026-03-05'::date, 38.50, 'tools', 'Hydraulic fitting wrench', true, 'cash', false)
) AS d(expense_date, amount, category, description, needs_reimbursement, payment_type, is_fuel)
WHERE t.user_id = 'seed-tommy' AND t.week_ending = '2026-03-08';

-- ── Expenses for Carlos's week of 3/8 ─────────────────────────────────

INSERT INTO timesheet_expenses (timesheet_id, expense_date, amount, category, description, needs_reimbursement, payment_type, is_fuel, fuel_vehicle_type, fuel_vehicle_number)
SELECT t.id, d.expense_date, d.amount, d.category, d.description, d.needs_reimbursement, d.payment_type, d.is_fuel, d.fuel_vehicle_type, d.fuel_vehicle_number
FROM timesheets t,
(VALUES
  ('2026-03-03'::date, 78.40, 'fuel', 'Diesel — BP, Shepherdsville', false, 'credit', true, 'semi', 'T-01'),
  ('2026-03-05'::date, 95.20, 'fuel', 'Diesel — Shell, I-65', false, 'credit', true, 'semi', 'T-01'),
  ('2026-03-06'::date, 28.00, 'meals', 'Lunch — Taco Bell', true, 'cash', false, NULL, NULL)
) AS d(expense_date, amount, category, description, needs_reimbursement, payment_type, is_fuel, fuel_vehicle_type, fuel_vehicle_number)
WHERE t.user_id = 'seed-carlos' AND t.week_ending = '2026-03-08';


-- ── Mileage for Jake's week of 3/8 ────────────────────────────────────

INSERT INTO timesheet_mileage_pay (timesheet_id, log_date, traveling_from, destination, miles, chase_vehicle, description)
SELECT t.id, d.log_date, d.traveling_from, d.destination, d.miles, d.chase_vehicle, d.description
FROM timesheets t,
(VALUES
  ('2026-03-03'::date, 'Shepherdsville, KY', 'NS Yard — Shepherdsville', 12.0, 'CV-12', 'Morning drive to job site'),
  ('2026-03-07'::date, 'NS Yard — Shepherdsville', 'Shepherdsville, KY', 12.0, 'CV-12', 'Drive home Friday')
) AS d(log_date, traveling_from, destination, miles, chase_vehicle, description)
WHERE t.user_id = 'seed-jake' AND t.week_ending = '2026-03-08';

-- ── Mileage for Jake's week of 3/22 (Corbin trip — longer) ────────────

INSERT INTO timesheet_mileage_pay (timesheet_id, log_date, traveling_from, destination, miles, chase_vehicle, description)
SELECT t.id, d.log_date, d.traveling_from, d.destination, d.miles, d.chase_vehicle, d.description
FROM timesheets t,
(VALUES
  ('2026-03-17'::date, 'Shepherdsville, KY', 'Corbin, KY', 165.0, 'CV-12', 'Drive to Corbin job site'),
  ('2026-03-21'::date, 'Corbin, KY', 'Shepherdsville, KY', 165.0, 'CV-12', 'Drive home from Corbin')
) AS d(log_date, traveling_from, destination, miles, chase_vehicle, description)
WHERE t.user_id = 'seed-jake' AND t.week_ending = '2026-03-22';

-- ── Mileage for Tommy's week of 3/22 (Louisville CSX trip) ─────────────

INSERT INTO timesheet_mileage_pay (timesheet_id, log_date, traveling_from, destination, miles, chase_vehicle, description)
SELECT t.id, d.log_date, d.traveling_from, d.destination, d.miles, d.chase_vehicle, d.description
FROM timesheets t,
(VALUES
  ('2026-03-17'::date, 'Shepherdsville, KY', 'CSX Yard — Louisville', 22.0, 'CV-08', 'Drive to CSX Louisville'),
  ('2026-03-21'::date, 'CSX Yard — Louisville', 'Shepherdsville, KY', 22.0, 'CV-08', 'Drive home')
) AS d(log_date, traveling_from, destination, miles, chase_vehicle, description)
WHERE t.user_id = 'seed-tommy' AND t.week_ending = '2026-03-22';


-- ── Maintenance Time for Tommy (mechanic work) ────────────────────────
-- Schema: start_time TIME, stop_time TIME, hours_worked NUMERIC, description TEXT, parts_used TEXT

INSERT INTO timesheet_maintenance_time (timesheet_id, log_date, start_time, stop_time, hours_worked, description, parts_used)
SELECT t.id, d.log_date, d.start_time, d.stop_time, d.hours_worked, d.description, d.parts_used
FROM timesheets t,
(VALUES
  ('2026-03-04'::date, '07:00'::time, '11:30'::time, 4.5, 'Brake shoe replacement — drive axle', 'Brake shoes x4, S-cam bushings x2'),
  ('2026-03-05'::date, '06:30'::time, '12:30'::time, 6.0, 'Hydraulic hose replacement — main cylinder', '3/4" hydraulic hose 12ft, JIC fittings x4'),
  ('2026-03-06'::date, '08:00'::time, '11:00'::time, 3.0, 'PM oil change + fuel filters', '15W-40 oil 10gal, fuel filters x2, oil filter')
) AS d(log_date, start_time, stop_time, hours_worked, description, parts_used)
WHERE t.user_id = 'seed-tommy' AND t.week_ending = '2026-03-08';

-- ── Shop Time for Tommy (second week) ─────────────────────────────────
-- Schema: start_time TIME, stop_time TIME, lunch_minutes INT, hours_worked NUMERIC

INSERT INTO timesheet_shop_time (timesheet_id, log_date, start_time, stop_time, lunch_minutes, hours_worked)
SELECT t.id, d.log_date, d.start_time, d.stop_time, d.lunch_minutes, d.hours_worked
FROM timesheets t,
(VALUES
  ('2026-03-10'::date, '06:00'::time, '14:30'::time, 30, 8.0),
  ('2026-03-11'::date, '06:30'::time, '13:00'::time, 30, 6.0),
  ('2026-03-12'::date, '07:00'::time, '11:30'::time, 30, 4.0)
) AS d(log_date, start_time, stop_time, lunch_minutes, hours_worked)
WHERE t.user_id = 'seed-tommy' AND t.week_ending = '2026-03-15';


-- ── IFTA entries for Jake (state mileage + fuel) ──────────────────────
-- Table: timesheet_ifta_entries — columns: state_code, reportable_miles, gallons_purchased

INSERT INTO timesheet_ifta_entries (timesheet_id, state_code, reportable_miles, gallons_purchased)
SELECT t.id, d.state_code, d.reportable_miles, d.gallons_purchased
FROM timesheets t,
(VALUES
  ('KY', 120.0, 42.0),
  ('TN', 45.0, 0.0)
) AS d(state_code, reportable_miles, gallons_purchased)
WHERE t.user_id = 'seed-jake' AND t.week_ending = '2026-03-08';

INSERT INTO timesheet_ifta_entries (timesheet_id, state_code, reportable_miles, gallons_purchased)
SELECT t.id, d.state_code, d.reportable_miles, d.gallons_purchased
FROM timesheets t,
(VALUES
  ('KY', 330.0, 55.0),
  ('TN', 80.0, 22.0)
) AS d(state_code, reportable_miles, gallons_purchased)
WHERE t.user_id = 'seed-jake' AND t.week_ending = '2026-03-22';

INSERT INTO timesheet_ifta_entries (timesheet_id, state_code, reportable_miles, gallons_purchased)
SELECT t.id, d.state_code, d.reportable_miles, d.gallons_purchased
FROM timesheets t,
(VALUES
  ('KY', 95.0, 35.0)
) AS d(state_code, reportable_miles, gallons_purchased)
WHERE t.user_id = 'seed-carlos' AND t.week_ending = '2026-03-08';
