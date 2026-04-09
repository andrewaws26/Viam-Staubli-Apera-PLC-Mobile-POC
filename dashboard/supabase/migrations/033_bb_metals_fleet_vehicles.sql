-- ---------------------------------------------------------------------------
-- 033: Seed real B&B Metals fleet vehicles
-- Replaces placeholder data (CV-01..05, ST-01..05) with actual fleet numbers.
-- ---------------------------------------------------------------------------

-- Clear placeholder vehicles
DELETE FROM company_vehicles WHERE vehicle_number LIKE 'CV-%' OR vehicle_number LIKE 'ST-%';

-- Chase vehicles (from B&B Metals timesheet system)
INSERT INTO company_vehicles (vehicle_number, vehicle_type) VALUES
  ('#4',  'chase'), ('#6',  'chase'), ('#12', 'chase'),
  ('#15', 'chase'), ('#16', 'chase'), ('#17', 'chase'),
  ('#18', 'chase'), ('#19', 'chase'), ('#22', 'chase'),
  ('#23', 'chase'), ('#24', 'chase'), ('#25', 'chase'),
  ('#26', 'chase'), ('#27', 'chase'), ('#28', 'chase'),
  ('#29', 'chase'), ('#30', 'chase'), ('#31', 'chase'),
  ('#32', 'chase'), ('#33', 'chase'), ('#34', 'chase'),
  ('#35', 'chase'), ('#37', 'chase'), ('#38', 'chase'),
  ('#39', 'chase'), ('#40', 'chase'), ('#42', 'chase'),
  ('#43', 'chase'), ('#44', 'chase'), ('#46', 'chase'),
  ('#47', 'chase'), ('#48', 'chase'), ('#49', 'chase'),
  ('#50', 'chase'), ('#51', 'chase'), ('#52', 'chase'),
  ('#53', 'chase'), ('#54', 'chase'), ('#55 a', 'chase'),
  ('Rental Car', 'chase')
ON CONFLICT (vehicle_number) DO NOTHING;

-- Semi trucks (from B&B Metals timesheet system)
INSERT INTO company_vehicles (vehicle_number, vehicle_type) VALUES
  ('T-16', 'semi'), ('T-17', 'semi'), ('T-18', 'semi'),
  ('T-21', 'semi'), ('T-22', 'semi'), ('T-23', 'semi'),
  ('T-24', 'semi'), ('T-25', 'semi'), ('T-26', 'semi'),
  ('T-27', 'semi'), ('T-28', 'semi'), ('T-29', 'semi'),
  ('T-30', 'semi'), ('T-31', 'semi'), ('T-32', 'semi'),
  ('T-33', 'semi'), ('T-34', 'semi'), ('T-35', 'semi'),
  ('T-36', 'semi'), ('T-37', 'semi'), ('T-38', 'semi'),
  ('T-39', 'semi'), ('T-40', 'semi'), ('T-41', 'semi'),
  ('T-42', 'semi'), ('T-43', 'semi'), ('T-44', 'semi'),
  ('T-45', 'semi'), ('T-46', 'semi'), ('T-47', 'semi'),
  ('T-49', 'semi'), ('T-50', 'semi'), ('T-51', 'semi'),
  ('T-52', 'semi'), ('T-53', 'semi'), ('T-54', 'semi'),
  ('T-55', 'semi'), ('T-56', 'semi'), ('T-57', 'semi'),
  ('T-58', 'semi'), ('T-59', 'semi')
ON CONFLICT (vehicle_number) DO NOTHING;
