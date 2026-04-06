/**
 * Realistic mock data for Playwright E2E tests.
 *
 * Field names match the interfaces in lib/sensor-types.ts and the flat
 * JSON shape returned by /api/sensor-readings and /api/truck-readings.
 */

// ---------------------------------------------------------------------------
// J1939 Truck Readings (TruckSensorReadings)
// ---------------------------------------------------------------------------

export const mockTruckReadings = {
  // Engine
  engine_rpm: 1450,
  engine_load_pct: 62,
  accel_pedal_pos_pct: 35,
  driver_demand_torque_pct: 55,
  actual_engine_torque_pct: 58,
  engine_hours: 4821.3,

  // Temperatures
  coolant_temp_f: 195,
  oil_temp_f: 210,
  fuel_temp_f: 115,
  intake_manifold_temp_f: 140,
  trans_oil_temp_f: 175,
  ambient_temp_f: 72,

  // Pressures
  oil_pressure_psi: 42,
  fuel_pressure_psi: 55,
  boost_pressure_psi: 18.5,
  barometric_pressure_psi: 14.4,

  // Fuel
  fuel_level_pct: 68,
  fuel_rate_gph: 4.2,
  fuel_economy_mpg: 5.8,
  total_fuel_used_gal: 12450,

  // Vehicle / Transmission
  vehicle_speed_mph: 35,
  current_gear: 6,
  selected_gear: 6,
  trans_output_rpm: 1200,

  // Battery
  battery_voltage_v: 13.8,

  // Distance
  vehicle_distance_mi: 87432,
  service_distance_mi: 2150,

  // DM1 Lamps (aggregate)
  malfunction_lamp: 1,
  amber_warning_lamp: 0,
  red_stop_lamp: 0,
  protect_lamp: 0,

  // DTCs
  active_dtc_count: 2,
  dtc_0_spn: 110,
  dtc_0_fmi: 0,
  dtc_0_occurrence: 3,
  dtc_1_spn: 524,
  dtc_1_fmi: 2,
  dtc_1_occurrence: 1,

  // Aftertreatment
  def_level_pct: 82,
  dpf_soot_load_pct: 35,
  dpf_regen_status: 0,

  // Derived
  vehicle_state: "Engine On" as const,
  idle_waste_active: false,
  battery_health: "OK" as const,
  dpf_health: "OK" as const,
  scr_health: "OK" as const,

  // CAN Bus Metadata
  _protocol: "j1939" as const,
  _bus_connected: true,
  _frame_count: 5432,
  _seconds_since_last_frame: 1,

  // Data age (added by API route)
  _data_age_seconds: 3,
};

/** Truck readings with no active DTCs and engine off. */
export const mockTruckReadingsIdle = {
  ...mockTruckReadings,
  engine_rpm: 0,
  vehicle_speed_mph: 0,
  vehicle_state: "Truck Off" as const,
  malfunction_lamp: 0,
  active_dtc_count: 0,
  _data_age_seconds: 5,
};

/** Truck readings simulating offline/stale data. */
export const mockTruckReadingsOffline = {
  _offline: true,
  _reason: "no_recent_data",
};

// ---------------------------------------------------------------------------
// PLC / TPS Sensor Readings (PlcSensorReadings)
// ---------------------------------------------------------------------------

export const mockPlcReadings = {
  // Identity
  truck_id: "truck-001",
  session_id: "sess-abc123",

  // System health
  connected: true,
  fault: false,
  system_state: "running",
  uptime_seconds: 14520,
  shift_hours: 4.03,
  total_reads: 14520,
  total_errors: 2,

  // DS Holding Registers
  ds1: 5,
  ds2: 39,
  ds3: 195,
  ds5: 0,
  ds6: 6070,
  ds7: 1247,
  ds8: 12,
  ds9: 102,
  ds10: 87,
  ds19: 1,

  // Encoder & Track Distance
  encoder_count: 7,
  dd1_frozen: false,
  ds10_frozen: false,
  encoder_direction: "forward" as const,
  encoder_distance_ft: 2847.5,
  encoder_speed_ftpm: 150,
  encoder_revolutions: 342,
  encoder_enabled: true,
  encoder_reset: false,

  // Discrete Inputs
  tps_power_loop: true,
  camera_signal: true,

  // Output Coils
  eject_tps_1: false,
  eject_left_tps_2: false,
  eject_right_tps_2: false,

  // Operating Mode
  operating_mode: "TPS-1",
  mode_tps1_single: true,
  mode_tps1_double: false,
  mode_tps2_both: false,

  // Drop Pipeline
  drop_enable: true,
  drop_enable_latch: true,
  first_tie_detected: true,

  // Detection
  encoder_mode: true,
  camera_positive: false,

  // Signal Metrics
  camera_detections_per_min: 11.5,
  camera_rate_trend: "stable" as const,
  eject_rate_per_min: 11.2,
  encoder_noise: 0.3,
  modbus_response_time_ms: 12,

  // Pi System Health
  cpu_temp_c: 52.1,
  cpu_usage_pct: 18,
  memory_used_pct: 43,
  disk_used_pct: 22,
  wifi_ssid: "B&B Shop",
  wifi_signal_pct: 78,
  tailscale_online: true,
  internet: true,

  // Data age (added by API route)
  _data_age_seconds: 2,
};

/** PLC readings when disconnected from PLC. */
export const mockPlcReadingsDisconnected = {
  connected: false,
  fault: true,
  system_state: "disconnected",
  last_fault: "Modbus TCP timeout after 5 retries",
  uptime_seconds: 14520,
  total_reads: 14518,
  total_errors: 45,
  _data_age_seconds: 8,
};

// ---------------------------------------------------------------------------
// Fleet Status (matches /api/fleet/status response)
// ---------------------------------------------------------------------------

export const mockFleetStatus = {
  trucks: [
    {
      id: "truck-001",
      name: "Truck 1",
      lastSeen: new Date().toISOString(),
      dataAgeSec: 3,
      connected: true,
      tpsOnline: true,
      plateCount: 1247,
      platesPerMin: 12,
      speedFtpm: 150,
      tpsPowerOn: true,
      truckOnline: true,
      engineRpm: 1450,
      engineRunning: true,
      dtcCount: 0,
      coolantTempF: 195,
      hasTPSMonitor: true,
      hasTruckDiagnostics: true,
      error: null,
    },
    {
      id: "truck-002",
      name: "Truck 2",
      lastSeen: new Date(Date.now() - 600_000).toISOString(),
      dataAgeSec: 600,
      connected: false,
      tpsOnline: false,
      plateCount: null,
      platesPerMin: null,
      speedFtpm: null,
      tpsPowerOn: null,
      truckOnline: false,
      engineRpm: null,
      engineRunning: null,
      dtcCount: 2,
      coolantTempF: null,
      hasTPSMonitor: true,
      hasTruckDiagnostics: true,
      error: null,
    },
  ],
  cached: false,
  timestamp: new Date().toISOString(),
};

/** Empty fleet (no trucks configured). */
export const mockFleetStatusEmpty = {
  trucks: [],
  cached: false,
  timestamp: new Date().toISOString(),
};
