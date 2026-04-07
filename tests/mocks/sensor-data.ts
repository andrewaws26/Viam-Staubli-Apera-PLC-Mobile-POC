/**
 * Realistic mock truck sensor readings for testing.
 * Based on actual 2024 Mack Granite data from the fleet.
 */

import type { TruckSensorReadings } from '@/types/sensor';

export const MOCK_TRUCK_READINGS: TruckSensorReadings = {
  engine_rpm: 1250,
  engine_load_pct: 42,
  coolant_temp_f: 192,
  oil_temp_f: 205,
  oil_pressure_psi: 48,
  boost_pressure_psi: 18,
  battery_voltage_v: 14.1,
  fuel_level_pct: 67,
  vehicle_speed_mph: 35,
  engine_hours: 786,
  vehicle_distance_mi: 42150,
  def_level_pct: 57.6,
  dpf_soot_load_pct: 22,
  scr_efficiency_pct: 28,
  active_dtc_count: 2,
  dtc_acm_count: 2,
  protect_lamp: 1,
  amber_warning_lamp: 0,
  red_stop_lamp: 0,
  malfunction_lamp: 0,
  protect_lamp_engine: 1,
  protect_lamp_acm: 1,
  vehicle_state: 'Engine On',
  _protocol: 'j1939',
  _bus_connected: true,
};

export const MOCK_FLEET_TRUCKS = [
  { id: 'truck-01', name: 'Truck 01' },
  { id: 'truck-02', name: 'Truck 02' },
  { id: 'mack-granite', name: '2024 Mack Granite' },
];

export const MOCK_TRUCK_NOTE = {
  id: 'test-note-1',
  truck_id: 'truck-01',
  author_id: 'user-1',
  author_name: 'Andrew Sieg',
  author_role: 'developer',
  body: 'Checked coolant level — topped off. Oil pressure looks good.',
  created_at: new Date().toISOString(),
};
