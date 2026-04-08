-- ============================================================================
-- Migration 020: Payroll Tax Engine & Benefits
-- ============================================================================
-- Foundation for Phase 2 payroll independence. Adds employee tax profiles,
-- payroll run processing, benefit/deduction plans, and workers comp classes.
-- ============================================================================

-- ── Employee Tax Profiles ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_tax_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL UNIQUE,          -- matches employee_profiles.user_id
  -- W-4 Information (2020+ format)
  filing_status       TEXT NOT NULL DEFAULT 'single' CHECK (filing_status IN ('single', 'married_filing_jointly', 'head_of_household')),
  multiple_jobs       BOOLEAN NOT NULL DEFAULT false, -- Step 2(c) checkbox
  dependents_credit   NUMERIC(10,2) NOT NULL DEFAULT 0,  -- Step 3: total claim
  other_income        NUMERIC(10,2) NOT NULL DEFAULT 0,  -- Step 4(a)
  deductions          NUMERIC(10,2) NOT NULL DEFAULT 0,  -- Step 4(b)
  extra_withholding   NUMERIC(10,2) NOT NULL DEFAULT 0,  -- Step 4(c) additional per period
  -- State
  state               TEXT NOT NULL DEFAULT 'KY',
  state_withholding   NUMERIC(6,4) NOT NULL DEFAULT 0.04, -- KY flat 4% (2026)
  state_extra_wh      NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Employment info
  pay_frequency       TEXT NOT NULL DEFAULT 'weekly' CHECK (pay_frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  hourly_rate         NUMERIC(10,2),
  salary_annual       NUMERIC(12,2),
  pay_type            TEXT NOT NULL DEFAULT 'hourly' CHECK (pay_type IN ('hourly', 'salary')),
  -- YTD accumulators (reset annually)
  ytd_gross_pay       NUMERIC(14,2) NOT NULL DEFAULT 0,
  ytd_federal_wh      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ytd_state_wh        NUMERIC(14,2) NOT NULL DEFAULT 0,
  ytd_ss_employee     NUMERIC(14,2) NOT NULL DEFAULT 0,
  ytd_medicare_employee NUMERIC(14,2) NOT NULL DEFAULT 0,
  ytd_ss_employer     NUMERIC(14,2) NOT NULL DEFAULT 0,
  ytd_medicare_employer NUMERIC(14,2) NOT NULL DEFAULT 0,
  ytd_futa            NUMERIC(14,2) NOT NULL DEFAULT 0,
  ytd_suta            NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Bank info for direct deposit (encrypted in production via Supabase Vault)
  bank_routing_number TEXT,
  bank_account_number TEXT,                           -- store encrypted
  bank_account_type   TEXT CHECK (bank_account_type IN ('checking', 'savings')),
  -- Meta
  w4_signed_date      DATE,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Tax Rate Tables (updated annually) ───────────────────────────

CREATE TABLE IF NOT EXISTS tax_rate_tables (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_year            INT NOT NULL,
  tax_type            TEXT NOT NULL CHECK (tax_type IN (
    'federal_bracket',    -- Federal income tax brackets
    'ss_rate',            -- Social Security rate
    'ss_wage_base',       -- Social Security wage base limit
    'medicare_rate',      -- Medicare rate
    'medicare_additional_rate', -- Additional Medicare (>$200k)
    'medicare_additional_threshold',
    'futa_rate',          -- FUTA rate
    'futa_wage_base',     -- FUTA wage base
    'futa_credit',        -- FUTA state credit reduction
    'ky_rate',            -- Kentucky state rate
    'suta_rate',          -- State unemployment rate (employer-specific)
    'suta_wage_base',     -- State unemployment wage base
    'standard_deduction'  -- Standard deduction amounts
  )),
  filing_status       TEXT,                           -- null for flat rates
  bracket_min         NUMERIC(14,2) DEFAULT 0,        -- for brackets
  bracket_max         NUMERIC(14,2),                  -- null = no cap
  rate                NUMERIC(10,6) NOT NULL,          -- decimal rate (e.g., 0.062 for 6.2%)
  flat_amount         NUMERIC(14,2) DEFAULT 0,        -- base tax for bracket
  description         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tax_rates_year ON tax_rate_tables(tax_year, tax_type);

-- ── Payroll Runs ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payroll_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period_start    DATE NOT NULL,
  pay_period_end      DATE NOT NULL,
  pay_date            DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted', 'voided')),
  total_gross         NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_net           NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_employer_tax  NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions    NUMERIC(14,2) NOT NULL DEFAULT 0,
  employee_count      INT NOT NULL DEFAULT 0,
  journal_entry_id    UUID REFERENCES journal_entries(id),
  notes               TEXT,
  created_by          TEXT NOT NULL,
  created_by_name     TEXT NOT NULL,
  approved_by         TEXT,
  approved_by_name    TEXT,
  approved_at         TIMESTAMPTZ,
  posted_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Payroll Run Lines (one per employee per run) ─────────────────

CREATE TABLE IF NOT EXISTS payroll_run_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id      UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL,
  employee_name       TEXT NOT NULL,
  -- Hours & earnings
  regular_hours       NUMERIC(8,2) NOT NULL DEFAULT 0,
  overtime_hours      NUMERIC(8,2) NOT NULL DEFAULT 0,
  holiday_hours       NUMERIC(8,2) NOT NULL DEFAULT 0,
  vacation_hours      NUMERIC(8,2) NOT NULL DEFAULT 0,
  hourly_rate         NUMERIC(10,2) NOT NULL DEFAULT 0,
  regular_pay         NUMERIC(12,2) NOT NULL DEFAULT 0,
  overtime_pay        NUMERIC(12,2) NOT NULL DEFAULT 0,
  holiday_pay         NUMERIC(12,2) NOT NULL DEFAULT 0,
  vacation_pay        NUMERIC(12,2) NOT NULL DEFAULT 0,
  per_diem            NUMERIC(12,2) NOT NULL DEFAULT 0,
  mileage_pay         NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Employee deductions
  federal_wh          NUMERIC(10,2) NOT NULL DEFAULT 0,
  state_wh            NUMERIC(10,2) NOT NULL DEFAULT 0,
  ss_employee         NUMERIC(10,2) NOT NULL DEFAULT 0,
  medicare_employee   NUMERIC(10,2) NOT NULL DEFAULT 0,
  benefits_deduction  NUMERIC(10,2) NOT NULL DEFAULT 0,
  other_deductions    NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_deductions    NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_pay             NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Employer taxes
  ss_employer         NUMERIC(10,2) NOT NULL DEFAULT 0,
  medicare_employer   NUMERIC(10,2) NOT NULL DEFAULT 0,
  futa                NUMERIC(10,2) NOT NULL DEFAULT 0,
  suta                NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_employer_tax  NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- References
  timesheet_id        UUID,                           -- linked approved timesheet
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON payroll_run_lines(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_user ON payroll_run_lines(user_id);

-- ── Benefit Plans ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS benefit_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,                   -- e.g. "Blue Cross PPO"
  plan_type           TEXT NOT NULL CHECK (plan_type IN ('health', 'dental', 'vision', '401k', 'hsa', 'life', 'disability', 'other')),
  is_pretax           BOOLEAN NOT NULL DEFAULT true,   -- Section 125 pre-tax
  employee_cost       NUMERIC(10,2) NOT NULL DEFAULT 0, -- per pay period
  employer_cost       NUMERIC(10,2) NOT NULL DEFAULT 0, -- employer contribution per period
  description         TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Employee Benefits Enrollment ─────────────────────────────────

CREATE TABLE IF NOT EXISTS employee_benefits (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  benefit_plan_id     UUID NOT NULL REFERENCES benefit_plans(id),
  enrollment_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  termination_date    DATE,                            -- null = active
  employee_amount     NUMERIC(10,2) NOT NULL DEFAULT 0, -- override per-employee if different
  employer_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, benefit_plan_id)
);

-- ── Workers Compensation Classes ─────────────────────────────────

CREATE TABLE IF NOT EXISTS workers_comp_classes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ncci_code           TEXT NOT NULL UNIQUE,            -- e.g. "5506" Railroad Construction
  description         TEXT NOT NULL,
  rate_per_100        NUMERIC(8,4) NOT NULL,           -- rate per $100 of payroll
  state               TEXT NOT NULL DEFAULT 'KY',
  effective_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Employee Workers Comp Assignment ─────────────────────────────

CREATE TABLE IF NOT EXISTS employee_workers_comp (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  workers_comp_class_id UUID NOT NULL REFERENCES workers_comp_classes(id),
  effective_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, workers_comp_class_id)
);

-- ============================================================================
-- SEED DATA: 2026 Tax Rates
-- ============================================================================

-- Federal income tax brackets (2026 projected — single filer, annualized)
INSERT INTO tax_rate_tables (tax_year, tax_type, filing_status, bracket_min, bracket_max, rate, flat_amount, description) VALUES
  (2026, 'federal_bracket', 'single',                0, 11925, 0.10, 0, '10% bracket'),
  (2026, 'federal_bracket', 'single',            11925, 48475, 0.12, 1192.50, '12% bracket'),
  (2026, 'federal_bracket', 'single',            48475, 103350, 0.22, 5578.50, '22% bracket'),
  (2026, 'federal_bracket', 'single',           103350, 197300, 0.24, 17651.50, '24% bracket'),
  (2026, 'federal_bracket', 'single',           197300, 250525, 0.32, 40199.50, '32% bracket'),
  (2026, 'federal_bracket', 'single',           250525, 626350, 0.35, 57231.50, '35% bracket'),
  (2026, 'federal_bracket', 'single',           626350, NULL, 0.37, 188769.75, '37% bracket'),
  -- Married filing jointly
  (2026, 'federal_bracket', 'married_filing_jointly',     0, 23850, 0.10, 0, '10% bracket'),
  (2026, 'federal_bracket', 'married_filing_jointly', 23850, 96950, 0.12, 2385.00, '12% bracket'),
  (2026, 'federal_bracket', 'married_filing_jointly', 96950, 206700, 0.22, 11157.00, '22% bracket'),
  (2026, 'federal_bracket', 'married_filing_jointly', 206700, 394600, 0.24, 35283.00, '24% bracket'),
  (2026, 'federal_bracket', 'married_filing_jointly', 394600, 501050, 0.32, 80379.00, '32% bracket'),
  (2026, 'federal_bracket', 'married_filing_jointly', 501050, 751600, 0.35, 114443.00, '35% bracket'),
  (2026, 'federal_bracket', 'married_filing_jointly', 751600, NULL, 0.37, 202135.50, '37% bracket'),
  -- Head of household
  (2026, 'federal_bracket', 'head_of_household',         0, 17000, 0.10, 0, '10% bracket'),
  (2026, 'federal_bracket', 'head_of_household',     17000, 64850, 0.12, 1700.00, '12% bracket'),
  (2026, 'federal_bracket', 'head_of_household',     64850, 103350, 0.22, 5442.00, '22% bracket'),
  (2026, 'federal_bracket', 'head_of_household',    103350, 197300, 0.24, 16912.00, '24% bracket'),
  (2026, 'federal_bracket', 'head_of_household',    197300, 250500, 0.32, 38460.00, '32% bracket'),
  (2026, 'federal_bracket', 'head_of_household',    250500, 626350, 0.35, 55484.00, '35% bracket'),
  (2026, 'federal_bracket', 'head_of_household',    626350, NULL, 0.37, 187031.50, '37% bracket');

-- FICA rates
INSERT INTO tax_rate_tables (tax_year, tax_type, rate, flat_amount, description) VALUES
  (2026, 'ss_rate', 0.062, 0, 'Social Security employee/employer rate 6.2%'),
  (2026, 'ss_wage_base', 0, 176100, 'Social Security wage base limit 2026'),
  (2026, 'medicare_rate', 0.0145, 0, 'Medicare employee/employer rate 1.45%'),
  (2026, 'medicare_additional_rate', 0.009, 0, 'Additional Medicare Tax 0.9% (employee only)'),
  (2026, 'medicare_additional_threshold', 0, 200000, 'Additional Medicare threshold $200k');

-- FUTA
INSERT INTO tax_rate_tables (tax_year, tax_type, rate, flat_amount, description) VALUES
  (2026, 'futa_rate', 0.06, 0, 'FUTA gross rate 6.0%'),
  (2026, 'futa_wage_base', 0, 7000, 'FUTA wage base $7,000'),
  (2026, 'futa_credit', 0.054, 0, 'FUTA state credit 5.4% (net rate 0.6%)');

-- Kentucky
INSERT INTO tax_rate_tables (tax_year, tax_type, rate, flat_amount, description) VALUES
  (2026, 'ky_rate', 0.04, 0, 'Kentucky flat income tax 4%'),
  (2026, 'suta_rate', 0.027, 0, 'KY SUTA new employer rate 2.7%'),
  (2026, 'suta_wage_base', 0, 11400, 'KY SUTA wage base $11,400');

-- Standard deductions
INSERT INTO tax_rate_tables (tax_year, tax_type, filing_status, rate, flat_amount, description) VALUES
  (2026, 'standard_deduction', 'single', 0, 15700, 'Standard deduction — single'),
  (2026, 'standard_deduction', 'married_filing_jointly', 0, 31400, 'Standard deduction — MFJ'),
  (2026, 'standard_deduction', 'head_of_household', 0, 22250, 'Standard deduction — HoH');

-- ── Workers Comp seed classes (Kentucky) ─────────────────────────
INSERT INTO workers_comp_classes (ncci_code, description, rate_per_100, state) VALUES
  ('5506', 'Street or Road Construction — Railroad', 8.42, 'KY'),
  ('7219', 'Trucking — Long Distance', 6.75, 'KY'),
  ('8810', 'Clerical Office', 0.21, 'KY'),
  ('3632', 'Machine Shop', 3.18, 'KY'),
  ('5022', 'Masonry', 7.90, 'KY');

-- ── Benefit Plans seed ───────────────────────────────────────────
INSERT INTO benefit_plans (name, plan_type, is_pretax, employee_cost, employer_cost, description) VALUES
  ('Anthem Blue Cross PPO', 'health', true, 125.00, 375.00, 'Family health plan — Anthem PPO network'),
  ('Delta Dental Basic', 'dental', true, 22.50, 22.50, 'Preventive + basic coverage'),
  ('VSP Vision', 'vision', true, 8.50, 8.50, 'Annual exam + frames allowance'),
  ('Empower 401(k)', '401k', true, 0, 0, 'Employee contribution — 3% match up to 6%'),
  ('Lincoln Life AD&D', 'life', false, 5.00, 25.00, '$50,000 group life + AD&D');
