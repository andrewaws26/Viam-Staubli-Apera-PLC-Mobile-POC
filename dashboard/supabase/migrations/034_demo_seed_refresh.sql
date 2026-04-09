-- ---------------------------------------------------------------------------
-- 034: Demo seed data refresh for management tour
-- Ensures Command Center, Work Orders, Training, and Activity Feed have
-- realistic data for the IronSight demo. Idempotent — safe to run repeatedly.
-- ---------------------------------------------------------------------------

-- ============================================================================
-- 1. SUBMITTED TIMESHEETS (show up as "pending approval" in Command Center)
-- ============================================================================
INSERT INTO timesheets (id, user_id, user_name, user_email, week_ending, status, railroad_working_on, chase_vehicles, semi_trucks, work_location, nights_out, layovers, coworkers, submitted_at, notes)
VALUES
  ('d1aaaaaa-0000-0000-0000-000000000001', 'seed-jake', 'Jake Miller', 'jake@bbmetals.com',
   (CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int + 6)::date,
   'submitted', 'Norfolk Southern', '["#4", "#6"]', '["T-16"]', 'Louisville, KY', 2, 1, '[{"id":"seed-carlos","name":"Carlos Hernandez"}]',
   now() - interval '6 hours', 'Regular week — NS mainline tie plate work'),

  ('d1aaaaaa-0000-0000-0000-000000000002', 'seed-tommy', 'Tommy Reeves', 'tommy@bbmetals.com',
   (CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int + 6)::date,
   'submitted', 'CSX', '["#12"]', '["T-17"]', 'Corbin, KY', 3, 2, '[]',
   now() - interval '14 hours', 'CSX Corbin subdivision — 3 night stay'),

  ('d1aaaaaa-0000-0000-0000-000000000003', 'seed-carlos', 'Carlos Hernandez', 'carlos@bbmetals.com',
   (CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int + 6)::date,
   'submitted', 'Norfolk Southern', '["#4"]', '["T-22"]', 'Danville, KY', 4, 3, '[{"id":"seed-jake","name":"Jake Miller"}]',
   now() - interval '2 hours', 'NS Danville sub — heavy production week')
ON CONFLICT (user_id, week_ending) DO UPDATE SET
  status = 'submitted',
  submitted_at = EXCLUDED.submitted_at,
  notes = EXCLUDED.notes;

-- Daily logs for submitted timesheets
INSERT INTO timesheet_daily_logs (timesheet_id, log_date, start_time, end_time, hours_worked, travel_hours, description, sort_order)
SELECT
  t.id,
  (t.week_ending - 6 + gs.d)::date,
  '06:00'::time,
  CASE WHEN gs.d < 5 THEN '16:30'::time ELSE '12:00'::time END,
  CASE WHEN gs.d < 5 THEN 10.5 ELSE 6.0 END,
  CASE WHEN gs.d = 0 THEN 2.0 ELSE 0.0 END,
  CASE
    WHEN gs.d = 0 THEN 'Travel day + tie plate operations'
    WHEN gs.d < 5 THEN 'Tie plate operations — full production'
    ELSE 'Half day wrap-up and travel home'
  END,
  gs.d
FROM timesheets t
CROSS JOIN generate_series(0, 5) AS gs(d)
WHERE t.id IN (
  'd1aaaaaa-0000-0000-0000-000000000001',
  'd1aaaaaa-0000-0000-0000-000000000002',
  'd1aaaaaa-0000-0000-0000-000000000003'
)
AND NOT EXISTS (
  SELECT 1 FROM timesheet_daily_logs dl WHERE dl.timesheet_id = t.id AND dl.log_date = (t.week_ending - 6 + gs.d)::date
);

-- ============================================================================
-- 2. BLOCKED & URGENT WORK ORDERS (show in Command Center red banner)
-- ============================================================================
INSERT INTO work_orders (id, truck_id, title, description, status, priority, blocker_reason, assigned_to, assigned_to_name, created_by, created_by_name, due_date, created_at)
VALUES
  ('a1bbbbbb-0000-0000-0000-000000000001', '01', 'DPF regen failure — Truck 01 sidelined',
   'Truck 01 is throwing DPF codes and won''t complete a forced regen. Parked at the Danville yard. Need the dealer diagnostic tool to clear the soot level sensor.',
   'blocked', 'urgent', 'Waiting on Mack dealer — earliest appointment is Thursday',
   'seed-tommy', 'Tommy Reeves', 'seed-admin', 'Andrew Sieg',
   now() + interval '2 days', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO work_orders (id, truck_id, title, description, status, priority, blocker_reason, assigned_to, assigned_to_name, created_by, created_by_name, created_at)
VALUES
  ('a1bbbbbb-0000-0000-0000-000000000002', '01', 'Replace coolant temp sensor — intermittent readings',
   'Getting wild coolant temp swings on the dashboard (120F to 250F in seconds). Sensor is probably failing. Part is on order.',
   'blocked', 'normal', 'Waiting on part — ETA Wednesday from Mack parts depot',
   'seed-tommy', 'Tommy Reeves', 'seed-admin', 'Andrew Sieg',
   now() - interval '5 days')
ON CONFLICT (id) DO NOTHING;

-- Additional open/in_progress to fill the board
INSERT INTO work_orders (id, truck_id, title, description, status, priority, assigned_to, assigned_to_name, created_by, created_by_name, due_date, created_at)
VALUES
  ('a1bbbbbb-0000-0000-0000-000000000003', NULL, 'Quarterly shop safety inspection',
   'OSHA compliance — check fire extinguishers, eyewash stations, first aid kits, PPE inventory.',
   'open', 'urgent', NULL, NULL, 'seed-admin', 'Andrew Sieg',
   now() + interval '3 days', now() - interval '1 day'),

  ('a1bbbbbb-0000-0000-0000-000000000004', '01', 'Grease all zerks — Truck 01',
   'Monthly preventive maintenance. All chassis grease points, king pins, U-joints.',
   'in_progress', 'normal', 'seed-carlos', 'Carlos Hernandez', 'seed-jake', 'Jake Miller',
   now() + interval '5 days', now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

-- Subtasks for blocked DPF work order
INSERT INTO work_order_subtasks (work_order_id, title, is_done, sort_order)
VALUES
  ('a1bbbbbb-0000-0000-0000-000000000001', 'Pull DTC codes from ECU', true, 0),
  ('a1bbbbbb-0000-0000-0000-000000000001', 'Attempt manual forced regen', true, 1),
  ('a1bbbbbb-0000-0000-0000-000000000001', 'Schedule Mack dealer diagnostic', true, 2),
  ('a1bbbbbb-0000-0000-0000-000000000001', 'Dealer clears soot sensor and runs regen', false, 3),
  ('a1bbbbbb-0000-0000-0000-000000000001', 'Verify no recurring codes after 100 miles', false, 4)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. REFRESH TRAINING EXPIRY DATES (relative to NOW so demo always looks fresh)
-- ============================================================================

-- Clear old training records for seed users and re-insert with fresh dates
DELETE FROM training_records WHERE user_id IN ('seed-jake', 'seed-tommy', 'seed-carlos', 'seed-admin');

-- Jake Miller — mostly current, NS Contractor Safety expiring in 18 days
INSERT INTO training_records (user_id, user_name, requirement_id, completed_date, expiry_date, recorded_by, recorded_by_name, notes)
SELECT 'seed-jake', 'Jake Miller', id, CURRENT_DATE - 180, CURRENT_DATE + 550, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'CDL Medical Card'
UNION ALL SELECT 'seed-jake', 'Jake Miller', id, CURRENT_DATE - 300, CURRENT_DATE + 65, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'Roadway Worker Protection'
UNION ALL SELECT 'seed-jake', 'Jake Miller', id, CURRENT_DATE - 400, CURRENT_DATE + 330, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'First Aid / CPR / AED'
UNION ALL SELECT 'seed-jake', 'Jake Miller', id, CURRENT_DATE - 200, CURRENT_DATE + 165, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'CSX Contractor Safety'
UNION ALL SELECT 'seed-jake', 'Jake Miller', id, CURRENT_DATE - 347, CURRENT_DATE + 18, 'seed-admin', 'Andrew Sieg', 'Expiring soon — needs to renew' FROM training_requirements WHERE name = 'Norfolk Southern Contractor Safety'
UNION ALL SELECT 'seed-jake', 'Jake Miller', id, CURRENT_DATE - 250, CURRENT_DATE + 115, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'Union Pacific Contractor Safety';

-- Tommy Reeves — CSX expired 12 days ago, UP expiring in 8 days
INSERT INTO training_records (user_id, user_name, requirement_id, completed_date, expiry_date, recorded_by, recorded_by_name, notes)
SELECT 'seed-tommy', 'Tommy Reeves', id, CURRENT_DATE - 400, CURRENT_DATE + 330, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'CDL Medical Card'
UNION ALL SELECT 'seed-tommy', 'Tommy Reeves', id, CURRENT_DATE - 200, CURRENT_DATE + 165, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'Roadway Worker Protection'
UNION ALL SELECT 'seed-tommy', 'Tommy Reeves', id, CURRENT_DATE - 100, CURRENT_DATE + 630, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'First Aid / CPR / AED'
UNION ALL SELECT 'seed-tommy', 'Tommy Reeves', id, CURRENT_DATE - 377, CURRENT_DATE - 12, 'seed-admin', 'Andrew Sieg', 'EXPIRED — needs renewal ASAP' FROM training_requirements WHERE name = 'CSX Contractor Safety'
UNION ALL SELECT 'seed-tommy', 'Tommy Reeves', id, CURRENT_DATE - 300, CURRENT_DATE + 65, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'Norfolk Southern Contractor Safety'
UNION ALL SELECT 'seed-tommy', 'Tommy Reeves', id, CURRENT_DATE - 357, CURRENT_DATE + 8, 'seed-admin', 'Andrew Sieg', 'Expiring soon' FROM training_requirements WHERE name = 'Union Pacific Contractor Safety';

-- Carlos Hernandez — NS expired 25 days ago, First Aid expiring in 14 days
INSERT INTO training_records (user_id, user_name, requirement_id, completed_date, expiry_date, recorded_by, recorded_by_name, notes)
SELECT 'seed-carlos', 'Carlos Hernandez', id, CURRENT_DATE - 500, CURRENT_DATE + 230, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'CDL Medical Card'
UNION ALL SELECT 'seed-carlos', 'Carlos Hernandez', id, CURRENT_DATE - 250, CURRENT_DATE + 115, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'Roadway Worker Protection'
UNION ALL SELECT 'seed-carlos', 'Carlos Hernandez', id, CURRENT_DATE - 716, CURRENT_DATE + 14, 'seed-admin', 'Andrew Sieg', 'Expiring soon — renewal class scheduled' FROM training_requirements WHERE name = 'First Aid / CPR / AED'
UNION ALL SELECT 'seed-carlos', 'Carlos Hernandez', id, CURRENT_DATE - 200, CURRENT_DATE + 165, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'CSX Contractor Safety'
UNION ALL SELECT 'seed-carlos', 'Carlos Hernandez', id, CURRENT_DATE - 390, CURRENT_DATE - 25, 'seed-admin', 'Andrew Sieg', 'EXPIRED — flagged for immediate renewal' FROM training_requirements WHERE name = 'Norfolk Southern Contractor Safety';

-- Andrew Sieg (admin) — all current, fully compliant
INSERT INTO training_records (user_id, user_name, requirement_id, completed_date, expiry_date, recorded_by, recorded_by_name, notes)
SELECT 'seed-admin', 'Andrew Sieg', id, CURRENT_DATE - 90, CURRENT_DATE + 640, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'CDL Medical Card'
UNION ALL SELECT 'seed-admin', 'Andrew Sieg', id, CURRENT_DATE - 60, CURRENT_DATE + 305, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'Roadway Worker Protection'
UNION ALL SELECT 'seed-admin', 'Andrew Sieg', id, CURRENT_DATE - 120, CURRENT_DATE + 610, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'First Aid / CPR / AED'
UNION ALL SELECT 'seed-admin', 'Andrew Sieg', id, CURRENT_DATE - 45, CURRENT_DATE + 320, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'CSX Contractor Safety'
UNION ALL SELECT 'seed-admin', 'Andrew Sieg', id, CURRENT_DATE - 30, CURRENT_DATE + 335, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'Norfolk Southern Contractor Safety'
UNION ALL SELECT 'seed-admin', 'Andrew Sieg', id, CURRENT_DATE - 60, CURRENT_DATE + 305, 'seed-admin', 'Andrew Sieg', NULL FROM training_requirements WHERE name = 'Union Pacific Contractor Safety';

-- ============================================================================
-- 4. PTO — ensure at least one pending request exists
-- ============================================================================
INSERT INTO pto_requests (id, user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason, created_at)
VALUES
  ('c1cccccc-0000-0000-0000-000000000001', 'seed-jake', 'Jake Miller', 'jake@bbmetals.com',
   'vacation', CURRENT_DATE + 14, CURRENT_DATE + 18, 40.00, 'pending',
   'Family vacation — already coordinated with Carlos to cover my shifts', now() - interval '1 day')
ON CONFLICT (id) DO UPDATE SET status = 'pending';

INSERT INTO pto_requests (id, user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason, created_at)
VALUES
  ('c1cccccc-0000-0000-0000-000000000002', 'seed-carlos', 'Carlos Hernandez', 'carlos@bbmetals.com',
   'personal', CURRENT_DATE + 7, CURRENT_DATE + 7, 8.00, 'pending',
   'Doctor appointment — need the full day', now() - interval '3 days')
ON CONFLICT (id) DO UPDATE SET status = 'pending';

-- ============================================================================
-- 5. AUDIT LOG — realistic recent activity feed
-- ============================================================================
INSERT INTO audit_log (user_id, user_name, user_role, action, truck_id, details, created_at)
VALUES
  ('seed-carlos', 'Carlos Hernandez', 'operator', 'timesheet_submitted', NULL,
   '{"hours": 58.5}'::jsonb, now() - interval '2 hours'),

  ('seed-tommy', 'Tommy Reeves', 'mechanic', 'timesheet_submitted', NULL,
   '{"hours": 47.0}'::jsonb, now() - interval '14 hours'),

  ('seed-jake', 'Jake Miller', 'mechanic', 'timesheet_submitted', NULL,
   '{"hours": 52.0}'::jsonb, now() - interval '6 hours'),

  ('seed-jake', 'Jake Miller', 'mechanic', 'pto_requested', NULL,
   '{"type": "vacation", "hours": 40}'::jsonb, now() - interval '1 day'),

  ('seed-admin', 'Andrew Sieg', 'developer', 'work_order_created', '01',
   '{"title": "DPF regen failure — Truck 01 sidelined", "priority": "urgent"}'::jsonb,
   now() - interval '3 days'),

  ('seed-tommy', 'Tommy Reeves', 'mechanic', 'work_order_updated', '01',
   '{"title": "DPF regen failure", "new_status": "blocked", "reason": "Waiting on Mack dealer"}'::jsonb,
   now() - interval '2 days'),

  ('seed-admin', 'Andrew Sieg', 'developer', 'work_order_created', NULL,
   '{"title": "Quarterly shop safety inspection", "priority": "urgent"}'::jsonb,
   now() - interval '1 day'),

  ('seed-carlos', 'Carlos Hernandez', 'operator', 'work_order_updated', '01',
   '{"title": "Grease all zerks", "new_status": "in_progress"}'::jsonb,
   now() - interval '4 hours'),

  ('seed-admin', 'Andrew Sieg', 'developer', 'training_recorded', NULL,
   '{"user": "Andrew Sieg", "requirement": "Railroad Safety", "status": "current"}'::jsonb,
   now() - interval '2 days'),

  ('seed-admin', 'Andrew Sieg', 'developer', 'ai_diagnosis', '01',
   '{"summary": "DPF soot load critical — recommend dealer forced regen with diagnostic tool"}'::jsonb,
   now() - interval '3 days'),

  ('seed-jake', 'Jake Miller', 'mechanic', 'shift_report_generated', '01',
   '{"plates": 847, "miles": 12.3}'::jsonb, now() - interval '18 hours'),

  ('seed-tommy', 'Tommy Reeves', 'mechanic', 'maintenance_logged', '01',
   '{"type": "general_service", "description": "Changed oil and all filters, topped off DEF"}'::jsonb,
   now() - interval '4 days'),

  ('seed-carlos', 'Carlos Hernandez', 'operator', 'pto_requested', NULL,
   '{"type": "personal", "hours": 8}'::jsonb, now() - interval '3 days'),

  ('seed-admin', 'Andrew Sieg', 'developer', 'timesheet_approved', NULL,
   '{"user": "Jake Miller", "hours": 48.5}'::jsonb, now() - interval '5 days'),

  ('seed-admin', 'Andrew Sieg', 'developer', 'timesheet_approved', NULL,
   '{"user": "Tommy Reeves", "hours": 40.0}'::jsonb, now() - interval '5 days');
