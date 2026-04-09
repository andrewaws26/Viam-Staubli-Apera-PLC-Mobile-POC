-- ============================================================================
-- Migration 037: Multi-State Payroll Tax Support
-- ============================================================================
-- B&B Metals sends crews to work in KY, IN, OH, TN, IL, WV, VA, MI, WI.
-- This migration adds per-state tax configs, progressive bracket support,
-- reciprocity tracking, and a work_state column on employee_tax_profiles
-- so the payroll engine can withhold for the correct jurisdiction.
--
-- Depends on: 020_payroll_tax.sql (employee_tax_profiles, tax_rate_tables)
-- ============================================================================

-- ── State Tax Configurations ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS state_tax_configs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code            CHAR(2) NOT NULL,
  state_name            TEXT NOT NULL,
  tax_year              INT NOT NULL DEFAULT 2026,
  tax_type              TEXT NOT NULL CHECK (tax_type IN ('flat', 'progressive', 'none')),
  flat_rate             NUMERIC(6,4),            -- for flat-rate states (e.g., KY 0.04)
  has_local_tax         BOOLEAN DEFAULT false,
  sui_wage_base         NUMERIC(12,2),           -- state unemployment wage base
  sui_new_employer_rate NUMERIC(6,4),            -- new employer SUI rate
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(state_code, tax_year)
);

CREATE INDEX IF NOT EXISTS idx_state_tax_configs_lookup
  ON state_tax_configs(state_code, tax_year);

-- ── State Tax Brackets (progressive states) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS state_tax_brackets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_tax_config_id   UUID NOT NULL REFERENCES state_tax_configs(id) ON DELETE CASCADE,
  filing_status         TEXT NOT NULL DEFAULT 'single'
    CHECK (filing_status IN ('single', 'married_filing_jointly', 'head_of_household')),
  bracket_min           NUMERIC(14,2) NOT NULL DEFAULT 0,
  bracket_max           NUMERIC(14,2),           -- NULL = no cap (top bracket)
  rate                  NUMERIC(6,4) NOT NULL,   -- decimal rate (e.g., 0.035 for 3.5%)
  flat_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,  -- base tax for this bracket
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_state_tax_brackets_config
  ON state_tax_brackets(state_tax_config_id, filing_status, bracket_min);

-- ── State Reciprocity Agreements ────────────────────────────────────────────
-- When two states have reciprocity, an employee living in state A and working
-- in state B only owes tax to their home state (A). The employer withholds for
-- the home state, not the work state.

CREATE TABLE IF NOT EXISTS state_reciprocity (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_state            CHAR(2) NOT NULL,        -- employee's state of residence
  work_state            CHAR(2) NOT NULL,        -- state where work is performed
  tax_year              INT NOT NULL DEFAULT 2026,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(home_state, work_state, tax_year)
);

CREATE INDEX IF NOT EXISTS idx_state_reciprocity_lookup
  ON state_reciprocity(home_state, work_state, tax_year);

-- ── Add work_state to employee_tax_profiles ─────────────────────────────────
-- "state" = home/residence state (already exists, drives W-4 withholding)
-- "work_state" = where the employee is currently working (may differ per pay period)

ALTER TABLE employee_tax_profiles
  ADD COLUMN IF NOT EXISTS work_state CHAR(2) DEFAULT 'KY';

COMMENT ON COLUMN employee_tax_profiles.work_state IS
  'State where employee is currently working. May differ from home state. Updated per pay period for traveling crews.';

-- ============================================================================
-- SEED DATA: 2026 State Tax Configurations
-- ============================================================================

-- ── State configs ───────────────────────────────────────────────────────────

INSERT INTO state_tax_configs
  (state_code, state_name, tax_year, tax_type, flat_rate, has_local_tax, sui_wage_base, sui_new_employer_rate, notes)
VALUES
  ('KY', 'Kentucky',      2026, 'flat',        0.0400, false, 11400.00, 0.0270,
    'Flat 4% income tax. Home state for B&B Metals (Shepherdsville, Bullitt County).'),
  ('IN', 'Indiana',        2026, 'flat',        0.0305, true,  9500.00, 0.0250,
    'Flat 3.05% state rate (2026). County taxes apply but are not yet modeled.'),
  ('OH', 'Ohio',           2026, 'progressive', NULL,   false, 9000.00, 0.0270,
    'Progressive 0-3.5% (2026). OH eliminated several lower brackets recently.'),
  ('TN', 'Tennessee',      2026, 'none',        NULL,   false, 7000.00, 0.0260,
    'No state income tax. SUI only.'),
  ('IL', 'Illinois',       2026, 'flat',        0.0495, false, 13590.00, 0.0275,
    'Flat 4.95% income tax.'),
  ('WV', 'West Virginia',  2026, 'progressive', NULL,   false, 9000.00, 0.0270,
    'Progressive 3-6.5% (2026).'),
  ('VA', 'Virginia',       2026, 'progressive', NULL,   false, 8000.00, 0.0273,
    'Progressive 2-5.75%.'),
  ('MI', 'Michigan',       2026, 'flat',        0.0425, false, 9500.00, 0.0270,
    'Flat 4.25% income tax.'),
  ('WI', 'Wisconsin',      2026, 'progressive', NULL,   false, 14000.00, 0.0305,
    'Progressive 3.5-7.65%.')
ON CONFLICT (state_code, tax_year) DO NOTHING;

-- ── Ohio progressive brackets (2026) ────────────────────────────────────────

WITH oh_config AS (
  SELECT id FROM state_tax_configs WHERE state_code = 'OH' AND tax_year = 2026
)
INSERT INTO state_tax_brackets
  (state_tax_config_id, filing_status, bracket_min, bracket_max, rate, flat_amount)
SELECT oh_config.id, vals.filing_status, vals.bracket_min, vals.bracket_max, vals.rate, vals.flat_amount
FROM oh_config, (VALUES
  -- Single filer
  ('single',                      0.00, 26050.00, 0.0000,    0.00),
  ('single',                  26050.00, 46100.00, 0.0275,    0.00),
  ('single',                  46100.00, 92150.00, 0.0300,  551.38),
  ('single',                  92150.00,     NULL, 0.0350, 1932.88),
  -- Married filing jointly (OH uses same brackets for all filers)
  ('married_filing_jointly',      0.00, 26050.00, 0.0000,    0.00),
  ('married_filing_jointly',  26050.00, 46100.00, 0.0275,    0.00),
  ('married_filing_jointly',  46100.00, 92150.00, 0.0300,  551.38),
  ('married_filing_jointly',  92150.00,     NULL, 0.0350, 1932.88)
) AS vals(filing_status, bracket_min, bracket_max, rate, flat_amount);

-- ── West Virginia progressive brackets (2026) ──────────────────────────────

WITH wv_config AS (
  SELECT id FROM state_tax_configs WHERE state_code = 'WV' AND tax_year = 2026
)
INSERT INTO state_tax_brackets
  (state_tax_config_id, filing_status, bracket_min, bracket_max, rate, flat_amount)
SELECT wv_config.id, vals.filing_status, vals.bracket_min, vals.bracket_max, vals.rate, vals.flat_amount
FROM wv_config, (VALUES
  -- Single filer
  ('single',        0.00, 10000.00, 0.0300,    0.00),
  ('single',    10000.00, 25000.00, 0.0400,  300.00),
  ('single',    25000.00, 40000.00, 0.0450,  900.00),
  ('single',    40000.00, 60000.00, 0.0600, 1575.00),
  ('single',    60000.00,     NULL, 0.0650, 2775.00),
  -- Married filing jointly
  ('married_filing_jointly',        0.00, 10000.00, 0.0300,    0.00),
  ('married_filing_jointly',    10000.00, 25000.00, 0.0400,  300.00),
  ('married_filing_jointly',    25000.00, 40000.00, 0.0450,  900.00),
  ('married_filing_jointly',    40000.00, 60000.00, 0.0600, 1575.00),
  ('married_filing_jointly',    60000.00,     NULL, 0.0650, 2775.00)
) AS vals(filing_status, bracket_min, bracket_max, rate, flat_amount);

-- ── Virginia progressive brackets (2026) ────────────────────────────────────

WITH va_config AS (
  SELECT id FROM state_tax_configs WHERE state_code = 'VA' AND tax_year = 2026
)
INSERT INTO state_tax_brackets
  (state_tax_config_id, filing_status, bracket_min, bracket_max, rate, flat_amount)
SELECT va_config.id, vals.filing_status, vals.bracket_min, vals.bracket_max, vals.rate, vals.flat_amount
FROM va_config, (VALUES
  -- Single filer (VA uses same brackets for all filers)
  ('single',        0.00,  3000.00, 0.0200,    0.00),
  ('single',     3000.00,  5000.00, 0.0300,   60.00),
  ('single',     5000.00, 17000.00, 0.0500,  120.00),
  ('single',    17000.00,     NULL, 0.0575,  720.00),
  -- Married filing jointly
  ('married_filing_jointly',        0.00,  3000.00, 0.0200,    0.00),
  ('married_filing_jointly',     3000.00,  5000.00, 0.0300,   60.00),
  ('married_filing_jointly',     5000.00, 17000.00, 0.0500,  120.00),
  ('married_filing_jointly',    17000.00,     NULL, 0.0575,  720.00)
) AS vals(filing_status, bracket_min, bracket_max, rate, flat_amount);

-- ── Wisconsin progressive brackets (2026) ───────────────────────────────────

WITH wi_config AS (
  SELECT id FROM state_tax_configs WHERE state_code = 'WI' AND tax_year = 2026
)
INSERT INTO state_tax_brackets
  (state_tax_config_id, filing_status, bracket_min, bracket_max, rate, flat_amount)
SELECT wi_config.id, vals.filing_status, vals.bracket_min, vals.bracket_max, vals.rate, vals.flat_amount
FROM wi_config, (VALUES
  -- Single filer
  ('single',        0.00, 14320.00, 0.0350,    0.00),
  ('single',    14320.00, 28640.00, 0.0440,  501.20),
  ('single',    28640.00, 315310.00, 0.0530, 1131.28),
  ('single',   315310.00,     NULL, 0.0765, 16324.79),
  -- Married filing jointly
  ('married_filing_jointly',        0.00, 19090.00, 0.0350,    0.00),
  ('married_filing_jointly',    19090.00, 38190.00, 0.0440,  668.15),
  ('married_filing_jointly',    38190.00, 420420.00, 0.0530, 1508.55),
  ('married_filing_jointly',   420420.00,     NULL, 0.0765, 21766.74)
) AS vals(filing_status, bracket_min, bracket_max, rate, flat_amount);

-- ============================================================================
-- SEED DATA: Reciprocity Agreements (2026)
-- ============================================================================
-- Reciprocity means: employee files taxes only in home state, even when
-- working in the partner state. Employer withholds for home state.
-- ============================================================================

-- ── Kentucky reciprocity (KY residents working in these states) ─────────────
INSERT INTO state_reciprocity (home_state, work_state, tax_year, notes) VALUES
  ('KY', 'IL', 2026, 'KY-IL reciprocity agreement'),
  ('KY', 'IN', 2026, 'KY-IN reciprocity agreement'),
  ('KY', 'MI', 2026, 'KY-MI reciprocity agreement'),
  ('KY', 'OH', 2026, 'KY-OH reciprocity agreement'),
  ('KY', 'VA', 2026, 'KY-VA reciprocity agreement'),
  ('KY', 'WV', 2026, 'KY-WV reciprocity agreement'),
  ('KY', 'WI', 2026, 'KY-WI reciprocity agreement')
ON CONFLICT (home_state, work_state, tax_year) DO NOTHING;

-- ── Reverse: residents of those states working in KY ────────────────────────
INSERT INTO state_reciprocity (home_state, work_state, tax_year, notes) VALUES
  ('IL', 'KY', 2026, 'IL-KY reciprocity agreement'),
  ('IN', 'KY', 2026, 'IN-KY reciprocity agreement'),
  ('MI', 'KY', 2026, 'MI-KY reciprocity agreement'),
  ('OH', 'KY', 2026, 'OH-KY reciprocity agreement'),
  ('VA', 'KY', 2026, 'VA-KY reciprocity agreement'),
  ('WV', 'KY', 2026, 'WV-KY reciprocity agreement'),
  ('WI', 'KY', 2026, 'WI-KY reciprocity agreement')
ON CONFLICT (home_state, work_state, tax_year) DO NOTHING;

-- ── Ohio reciprocity (OH residents working in these states) ─────────────────
INSERT INTO state_reciprocity (home_state, work_state, tax_year, notes) VALUES
  ('OH', 'IN', 2026, 'OH-IN reciprocity agreement'),
  ('OH', 'MI', 2026, 'OH-MI reciprocity agreement'),
  ('OH', 'PA', 2026, 'OH-PA reciprocity agreement'),
  ('OH', 'WV', 2026, 'OH-WV reciprocity agreement')
ON CONFLICT (home_state, work_state, tax_year) DO NOTHING;

-- ── Reverse: residents of those states working in OH ────────────────────────
INSERT INTO state_reciprocity (home_state, work_state, tax_year, notes) VALUES
  ('IN', 'OH', 2026, 'IN-OH reciprocity agreement'),
  ('MI', 'OH', 2026, 'MI-OH reciprocity agreement'),
  ('PA', 'OH', 2026, 'PA-OH reciprocity agreement'),
  ('WV', 'OH', 2026, 'WV-OH reciprocity agreement')
ON CONFLICT (home_state, work_state, tax_year) DO NOTHING;

-- ── Indiana reciprocity (IN residents working in these states) ──────────────
INSERT INTO state_reciprocity (home_state, work_state, tax_year, notes) VALUES
  ('IN', 'MI', 2026, 'IN-MI reciprocity agreement'),
  ('IN', 'PA', 2026, 'IN-PA reciprocity agreement'),
  ('IN', 'WI', 2026, 'IN-WI reciprocity agreement')
ON CONFLICT (home_state, work_state, tax_year) DO NOTHING;

-- ── Reverse: residents of those states working in IN ────────────────────────
INSERT INTO state_reciprocity (home_state, work_state, tax_year, notes) VALUES
  ('MI', 'IN', 2026, 'MI-IN reciprocity agreement'),
  ('PA', 'IN', 2026, 'PA-IN reciprocity agreement'),
  ('WI', 'IN', 2026, 'WI-IN reciprocity agreement')
ON CONFLICT (home_state, work_state, tax_year) DO NOTHING;
