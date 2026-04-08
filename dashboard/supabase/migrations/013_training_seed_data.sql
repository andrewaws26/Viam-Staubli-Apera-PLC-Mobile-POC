-- ============================================================================
-- Migration 013: Training Seed Data
-- ============================================================================
-- Adds railroad-specific contractor safety requirements (CSX, Union Pacific,
-- Norfolk Southern) and populates training records for seed employees.
-- Mix of current, expiring soon, and expired records to exercise all statuses.
-- ============================================================================

-- ── New training requirements ──────────────────────────────────────────

INSERT INTO training_requirements (name, description, frequency_months, is_required) VALUES
  ('CSX Contractor Safety',
   'Annual CSX contractor safety orientation — required for all personnel working on CSX property. Covers operating rules, PPE, on-track safety, and emergency procedures.',
   12, true),
  ('Union Pacific Contractor Safety',
   'Annual UP contractor safety training — required for all personnel on UP right-of-way. Covers roadway worker protection, equipment operation near tracks, and UP-specific rules.',
   12, true),
  ('Norfolk Southern Contractor Safety',
   'Annual NS contractor safety orientation per NS Operating Guidelines for Contractors. Covers Roadway Worker Protection, fall protection, PPE requirements, and Right of Entry procedures.',
   12, true),
  ('DOT Drug & Alcohol Awareness',
   'DOT-mandated drug and alcohol awareness training for safety-sensitive employees per 49 CFR Part 382.',
   12, true),
  ('Lockout/Tagout (LOTO)',
   'OSHA 1910.147 control of hazardous energy — required for anyone servicing equipment with moving parts or stored energy.',
   12, false),
  ('Hydraulic Safety',
   'Safe operation and maintenance of high-pressure hydraulic systems. Covers hose inspection, fitting torque, and emergency procedures.',
   24, false)
ON CONFLICT (name) DO NOTHING;


-- ============================================================================
-- Training records for seed employees
-- ============================================================================
-- Employees: seed-jake (Jake Miller), seed-tommy (Tommy Reeves),
--            seed-carlos (Carlos Hernandez), seed-admin (Andrew Sieg)
--
-- Status targets:
--   current       = completed recently, expiry well in the future
--   expiring_soon = expiry within 30 days of 2026-04-08
--   expired       = expiry in the past
--   missing       = no record at all (handled by absence)
-- ============================================================================

-- Helper: insert records referencing requirements by name
-- We use a CTE to look up requirement IDs once

WITH reqs AS (
  SELECT id, name, frequency_months FROM training_requirements
)

-- ── Jake Miller (seed-jake) — mostly current, CSX expiring soon ────────
INSERT INTO training_records (user_id, user_name, requirement_id, completed_date, expiry_date, notes, recorded_by, recorded_by_name)
SELECT * FROM (VALUES
  -- OSHA 10-Hour: one-time, completed 2024 (current, no expiry)
  ('seed-jake', 'Jake Miller', (SELECT id FROM reqs WHERE name = 'OSHA 10-Hour'),
   '2024-06-15'::date, NULL::date,
   'Completed at Kentucky Safety Council', 'seed-admin', 'Andrew Sieg'),

  -- Railroad Safety GCOR: annual, completed 2025-09 (current, expires 2026-09)
  ('seed-jake', 'Jake Miller', (SELECT id FROM reqs WHERE name = 'Railroad Safety (GCOR)'),
   '2025-09-10'::date, '2026-09-10'::date,
   'Annual GCOR refresher', 'seed-admin', 'Andrew Sieg'),

  -- CSX Contractor Safety: annual, completed 2025-04-20 → expires 2026-04-20 (EXPIRING SOON — 12 days out)
  ('seed-jake', 'Jake Miller', (SELECT id FROM reqs WHERE name = 'CSX Contractor Safety'),
   '2025-04-20'::date, '2026-04-20'::date,
   'CSX Jacksonville safety orientation', 'seed-admin', 'Andrew Sieg'),

  -- Union Pacific Contractor Safety: annual, completed 2025-08 (current)
  ('seed-jake', 'Jake Miller', (SELECT id FROM reqs WHERE name = 'Union Pacific Contractor Safety'),
   '2025-08-05'::date, '2026-08-05'::date,
   'UP Omaha contractor orientation', 'seed-admin', 'Andrew Sieg'),

  -- Norfolk Southern Contractor Safety: annual, completed 2025-11 (current)
  ('seed-jake', 'Jake Miller', (SELECT id FROM reqs WHERE name = 'Norfolk Southern Contractor Safety'),
   '2025-11-15'::date, '2026-11-15'::date,
   'NS Shepherdsville yard safety briefing', 'seed-admin', 'Andrew Sieg'),

  -- First Aid/CPR: biennial, completed 2025-03 (current)
  ('seed-jake', 'Jake Miller', (SELECT id FROM reqs WHERE name = 'First Aid / CPR / AED'),
   '2025-03-20'::date, '2027-03-20'::date,
   'American Red Cross', 'seed-admin', 'Andrew Sieg'),

  -- CDL Medical Card: biennial, completed 2025-06 (current)
  ('seed-jake', 'Jake Miller', (SELECT id FROM reqs WHERE name = 'CDL Medical Card'),
   '2025-06-01'::date, '2027-06-01'::date,
   'DOT physical at Concentra Louisville', 'seed-admin', 'Andrew Sieg'),

  -- Roadway Worker Protection: annual, completed 2025-10 (current)
  ('seed-jake', 'Jake Miller', (SELECT id FROM reqs WHERE name = 'Roadway Worker Protection'),
   '2025-10-12'::date, '2026-10-12'::date,
   'FRA RWP annual refresher', 'seed-admin', 'Andrew Sieg'),

  -- DOT Drug & Alcohol: annual, completed 2025-07 (current)
  ('seed-jake', 'Jake Miller', (SELECT id FROM reqs WHERE name = 'DOT Drug & Alcohol Awareness'),
   '2025-07-15'::date, '2026-07-15'::date,
   'Annual DOT D&A awareness', 'seed-admin', 'Andrew Sieg')
) AS v(user_id, user_name, requirement_id, completed_date, expiry_date, notes, recorded_by, recorded_by_name)
WHERE v.requirement_id IS NOT NULL;


-- ── Tommy Reeves (seed-tommy) — NS expired, UP expiring soon ───────────
WITH reqs AS (
  SELECT id, name, frequency_months FROM training_requirements
)
INSERT INTO training_records (user_id, user_name, requirement_id, completed_date, expiry_date, notes, recorded_by, recorded_by_name)
SELECT * FROM (VALUES
  -- OSHA 10-Hour: one-time (current)
  ('seed-tommy', 'Tommy Reeves', (SELECT id FROM reqs WHERE name = 'OSHA 10-Hour'),
   '2023-11-10'::date, NULL::date,
   'OSHA 10 via online course', 'seed-admin', 'Andrew Sieg'),

  -- Railroad Safety GCOR: annual, completed 2025-05 (current)
  ('seed-tommy', 'Tommy Reeves', (SELECT id FROM reqs WHERE name = 'Railroad Safety (GCOR)'),
   '2025-05-22'::date, '2026-05-22'::date,
   'GCOR refresher', 'seed-admin', 'Andrew Sieg'),

  -- CSX Contractor Safety: annual, completed 2025-07 (current)
  ('seed-tommy', 'Tommy Reeves', (SELECT id FROM reqs WHERE name = 'CSX Contractor Safety'),
   '2025-07-10'::date, '2026-07-10'::date,
   'CSX annual contractor safety', 'seed-admin', 'Andrew Sieg'),

  -- Union Pacific Contractor Safety: annual, completed 2025-04-15 → expires 2026-04-15 (EXPIRING SOON — 7 days out)
  ('seed-tommy', 'Tommy Reeves', (SELECT id FROM reqs WHERE name = 'Union Pacific Contractor Safety'),
   '2025-04-15'::date, '2026-04-15'::date,
   'UP contractor safety — needs renewal', 'seed-admin', 'Andrew Sieg'),

  -- Norfolk Southern Contractor Safety: EXPIRED — completed 2025-03-01, expired 2026-03-01
  ('seed-tommy', 'Tommy Reeves', (SELECT id FROM reqs WHERE name = 'Norfolk Southern Contractor Safety'),
   '2025-03-01'::date, '2026-03-01'::date,
   'NS safety orientation — EXPIRED, needs immediate renewal', 'seed-admin', 'Andrew Sieg'),

  -- First Aid/CPR: biennial, completed 2024-08 (current)
  ('seed-tommy', 'Tommy Reeves', (SELECT id FROM reqs WHERE name = 'First Aid / CPR / AED'),
   '2024-08-15'::date, '2026-08-15'::date,
   'Red Cross first aid', 'seed-admin', 'Andrew Sieg'),

  -- CDL Medical Card: biennial, completed 2025-01 (current)
  ('seed-tommy', 'Tommy Reeves', (SELECT id FROM reqs WHERE name = 'CDL Medical Card'),
   '2025-01-20'::date, '2027-01-20'::date,
   'DOT physical', 'seed-admin', 'Andrew Sieg'),

  -- Roadway Worker Protection: EXPIRED — completed 2025-02-10, expired 2026-02-10
  ('seed-tommy', 'Tommy Reeves', (SELECT id FROM reqs WHERE name = 'Roadway Worker Protection'),
   '2025-02-10'::date, '2026-02-10'::date,
   'RWP expired — cannot work on track until renewed', 'seed-admin', 'Andrew Sieg'),

  -- Hydraulic Safety: completed 2025-06 (current, non-required)
  ('seed-tommy', 'Tommy Reeves', (SELECT id FROM reqs WHERE name = 'Hydraulic Safety'),
   '2025-06-01'::date, '2027-06-01'::date,
   'Hydraulic safety for shop mechanics', 'seed-admin', 'Andrew Sieg')
) AS v(user_id, user_name, requirement_id, completed_date, expiry_date, notes, recorded_by, recorded_by_name)
WHERE v.requirement_id IS NOT NULL;


-- ── Carlos Hernandez (seed-carlos) — CSX expired, missing UP entirely ──
WITH reqs AS (
  SELECT id, name, frequency_months FROM training_requirements
)
INSERT INTO training_records (user_id, user_name, requirement_id, completed_date, expiry_date, notes, recorded_by, recorded_by_name)
SELECT * FROM (VALUES
  -- OSHA 10-Hour: one-time (current)
  ('seed-carlos', 'Carlos Hernandez', (SELECT id FROM reqs WHERE name = 'OSHA 10-Hour'),
   '2024-02-20'::date, NULL::date,
   'OSHA 10 completed', 'seed-admin', 'Andrew Sieg'),

  -- Railroad Safety GCOR: annual, completed 2026-01 (current)
  ('seed-carlos', 'Carlos Hernandez', (SELECT id FROM reqs WHERE name = 'Railroad Safety (GCOR)'),
   '2026-01-08'::date, '2027-01-08'::date,
   'GCOR annual refresher — just completed', 'seed-admin', 'Andrew Sieg'),

  -- CSX Contractor Safety: EXPIRED — completed 2025-02-01, expired 2026-02-01
  ('seed-carlos', 'Carlos Hernandez', (SELECT id FROM reqs WHERE name = 'CSX Contractor Safety'),
   '2025-02-01'::date, '2026-02-01'::date,
   'CSX safety expired — cannot work CSX property', 'seed-admin', 'Andrew Sieg'),

  -- Union Pacific: NO RECORD (missing — Carlos has never done UP training)

  -- Norfolk Southern Contractor Safety: annual, completed 2025-12 (current)
  ('seed-carlos', 'Carlos Hernandez', (SELECT id FROM reqs WHERE name = 'Norfolk Southern Contractor Safety'),
   '2025-12-01'::date, '2026-12-01'::date,
   'NS safety at Shepherdsville yard', 'seed-admin', 'Andrew Sieg'),

  -- First Aid/CPR: EXPIRING SOON — completed 2024-04-20, expires 2026-04-20 (12 days out)
  ('seed-carlos', 'Carlos Hernandez', (SELECT id FROM reqs WHERE name = 'First Aid / CPR / AED'),
   '2024-04-20'::date, '2026-04-20'::date,
   'First Aid cert expiring soon', 'seed-admin', 'Andrew Sieg'),

  -- CDL Medical Card: biennial, completed 2025-09 (current)
  ('seed-carlos', 'Carlos Hernandez', (SELECT id FROM reqs WHERE name = 'CDL Medical Card'),
   '2025-09-15'::date, '2027-09-15'::date,
   'DOT physical at Concentra', 'seed-admin', 'Andrew Sieg'),

  -- Roadway Worker Protection: annual, completed 2025-11 (current)
  ('seed-carlos', 'Carlos Hernandez', (SELECT id FROM reqs WHERE name = 'Roadway Worker Protection'),
   '2025-11-20'::date, '2026-11-20'::date,
   'FRA RWP refresher', 'seed-admin', 'Andrew Sieg'),

  -- Confined Space: annual, completed 2025-08 (current)
  ('seed-carlos', 'Carlos Hernandez', (SELECT id FROM reqs WHERE name = 'Confined Space Entry'),
   '2025-08-10'::date, '2026-08-10'::date,
   'Confined space entry training', 'seed-admin', 'Andrew Sieg')
) AS v(user_id, user_name, requirement_id, completed_date, expiry_date, notes, recorded_by, recorded_by_name)
WHERE v.requirement_id IS NOT NULL;


-- ── Andrew Sieg (seed-admin) — all current, fully compliant ────────────
WITH reqs AS (
  SELECT id, name, frequency_months FROM training_requirements
)
INSERT INTO training_records (user_id, user_name, requirement_id, completed_date, expiry_date, notes, recorded_by, recorded_by_name)
SELECT * FROM (VALUES
  ('seed-admin', 'Andrew Sieg', (SELECT id FROM reqs WHERE name = 'OSHA 10-Hour'),
   '2023-08-15'::date, NULL::date, 'OSHA 10', 'seed-admin', 'Andrew Sieg'),

  ('seed-admin', 'Andrew Sieg', (SELECT id FROM reqs WHERE name = 'Railroad Safety (GCOR)'),
   '2025-11-01'::date, '2026-11-01'::date, 'GCOR annual', 'seed-admin', 'Andrew Sieg'),

  ('seed-admin', 'Andrew Sieg', (SELECT id FROM reqs WHERE name = 'CSX Contractor Safety'),
   '2025-10-15'::date, '2026-10-15'::date, 'CSX annual safety', 'seed-admin', 'Andrew Sieg'),

  ('seed-admin', 'Andrew Sieg', (SELECT id FROM reqs WHERE name = 'Union Pacific Contractor Safety'),
   '2025-09-20'::date, '2026-09-20'::date, 'UP annual safety', 'seed-admin', 'Andrew Sieg'),

  ('seed-admin', 'Andrew Sieg', (SELECT id FROM reqs WHERE name = 'Norfolk Southern Contractor Safety'),
   '2025-12-10'::date, '2026-12-10'::date, 'NS Shepherdsville', 'seed-admin', 'Andrew Sieg'),

  ('seed-admin', 'Andrew Sieg', (SELECT id FROM reqs WHERE name = 'First Aid / CPR / AED'),
   '2025-06-01'::date, '2027-06-01'::date, 'Red Cross CPR/AED', 'seed-admin', 'Andrew Sieg'),

  ('seed-admin', 'Andrew Sieg', (SELECT id FROM reqs WHERE name = 'CDL Medical Card'),
   '2025-04-01'::date, '2027-04-01'::date, 'DOT physical', 'seed-admin', 'Andrew Sieg'),

  ('seed-admin', 'Andrew Sieg', (SELECT id FROM reqs WHERE name = 'Roadway Worker Protection'),
   '2025-10-01'::date, '2026-10-01'::date, 'FRA RWP', 'seed-admin', 'Andrew Sieg'),

  ('seed-admin', 'Andrew Sieg', (SELECT id FROM reqs WHERE name = 'DOT Drug & Alcohol Awareness'),
   '2025-08-15'::date, '2026-08-15'::date, 'DOT D&A', 'seed-admin', 'Andrew Sieg'),

  ('seed-admin', 'Andrew Sieg', (SELECT id FROM reqs WHERE name = 'Hazmat Awareness'),
   '2024-05-10'::date, '2027-05-10'::date, 'DOT hazmat awareness', 'seed-admin', 'Andrew Sieg')
) AS v(user_id, user_name, requirement_id, completed_date, expiry_date, notes, recorded_by, recorded_by_name)
WHERE v.requirement_id IS NOT NULL;
