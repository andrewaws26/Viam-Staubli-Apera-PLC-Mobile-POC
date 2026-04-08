-- ============================================================================
-- Migration 010: Inventory & Parts Tracking
-- ============================================================================
-- Parts catalog with stock levels, reorder points, and usage logging.
-- Usage entries link to maintenance time entries for cost tracking.
-- ============================================================================

-- ── Parts Catalog ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_number         TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,
  category            TEXT NOT NULL DEFAULT 'other'
                        CHECK (category IN ('hydraulic','electrical','engine','transmission',
                          'brake','suspension','body','safety','consumable','tool','other')),
  unit_cost           NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit                TEXT NOT NULL DEFAULT 'each',
  quantity_on_hand    INTEGER NOT NULL DEFAULT 0,
  reorder_point       INTEGER NOT NULL DEFAULT 5,
  reorder_quantity    INTEGER NOT NULL DEFAULT 10,
  location            TEXT NOT NULL DEFAULT 'shop'
                        CHECK (location IN ('shop','truck','warehouse','field','other')),
  supplier            TEXT,
  supplier_part_number TEXT,
  status              TEXT NOT NULL DEFAULT 'in_stock'
                        CHECK (status IN ('in_stock','low_stock','out_of_stock','discontinued')),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  last_ordered        DATE,
  last_used           DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category);
CREATE INDEX IF NOT EXISTS idx_parts_status ON parts(status);
CREATE INDEX IF NOT EXISTS idx_parts_active ON parts(is_active);
CREATE INDEX IF NOT EXISTS idx_parts_location ON parts(location);

-- ── Part Usage Log ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS part_usage (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id               UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  quantity_used         INTEGER NOT NULL CHECK (quantity_used > 0),
  usage_type            TEXT NOT NULL DEFAULT 'maintenance'
                          CHECK (usage_type IN ('maintenance','repair','replacement','inspection','other')),
  truck_id              TEXT,
  truck_name            TEXT,
  maintenance_entry_id  UUID,
  used_by               TEXT NOT NULL,
  used_by_name          TEXT NOT NULL,
  usage_date            DATE NOT NULL,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_part ON part_usage(part_id);
CREATE INDEX IF NOT EXISTS idx_usage_date ON part_usage(usage_date);
CREATE INDEX IF NOT EXISTS idx_usage_truck ON part_usage(truck_id);
CREATE INDEX IF NOT EXISTS idx_usage_type ON part_usage(usage_type);

-- ── Updated_at trigger ───────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parts_updated') THEN
    CREATE TRIGGER trg_parts_updated
      BEFORE UPDATE ON parts
      FOR EACH ROW EXECUTE FUNCTION update_accounting_timestamp();
  END IF;
END;
$$;

-- ── Seed: Common heavy-duty truck parts ──────────────────────────────

INSERT INTO parts (part_number, name, category, unit_cost, unit, quantity_on_hand, reorder_point, reorder_quantity, location) VALUES
  ('HYD-001', 'Hydraulic Hose 1/2" x 36"',     'hydraulic',   45.00, 'each', 8,  3, 10, 'shop'),
  ('HYD-002', 'Hydraulic Fitting JIC-8',         'hydraulic',   12.50, 'each', 20, 5, 20, 'shop'),
  ('HYD-003', 'Hydraulic Fluid AW-46 (5 gal)',   'hydraulic',   65.00, 'each', 4,  2, 4,  'shop'),
  ('ENG-001', 'Oil Filter (Mack MP7/8)',          'engine',      28.00, 'each', 12, 4, 12, 'shop'),
  ('ENG-002', 'Fuel Filter Primary',              'engine',      35.00, 'each', 10, 3, 10, 'shop'),
  ('ENG-003', 'Fuel Filter Secondary',            'engine',      42.00, 'each', 10, 3, 10, 'shop'),
  ('ENG-004', 'DEF Fluid (2.5 gal)',             'engine',      18.00, 'each', 6,  2, 6,  'shop'),
  ('ENG-005', 'Coolant (1 gal)',                  'engine',      22.00, 'each', 8,  3, 8,  'shop'),
  ('ELE-001', 'Headlight Bulb H11',              'electrical',  15.00, 'each', 6,  2, 6,  'shop'),
  ('ELE-002', 'Marker Light LED',                 'electrical',   8.00, 'each', 12, 4, 12, 'shop'),
  ('ELE-003', 'Fuse Assortment Kit',              'electrical',  25.00, 'each', 3,  1, 3,  'shop'),
  ('BRK-001', 'Brake Shoe Set (Drive Axle)',      'brake',      185.00, 'set',  4,  2, 4,  'shop'),
  ('BRK-002', 'Brake Drum',                       'brake',      280.00, 'each', 2,  1, 2,  'warehouse'),
  ('BRK-003', 'Slack Adjuster',                   'brake',       95.00, 'each', 4,  2, 4,  'shop'),
  ('CON-001', 'Shop Towels (box)',                'consumable',  12.00, 'box',  5,  2, 5,  'shop'),
  ('CON-002', 'Nitrile Gloves (box/100)',         'consumable',  15.00, 'box',  4,  2, 4,  'shop'),
  ('CON-003', 'WD-40 (16 oz)',                    'consumable',   8.50, 'each', 6,  2, 6,  'shop'),
  ('CON-004', 'Zip Ties Assortment',              'consumable',  10.00, 'bag',  3,  1, 3,  'shop'),
  ('SAF-001', 'Safety Vest Class 2',              'safety',      18.00, 'each', 10, 3, 10, 'shop'),
  ('SAF-002', 'Hard Hat',                          'safety',      25.00, 'each', 5,  2, 5,  'shop'),
  ('TL-001',  'Torque Wrench 1/2"',              'tool',       125.00, 'each', 2,  1, 2,  'shop'),
  ('TL-002',  'Grease Gun',                       'tool',        55.00, 'each', 3,  1, 3,  'shop')
ON CONFLICT (part_number) DO NOTHING;
