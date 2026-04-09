-- 031: Truck Digital Twin Snapshots
-- Captures the full sensor payload at a specific point in time.
-- Used for before/after comparisons, boss demos, shift documentation.

CREATE TABLE IF NOT EXISTS truck_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  truck_id TEXT NOT NULL,
  truck_name TEXT,
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  label TEXT,
  notes TEXT,
  source TEXT DEFAULT 'live' CHECK (source IN ('live', 'historical')),
  reading_data JSONB NOT NULL,
  -- Denormalized key metrics for list/card view
  engine_rpm NUMERIC,
  vehicle_speed_mph NUMERIC,
  coolant_temp_f NUMERIC,
  battery_voltage_v NUMERIC,
  engine_hours NUMERIC,
  vehicle_distance_mi NUMERIC,
  vin TEXT,
  active_dtc_count INTEGER DEFAULT 0
);

CREATE INDEX idx_truck_snapshots_truck ON truck_snapshots(truck_id);
CREATE INDEX idx_truck_snapshots_created ON truck_snapshots(created_at DESC);
CREATE INDEX idx_truck_snapshots_user ON truck_snapshots(created_by);
