-- 040_job_costing.sql
-- Job costing: track bids, costs, revenue, and profitability per job

CREATE SEQUENCE IF NOT EXISTS job_number_seq START 1001;

CREATE OR REPLACE FUNCTION get_next_job_number()
RETURNS text LANGUAGE sql AS $$
  SELECT 'J-' || nextval('job_number_seq')::text;
$$;

CREATE TABLE IF NOT EXISTS jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number      TEXT NOT NULL UNIQUE,
  customer_id     UUID REFERENCES customers(id),
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'bidding'
                    CHECK (status IN ('bidding','active','completed','closed')),
  job_type        TEXT DEFAULT '',
  location        TEXT DEFAULT '',
  bid_amount      NUMERIC(12,2) DEFAULT 0,
  contract_amount NUMERIC(12,2) DEFAULT 0,
  start_date      DATE,
  end_date        DATE,
  estimated_hours NUMERIC(8,2) DEFAULT 0,
  notes           TEXT DEFAULT '',
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_cost_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  cost_type   TEXT NOT NULL
                CHECK (cost_type IN ('labor','per_diem','mileage','fuel',
                       'equipment','material','subcontractor','expense','other')),
  description TEXT DEFAULT '',
  quantity    NUMERIC(10,3) DEFAULT 1,
  rate        NUMERIC(10,2) DEFAULT 0,
  amount      NUMERIC(12,2) NOT NULL,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  source_type TEXT DEFAULT 'manual'
                CHECK (source_type IN ('manual','timesheet','bill','per_diem','expense')),
  source_id   UUID,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Link jobs to existing tables
ALTER TABLE timesheets  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id);
ALTER TABLE invoices    ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id);
ALTER TABLE bills       ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id);
ALTER TABLE estimates   ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id);
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_jobs_customer   ON jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status     ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_job_costs_job   ON job_cost_entries(job_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_job  ON timesheets(job_id)  WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_job    ON invoices(job_id)    WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bills_job       ON bills(job_id)       WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_job   ON estimates(job_id)   WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_job ON work_orders(job_id) WHERE job_id IS NOT NULL;
