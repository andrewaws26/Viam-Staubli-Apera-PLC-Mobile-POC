-- ============================================================================
-- Migration 015: PTO Seed Data
-- ============================================================================
-- Populates PTO balances for 2026 and creates a mix of approved, pending,
-- and rejected PTO requests for seed employees.
-- ============================================================================

-- ── PTO Balances for 2026 ─────────────────────────────────────────────
-- Defaults: 80h vacation, 40h sick, 24h personal (per migration 011)

INSERT INTO pto_balances (user_id, user_name, year, vacation_hours_total, vacation_hours_used, sick_hours_total, sick_hours_used, personal_hours_total, personal_hours_used)
VALUES
  -- Jake: used some vacation and a sick day
  ('seed-jake', 'Jake Miller', 2026, 80, 24, 40, 8, 24, 8),

  -- Tommy: used vacation, no sick time
  ('seed-tommy', 'Tommy Reeves', 2026, 80, 16, 40, 0, 24, 0),

  -- Carlos: heavy vacation use, some personal
  ('seed-carlos', 'Carlos Hernandez', 2026, 80, 40, 40, 8, 24, 16),

  -- Andrew (admin): minimal use
  ('seed-admin', 'Andrew Sieg', 2026, 120, 8, 40, 0, 24, 0)
ON CONFLICT (user_id, year) DO NOTHING;


-- ── PTO Requests ──────────────────────────────────────────────────────

-- Jake: 3 days vacation in January (approved)
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason, approved_by, approved_by_name, approved_at)
VALUES ('seed-jake', 'Jake Miller', 'jake@bbmetals.com', 'vacation', '2026-01-12', '2026-01-14', 24, 'approved',
  'Family trip to Gatlinburg', 'seed-admin', 'Andrew Sieg', '2026-01-05T14:00:00Z');

-- Jake: sick day in February (approved)
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason, approved_by, approved_by_name, approved_at)
VALUES ('seed-jake', 'Jake Miller', 'jake@bbmetals.com', 'sick', '2026-02-18', '2026-02-18', 8, 'approved',
  'Flu', 'seed-admin', 'Andrew Sieg', '2026-02-18T08:00:00Z');

-- Jake: personal day in March (approved)
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason, approved_by, approved_by_name, approved_at)
VALUES ('seed-jake', 'Jake Miller', 'jake@bbmetals.com', 'personal', '2026-03-28', '2026-03-28', 8, 'approved',
  'Kid dentist appointment', 'seed-admin', 'Andrew Sieg', '2026-03-25T10:00:00Z');

-- Jake: pending vacation request for May
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason)
VALUES ('seed-jake', 'Jake Miller', 'jake@bbmetals.com', 'vacation', '2026-05-25', '2026-05-29', 40, 'pending',
  'Memorial Day week — beach trip with family');


-- Tommy: 2 days vacation in February (approved)
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason, approved_by, approved_by_name, approved_at)
VALUES ('seed-tommy', 'Tommy Reeves', 'tommy@bbmetals.com', 'vacation', '2026-02-09', '2026-02-10', 16, 'approved',
  'Hunting trip — Mammoth Cave area', 'seed-admin', 'Andrew Sieg', '2026-02-02T09:00:00Z');

-- Tommy: rejected vacation request (conflict with NS project)
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason, manager_notes, approved_by, approved_by_name, approved_at)
VALUES ('seed-tommy', 'Tommy Reeves', 'tommy@bbmetals.com', 'vacation', '2026-04-13', '2026-04-17', 40, 'rejected',
  'Spring break with kids', 'NS Shepherdsville project starts that week — need all hands. Can we do the following week?',
  'seed-admin', 'Andrew Sieg', '2026-04-01T11:00:00Z');

-- Tommy: pending personal day
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason)
VALUES ('seed-tommy', 'Tommy Reeves', 'tommy@bbmetals.com', 'personal', '2026-04-22', '2026-04-22', 8, 'pending',
  'Court date — custody paperwork');


-- Carlos: week vacation in January (approved)
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason, approved_by, approved_by_name, approved_at)
VALUES ('seed-carlos', 'Carlos Hernandez', 'carlos@bbmetals.com', 'vacation', '2026-01-19', '2026-01-23', 40, 'approved',
  'Trip to visit family in Mexico', 'seed-admin', 'Andrew Sieg', '2025-12-15T10:00:00Z');

-- Carlos: sick day (approved)
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason, approved_by, approved_by_name, approved_at)
VALUES ('seed-carlos', 'Carlos Hernandez', 'carlos@bbmetals.com', 'sick', '2026-03-12', '2026-03-12', 8, 'approved',
  'Back pain — doctor visit', 'seed-admin', 'Andrew Sieg', '2026-03-12T07:30:00Z');

-- Carlos: personal days in February (approved)
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason, approved_by, approved_by_name, approved_at)
VALUES ('seed-carlos', 'Carlos Hernandez', 'carlos@bbmetals.com', 'personal', '2026-02-23', '2026-02-24', 16, 'approved',
  'Moving to new apartment', 'seed-admin', 'Andrew Sieg', '2026-02-16T14:00:00Z');

-- Carlos: cancelled vacation request
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason)
VALUES ('seed-carlos', 'Carlos Hernandez', 'carlos@bbmetals.com', 'vacation', '2026-06-01', '2026-06-05', 40, 'cancelled',
  'Summer trip — cancelled, saving days for later');

-- Carlos: pending vacation for July 4th week
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason)
VALUES ('seed-carlos', 'Carlos Hernandez', 'carlos@bbmetals.com', 'vacation', '2026-06-29', '2026-07-03', 40, 'pending',
  'July 4th week — family cookout and fireworks');


-- Andrew: 1 day vacation (approved)
INSERT INTO pto_requests (user_id, user_name, user_email, request_type, start_date, end_date, hours_requested, status, reason, approved_by, approved_by_name, approved_at)
VALUES ('seed-admin', 'Andrew Sieg', 'andrew@bbmetals.com', 'vacation', '2026-03-06', '2026-03-06', 8, 'approved',
  'Personal errand day', 'seed-admin', 'Andrew Sieg', '2026-03-04T09:00:00Z');
