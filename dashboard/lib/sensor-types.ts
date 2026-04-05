// Typed interfaces for sensor readings from PLC and J1939 modules.
// Derived from actual Python get_readings() outputs in:
//   - modules/plc-sensor/src/plc_sensor.py
//   - modules/j1939-sensor/src/models/j1939_sensor.py
//
// PRIVACY CONSTRAINT: No operator/personnel identification fields.

// ---------------------------------------------------------------------
// PLC Sensor Readings (plc_sensor.py get_readings)
// ---------------------------------------------------------------------

export interface PlcSensorReadings {
  // -- Identity & session --
  truck_id?: string;
  session_id?: string;

  // -- System health / connection --
  connected?: boolean;
  fault?: boolean;
  system_state?: string; // "running" | "idle" | "disconnected"
  last_fault?: string;
  uptime_seconds?: number;
  shift_hours?: number;
  total_reads?: number;
  total_errors?: number;

  // -- DS Holding Registers (DS1-DS25 from Click PLC) --
  ds1?: number;  // Encoder Ignore threshold
  ds2?: number;  // Adjustable Tie Spacing (x0.5")
  ds3?: number;  // Tie Spacing (x0.1", e.g. 195 = 19.5")
  ds4?: number;
  ds5?: number;  // Detector Offset Bits
  ds6?: number;  // Detector Offset (x0.1")
  ds7?: number;  // Plate Count
  ds8?: number;  // AVG Plates per Min
  ds9?: number;  // Detector Next Tie
  ds10?: number; // Encoder Next Tie -- THE distance source
  ds11?: number;
  ds12?: number;
  ds13?: number;
  ds14?: number;
  ds15?: number;
  ds16?: number;
  ds17?: number;
  ds18?: number;
  ds19?: number; // HMI screen control
  ds20?: number;
  ds21?: number;
  ds22?: number;
  ds23?: number;
  ds24?: number;
  ds25?: number;

  // -- Encoder & Track Distance --
  encoder_count?: number;       // DD1 raw HSC (NOT for distance)
  dd1_frozen?: boolean;
  ds10_frozen?: boolean;
  encoder_direction?: "forward" | "reverse";
  encoder_distance_ft?: number;
  encoder_speed_ftpm?: number;
  encoder_revolutions?: number;
  encoder_enabled?: boolean;
  encoder_reset?: boolean;
  floating_zero?: boolean;

  // -- Discrete Inputs (X1-X8) --
  tps_power_loop?: boolean;       // X4
  camera_signal?: boolean;        // X3
  x1?: boolean;
  x2?: boolean;
  x8?: boolean;

  // -- Output Coils (eject solenoids) --
  eject_tps_1?: boolean;          // Y1
  eject_left_tps_2?: boolean;     // Y2
  eject_right_tps_2?: boolean;    // Y3

  // -- Air Eagle Feedback --
  air_eagle_1_feedback?: boolean;
  air_eagle_2_feedback?: boolean;
  air_eagle_3_enable?: boolean;

  // -- Operating Mode (C-bits, mutually exclusive) --
  operating_mode?: string;
  mode_tps1_single?: boolean;   // C20
  mode_tps1_double?: boolean;   // C21
  mode_tps2_both?: boolean;     // C22
  mode_tps2_left?: boolean;     // C23
  mode_tps2_right?: boolean;    // C24
  mode_tie_team?: boolean;      // C27
  mode_2nd_pass?: boolean;      // C31

  // -- Drop Pipeline (C-bits) --
  drop_enable?: boolean;          // C16
  drop_enable_latch?: boolean;    // C17
  drop_software_eject?: boolean;  // C29
  drop_detector_eject?: boolean;  // C30
  drop_encoder_eject?: boolean;   // C32
  first_tie_detected?: boolean;   // C34

  // -- Detection (C-bits) --
  encoder_mode?: boolean;         // C3
  camera_positive?: boolean;      // C12
  backup_alarm?: boolean;         // C7
  lay_ties_set?: boolean;         // C13
  drop_ties?: boolean;            // C14

  // -- TD Timers --
  td5_seconds_laying?: number;
  td6_tie_travel?: number;

  // -- Production (derived from coil transitions) --
  plate_drop_count?: number;

  // -- Drop Spacing Metrics --
  last_drop_spacing_in?: number;
  avg_drop_spacing_in?: number;
  min_drop_spacing_in?: number;
  max_drop_spacing_in?: number;
  distance_since_last_drop_in?: number;
  drop_count_in_window?: number;

  // -- Signal Metrics (rolling window from SignalMetrics.update) --
  camera_detections_per_min?: number;
  camera_rate_trend?: "stable" | "declining" | "dead" | "intermittent";
  camera_signal_duration_s?: number;
  eject_rate_per_min?: number;
  detector_eject_rate_per_min?: number;
  encoder_noise?: number;
  encoder_reversals_per_min?: number;
  modbus_response_time_ms?: number;

  // -- TPS Power Duration --
  tps_power_duration_s?: number;

  // -- Connection Quality (ConnectionMonitor) --
  eth0_status?: string;
  eth0_diagnosis?: string;
  eth0_error_rate?: number;
  eth0_link_speed_mbps?: number;
  eth0_link_uptime_seconds?: number;
  eth0_crc_errors?: number;
  eth0_link_flaps?: number;

  // -- Location & Weather (cached, refreshes every 15 min) --
  location_city?: string;
  location_region?: string;
  location_timezone?: string;
  weather?: string;
  weather_temp?: string;
  weather_humidity?: string;
  weather_wind?: string;
  local_time?: string;

  // -- Diagnostics --
  diagnostics?: DiagnosticResult[];
  diagnostics_count?: number;
  diagnostics_critical?: number;
  diagnostics_warning?: number;
  diagnostic_log?: string;
  diag_metrics?: string;

  // -- Voice Chat Events --
  chat_events?: unknown[];
  chat_event_count?: number;

  // -- Pi System Health (from system_health.py) --
  cpu_temp_c?: number | null;
  cpu_usage_pct?: number | null;
  load_1m?: number | null;
  load_5m?: number | null;
  memory_total_mb?: number | null;
  memory_used_mb?: number | null;
  memory_used_pct?: number | null;
  disk_used_pct?: number | null;
  disk_free_gb?: number | null;
  wifi_ssid?: string | null;
  wifi_signal_pct?: number | null;
  wifi_signal_dbm?: number | null;
  tailscale_ip?: string | null;
  tailscale_online?: boolean;
  internet?: boolean;

  // -- Sync Health --
  sync_pending_files?: number | null;
  sync_pending_mb?: number | null;
  sync_oldest_age_min?: number | null;
  sync_failed_files?: number | null;
  sync_ok?: boolean | null;
}

// ---------------------------------------------------------------------
// J1939 / Truck Sensor Readings (j1939_sensor.py get_readings)
// ---------------------------------------------------------------------

export interface TruckSensorReadings {
  // -- Engine --
  engine_rpm?: number;
  engine_load_pct?: number;
  accel_pedal_pos_pct?: number;
  driver_demand_torque_pct?: number;
  actual_engine_torque_pct?: number;
  engine_hours?: number;

  // -- Temperatures --
  coolant_temp_f?: number;
  oil_temp_f?: number;
  fuel_temp_f?: number;
  intake_manifold_temp_f?: number;
  trans_oil_temp_f?: number;
  ambient_temp_f?: number;
  hydraulic_oil_temp_f?: number;

  // -- Pressures --
  oil_pressure_psi?: number;
  fuel_pressure_psi?: number;
  boost_pressure_psi?: number;
  barometric_pressure_psi?: number;
  exhaust_gas_pressure_psi?: number;
  hydraulic_oil_pressure_psi?: number;

  // -- Oil --
  oil_level_pct?: number;

  // -- Fuel --
  fuel_level_pct?: number;
  fuel_rate_gph?: number;
  fuel_economy_mpg?: number;
  total_fuel_used_gal?: number;
  idle_fuel_used_gal?: number;
  trip_fuel_gal?: number;
  trip_fuel_2_gal?: number;

  // -- Vehicle / Transmission --
  vehicle_speed_mph?: number;
  current_gear?: number;
  selected_gear?: number;
  trans_output_rpm?: number;
  clutch_slip_pct?: number;
  cruise_control_active?: number;
  front_axle_speed_mph?: number;

  // -- Battery --
  battery_voltage_v?: number;

  // -- Distance --
  vehicle_distance_mi?: number;
  vehicle_distance_hr_mi?: number;
  service_distance_mi?: number;

  // -- Idle --
  idle_engine_hours?: number;

  // -- PTO / Hydraulics --
  pto_engaged?: number;
  pto_rpm?: number;
  pto_set_rpm?: number;
  pto_switches?: number;
  hydraulic_oil_level_pct?: number;
  retarder_torque_pct?: number;
  retarder_torque_mode?: number;

  // -- Brakes --
  brake_pedal_pos_pct?: number;
  abs_active?: number;
  brake_air_pressure_psi?: number;
  air_supply_pressure_psi?: number;
  air_pressure_circuit1_psi?: number;
  air_pressure_circuit2_psi?: number;

  // -- Aftertreatment / Emissions --
  scr_efficiency_pct?: number;
  def_level_pct?: number;
  def_temp_f?: number;
  def_dose_rate_gs?: number;
  def_dose_commanded_gs?: number;
  def_dosing_active?: boolean;
  def_low?: boolean;
  dpf_soot_load_pct?: number;
  dpf_regen_status?: number;
  dpf_regen_inhibit?: number;
  dpf_diff_pressure_psi?: number;
  dpf_inlet_temp_f?: number;
  dpf_outlet_temp_f?: number;
  nox_inlet_ppm?: number;
  nox_outlet_ppm?: number;
  nox_inlet_power_ok?: number;
  nox_inlet_at_temp?: number;
  nox_inlet_reading_stable?: number;
  nox_outlet_power_ok?: number;
  nox_outlet_at_temp?: number;
  nox_outlet_reading_stable?: number;
  scr_catalyst_temp_f?: number;

  // -- Health indicators (derived) --
  dpf_health?: "OK" | "WARNING" | "CRITICAL";
  scr_health?: "OK" | "WARNING" | "CRITICAL";
  battery_health?: "OK" | "LOW" | "CRITICAL" | "OVERCHARGE";

  // -- Navigation / GPS --
  gps_latitude?: number;
  gps_longitude?: number;
  compass_bearing_deg?: number;
  altitude_ft?: number;
  nav_speed_mph?: number;
  vehicle_pitch_deg?: number;

  // -- DM1 Lamp Status (aggregate) --
  protect_lamp?: number;
  amber_warning_lamp?: number;
  red_stop_lamp?: number;
  malfunction_lamp?: number;

  // -- Per-ECU Lamp Status --
  mil_engine?: number;
  amber_lamp_engine?: number;
  red_stop_lamp_engine?: number;
  protect_lamp_engine?: number;
  mil_acm?: number;
  amber_lamp_acm?: number;
  red_stop_lamp_acm?: number;
  protect_lamp_acm?: number;
  mil_trans?: number;
  amber_lamp_trans?: number;
  red_stop_lamp_trans?: number;
  protect_lamp_trans?: number;
  mil_abs?: number;
  amber_lamp_abs?: number;
  red_stop_lamp_abs?: number;
  protect_lamp_abs?: number;

  // -- DTC / Trouble Codes (flat fields emitted by Python) --
  active_dtc_count?: number;
  dtc_0_spn?: number;
  dtc_0_fmi?: number;
  dtc_0_occurrence?: number;
  dtc_1_spn?: number;
  dtc_1_fmi?: number;
  dtc_1_occurrence?: number;
  dtc_2_spn?: number;
  dtc_2_fmi?: number;
  dtc_2_occurrence?: number;
  dtc_3_spn?: number;
  dtc_3_fmi?: number;
  dtc_3_occurrence?: number;
  dtc_4_spn?: number;
  dtc_4_fmi?: number;
  dtc_4_occurrence?: number;
  prev_dtc_count?: number;
  prev_dtc_0_spn?: number;
  prev_dtc_0_fmi?: number;
  prev_dtc_0_occurrence?: number;
  prev_dtc_1_spn?: number;
  prev_dtc_1_fmi?: number;
  prev_dtc_1_occurrence?: number;
  prev_dtc_2_spn?: number;
  prev_dtc_2_fmi?: number;
  prev_dtc_2_occurrence?: number;
  prev_dtc_3_spn?: number;
  prev_dtc_3_fmi?: number;
  prev_dtc_3_occurrence?: number;

  // -- Fan / Turbo / Misc --
  fan_speed_pct?: number;
  turbo_wastegate_pct?: number;

  // -- Derived Fleet Metrics --
  vehicle_state?: "Truck Off" | "Engine On" | "Ignition On" | "Unknown";
  idle_waste_active?: boolean;
  harsh_braking?: boolean;
  harsh_acceleration?: boolean;
  harsh_behavior_flag?: boolean;
  fuel_cost_per_hour?: number;
  fuel_cost_per_mile?: number;
  idle_waste_dollars?: number;
  idle_pct?: number;
  idle_fuel_pct?: number;
  pto_active?: boolean;

  // -- Vehicle Identity --
  vehicle_vin?: string;
  vehicle_protocol?: "j1939" | "obd2";
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_year?: number;

  // -- Proprietary PGNs --
  prop_start_counter_a?: number;
  prop_start_counter_b?: number;

  // -- CAN Bus Metadata --
  _protocol?: "j1939" | "obd2";
  _can_interface?: string;
  _frame_count?: number;
  _bus_connected?: boolean;
  _seconds_since_last_frame?: number;
  _vehicle_off?: boolean;
  can_bitrate?: number;

  // -- Pi System Health (from system_health.py) --
  cpu_temp_c?: number | null;
  cpu_usage_pct?: number | null;
  load_1m?: number | null;
  load_5m?: number | null;
  memory_total_mb?: number | null;
  memory_used_mb?: number | null;
  memory_used_pct?: number | null;
  disk_used_pct?: number | null;
  disk_free_gb?: number | null;
  wifi_ssid?: string | null;
  wifi_signal_pct?: number | null;
  wifi_signal_dbm?: number | null;
  tailscale_ip?: string | null;
  tailscale_online?: boolean;
  internet?: boolean;
  uptime_seconds?: number | null;

  // -- Sync Health --
  sync_pending_files?: number | null;
  sync_pending_mb?: number | null;
  sync_oldest_age_min?: number | null;
  sync_failed_files?: number | null;
  sync_ok?: boolean | null;
}

// ---------------------------------------------------------------------
// Diagnostic Result (from diagnostics.py evaluate())
// ---------------------------------------------------------------------

export type DiagnosticSeverity = "critical" | "warning" | "info";
export type DiagnosticCategory = "camera" | "encoder" | "eject" | "plc" | "operation";

export interface DiagnosticResult {
  rule: string;
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  title: string;
  action: string;
  evidence: string;
}

// ---------------------------------------------------------------------
// Gauge Thresholds (used in TruckPanel.tsx for color coding)
// ---------------------------------------------------------------------

export interface GaugeThreshold {
  /** Value at which gauge turns yellow/warning */
  warn: number;
  /** Value at which gauge turns red/critical */
  crit: number;
  /**
   * When true, values BELOW thresholds trigger warnings
   * (e.g. oil pressure, battery voltage, fuel level).
   * When false/undefined, values ABOVE thresholds trigger warnings
   * (e.g. coolant temp, boost pressure).
   */
  inverted?: boolean;
}

export type GaugeThresholds = Record<string, GaugeThreshold>;
