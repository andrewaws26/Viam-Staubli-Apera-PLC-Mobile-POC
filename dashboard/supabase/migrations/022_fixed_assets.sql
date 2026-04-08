-- Migration 022: Fixed Assets & Depreciation
-- Track capital assets (trucks, equipment), compute depreciation, auto-generate monthly JEs.

CREATE TABLE IF NOT EXISTS fixed_assets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,
  asset_tag           TEXT UNIQUE,              -- internal tracking number
  category            TEXT NOT NULL DEFAULT 'vehicle' CHECK (category IN ('vehicle', 'equipment', 'building', 'land', 'furniture', 'computer', 'other')),
  purchase_date       DATE NOT NULL,
  in_service_date     DATE NOT NULL,
  purchase_cost       NUMERIC(14,2) NOT NULL,
  salvage_value       NUMERIC(14,2) NOT NULL DEFAULT 0,
  useful_life_months  INT NOT NULL,
  depreciation_method TEXT NOT NULL DEFAULT 'straight_line' CHECK (depreciation_method IN ('straight_line', 'declining_balance', 'sum_of_years')),
  -- Current state
  accumulated_depreciation NUMERIC(14,2) NOT NULL DEFAULT 0,
  book_value          NUMERIC(14,2) NOT NULL,  -- purchase_cost - accumulated_depreciation
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fully_depreciated', 'disposed', 'written_off')),
  -- Disposal
  disposal_date       DATE,
  disposal_amount     NUMERIC(14,2),
  disposal_method     TEXT CHECK (disposal_method IN ('sold', 'scrapped', 'traded', 'donated')),
  gain_loss           NUMERIC(14,2),
  -- Links
  linked_truck_id     TEXT,                     -- link to fleet_trucks if applicable
  gl_asset_account_id UUID REFERENCES chart_of_accounts(id),       -- 1300 Fixed Assets
  gl_depreciation_account_id UUID REFERENCES chart_of_accounts(id), -- 6000 Depreciation Expense
  gl_accum_depr_account_id UUID REFERENCES chart_of_accounts(id),   -- 1310 Accumulated Depreciation
  -- Audit
  created_by          TEXT,
  created_by_name     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_status ON fixed_assets(status);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_category ON fixed_assets(category);

CREATE TABLE IF NOT EXISTS depreciation_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixed_asset_id      UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_date         DATE NOT NULL,            -- first of month
  depreciation_amount NUMERIC(14,2) NOT NULL,
  accumulated_total   NUMERIC(14,2) NOT NULL,   -- running total after this entry
  book_value_after    NUMERIC(14,2) NOT NULL,
  journal_entry_id    UUID REFERENCES journal_entries(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(fixed_asset_id, period_date)
);

CREATE INDEX IF NOT EXISTS idx_depr_entries_asset ON depreciation_entries(fixed_asset_id);

-- Add GL accounts for fixed assets if not present
INSERT INTO chart_of_accounts (account_number, name, account_type, normal_balance, is_system, description) VALUES
  ('1300', 'Fixed Assets', 'asset', 'debit', false, 'Vehicles, equipment, and other capital assets'),
  ('1310', 'Accumulated Depreciation', 'asset', 'credit', false, 'Contra-asset: total depreciation taken'),
  ('6000', 'Depreciation Expense', 'expense', 'debit', false, 'Monthly depreciation charges'),
  ('6010', 'Gain/Loss on Asset Disposal', 'expense', 'debit', false, 'Gain or loss when disposing of fixed assets')
ON CONFLICT (account_number) DO NOTHING;
