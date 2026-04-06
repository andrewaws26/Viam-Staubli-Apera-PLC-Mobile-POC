"use client";

import React from "react";

interface TruckReadings {
  [key: string]: unknown;
}

// Gauge thresholds for color coding
const THRESHOLDS: Record<string, { warn: number; crit: number; inverted?: boolean }> = {
  coolant_temp_f: { warn: 203, crit: 221 },
  oil_pressure_psi: { warn: 29, crit: 14.5, inverted: true },
  battery_voltage_v: { warn: 12.0, crit: 11.5, inverted: true },
  oil_temp_f: { warn: 230, crit: 266 },
  fuel_level_pct: { warn: 20, crit: 10, inverted: true },
  boost_pressure_psi: { warn: 36, crit: 43.5 },
  scr_efficiency_pct: { warn: 80, crit: 50, inverted: true },
  def_level_pct: { warn: 15, crit: 5, inverted: true },
  idle_fuel_pct: { warn: 25, crit: 35 },
};

function getValueColor(key: string, value: number): string {
  const t = THRESHOLDS[key as keyof typeof THRESHOLDS];
  if (!t) return "text-gray-100";

  if (t.inverted) {
    if (value <= t.crit) return "text-red-400";
    if (value <= t.warn) return "text-yellow-400";
  } else {
    if (value >= t.crit) return "text-red-400";
    if (value >= t.warn) return "text-yellow-400";
  }
  return "text-gray-100";
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "--";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (typeof value === "string") {
    // Clean display for status strings
    if (value === "OK") return "OK";
    if (value === "WARNING" || value === "LOW") return value;
    if (value === "CRITICAL" || value === "OVERCHARGE") return value;
    return value;
  }
  if (typeof value === "number") {
    if (key.includes("_pct") || key.includes("_pos")) return `${value.toFixed(1)}%`;
    if (key.endsWith("_f")) return `${value.toFixed(0)}\u00B0F`;
    if (key.endsWith("_v")) return `${value.toFixed(1)}V`;
    if (key.endsWith("_psi")) return `${value.toFixed(1)} PSI`;
    if (key.endsWith("_mph")) return `${value.toFixed(0)} mph`;
    if (key.endsWith("_gph")) return `${value.toFixed(1)} gal/h`;
    if (key.endsWith("_mpg")) return `${value.toFixed(1)} mpg`;
    if (key === "engine_rpm") return `${value.toFixed(0)}`;
    if (key === "engine_hours" || key === "idle_engine_hours") return `${value.toFixed(1)} hrs`;
    if (key.endsWith("_gal")) return `${value.toFixed(1)} gal`;
    if (key === "fuel_cost_per_hour") return `$${value.toFixed(2)}/hr`;
    if (key === "fuel_cost_per_mile") return `$${value.toFixed(3)}/mi`;
    if (key === "idle_waste_dollars") return `$${value.toFixed(2)}`;
    if (key === "compass_bearing_deg") return `${value.toFixed(0)}\u00B0`;
    if (key === "altitude_ft") return `${value.toFixed(0)} ft`;
    if (key === "gps_latitude" || key === "gps_longitude") return `${value.toFixed(6)}`;
    if (key.endsWith("_mi")) return `${value.toFixed(1)} mi`;
    if (key.endsWith("_rpm") && key !== "engine_rpm") return `${value.toFixed(0)} RPM`;
    if (key.endsWith("_ppm")) return `${value.toFixed(0)} ppm`;
    if (key === "runtime_seconds") {
      const mins = Math.floor(value / 60);
      const secs = Math.floor(value % 60);
      return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    }
    if (key === "runtime_with_mil_min" || key === "time_since_clear_min") {
      const hrs = Math.floor(value / 60);
      const mins = Math.floor(value % 60);
      return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    }
    if (key === "distance_with_mil_mi" || key === "distance_since_clear_mi") return `${value.toFixed(1)} mi`;
    if (key === "timing_advance_deg") return `${value.toFixed(1)}\u00B0`;
    if (key === "maf_flow_gps" || key.endsWith("_gs")) return `${value.toFixed(1)} g/s`;
    if (key.startsWith("protect_lamp_") || key.startsWith("red_stop_lamp_") || key.startsWith("amber_lamp_") || key.startsWith("mil_")) {
      return value === 1 ? "ON" : value === 0 ? "OFF" : `${value}`;
    }
    if (key.startsWith("prop_start_counter")) return `${value.toFixed(0)}`;
    if (key === "commanded_equiv_ratio") return `${value.toFixed(3)}`;
    if (key === "evap_pressure_pa") return `${value.toFixed(0)} Pa`;
    if (key === "o2_voltage_b1s1_v") return `${value.toFixed(2)}V`;
    if (key === "warmup_cycles_since_clear") return `${value.toFixed(0)}`;
    if (key === "current_gear" || key === "selected_gear") {
      if (value === 0) return "N";
      if (value < 0) return "R";
      return `${value.toFixed(0)}`;
    }
    if (key === "estimated_mpg") return `${value.toFixed(1)} mpg`;
    if (key === "calc_fuel_rate_gph") return `${value.toFixed(2)} gal/h`;
    if (key === "rpm_stability_pct") return `${value.toFixed(0)}%`;
    if (key === "volumetric_efficiency_pct") return `${value.toFixed(0)}%`;
    if (key === "total_fuel_trim_b1_pct") return `${value.toFixed(1)}%`;
    if (key === "dtc_count_ecu") return `${value.toFixed(0)}`;
    if (key === "mil_on") return value ? "ON" : "OFF";
    return value.toFixed(1);
  }
  return String(value);
}

// Field groupings
const ENGINE_FIELDS = [
  { key: "engine_rpm", label: "Engine RPM", highlight: true },
  { key: "engine_load_pct", label: "Engine Load" },
  { key: "accel_pedal_pos_pct", label: "Accelerator" },
  { key: "driver_demand_torque_pct", label: "Demand Torque" },
  { key: "actual_engine_torque_pct", label: "Actual Torque" },
];

const TEMP_FIELDS = [
  { key: "coolant_temp_f", label: "Coolant Temp", highlight: true },
  { key: "oil_temp_f", label: "Oil" },
  { key: "fuel_temp_f", label: "Fuel" },
  { key: "intake_manifold_temp_f", label: "Intake" },
  { key: "trans_oil_temp_f", label: "Trans Oil" },
  { key: "ambient_temp_f", label: "Ambient" },
];

const PRESSURE_FIELDS = [
  { key: "oil_pressure_psi", label: "Oil Pressure", highlight: true },
  { key: "fuel_pressure_psi", label: "Fuel Pressure" },
  { key: "boost_pressure_psi", label: "Boost" },
  { key: "barometric_pressure_psi", label: "Baro" },
];

const VEHICLE_FIELDS = [
  { key: "vehicle_speed_mph", label: "Speed", highlight: true },
  { key: "current_gear", label: "Gear" },
  { key: "fuel_rate_gph", label: "Fuel Rate" },
  { key: "fuel_economy_mpg", label: "Fuel Economy" },
  { key: "fuel_level_pct", label: "Fuel Level" },
  { key: "battery_voltage_v", label: "Battery" },
  { key: "oil_level_pct", label: "Oil Level" },
];

const HYDRAULIC_FIELDS = [
  { key: "pto_engaged", label: "PTO Status", highlight: true },
  { key: "pto_rpm", label: "PTO Speed" },
  { key: "pto_set_rpm", label: "PTO Set Speed" },
  { key: "hydraulic_oil_temp_f", label: "Hydraulic Temp" },
  { key: "hydraulic_oil_pressure_psi", label: "Hydraulic Pressure" },
  { key: "hydraulic_oil_level_pct", label: "Hydraulic Level" },
  { key: "retarder_torque_pct", label: "Retarder Torque" },
];

const AFTERTREATMENT_FIELDS = [
  { key: "scr_efficiency_pct", label: "SCR Efficiency", highlight: true },
  { key: "scr_health", label: "SCR Health" },
  { key: "def_level_pct", label: "DEF Level" },
  { key: "def_dose_rate_gs", label: "DEF Dose Rate" },
  { key: "def_dose_commanded_gs", label: "DEF Commanded" },
  { key: "def_dosing_active", label: "DEF Dosing Active" },
  { key: "def_temp_f", label: "DEF Temp" },
  { key: "dpf_soot_load_pct", label: "DPF Soot Load" },
  { key: "dpf_regen_status", label: "DPF Regen Status" },
  { key: "dpf_diff_pressure_psi", label: "DPF Diff Pressure" },
  { key: "dpf_inlet_temp_f", label: "DPF Inlet Temp" },
  { key: "dpf_outlet_temp_f", label: "DPF Outlet Temp" },
  { key: "nox_inlet_ppm", label: "NOx Inlet" },
  { key: "nox_outlet_ppm", label: "NOx Outlet" },
  { key: "scr_catalyst_temp_f", label: "SCR Catalyst Temp" },
  { key: "protect_lamp_engine", label: "Protect (Engine)" },
  { key: "protect_lamp_acm", label: "Protect (ACM)" },
];

const BRAKES_FIELDS = [
  { key: "brake_pedal_pos_pct", label: "Brake Pedal", highlight: true },
  { key: "abs_active", label: "ABS Active" },
  { key: "brake_air_pressure_psi", label: "Brake Air Pressure" },
];

const NAVIGATION_FIELDS = [
  { key: "gps_latitude", label: "Latitude" },
  { key: "gps_longitude", label: "Longitude" },
  { key: "compass_bearing_deg", label: "Heading" },
  { key: "altitude_ft", label: "Altitude" },
  { key: "nav_speed_mph", label: "GPS Speed" },
  { key: "vehicle_pitch_deg", label: "Pitch" },
];

const IDLE_TRIP_FIELDS = [
  { key: "idle_fuel_used_gal", label: "Idle Fuel Used", highlight: true },
  { key: "idle_engine_hours", label: "Idle Hours" },
  { key: "trip_fuel_gal", label: "Trip Fuel" },
  { key: "service_distance_mi", label: "Next Service" },
  { key: "fan_speed_pct", label: "Fan Speed" },
  { key: "turbo_wastegate_pct", label: "Turbo Wastegate" },
];

const AIR_BRAKE_FIELDS = [
  { key: "air_supply_pressure_psi", label: "Air Supply", highlight: true },
  { key: "air_pressure_circuit1_psi", label: "Circuit 1" },
  { key: "air_pressure_circuit2_psi", label: "Circuit 2" },
  { key: "front_axle_speed_mph", label: "Front Axle Speed" },
];

const EXTENDED_ENGINE_FIELDS = [
  { key: "exhaust_gas_pressure_psi", label: "Exhaust Pressure" },
  { key: "vehicle_distance_mi", label: "Odometer" },
  { key: "vehicle_distance_hr_mi", label: "Odometer (HR)" },
  { key: "cruise_control_active", label: "Cruise Active" },
  { key: "clutch_slip_pct", label: "Clutch Slip" },
  { key: "trans_output_rpm", label: "Trans Output RPM" },
];

const COST_FIELDS = [
  { key: "fuel_cost_per_hour", label: "Current Burn Rate", highlight: true },
  { key: "fuel_cost_per_mile", label: "Cost Per Mile" },
  { key: "fuel_economy_mpg", label: "Current MPG" },
];

const HEALTH_FIELDS = [
  { key: "dpf_health", label: "DPF Filter", highlight: true },
  { key: "scr_health", label: "SCR System" },
  { key: "battery_health", label: "Battery" },
  { key: "def_low", label: "DEF Fluid Low" },
  { key: "idle_pct", label: "Lifetime Idle %" },
  { key: "idle_fuel_pct", label: "Idle Fuel %" },
];

const TOTAL_FIELDS = [
  { key: "vin", label: "VIN", highlight: true },
  { key: "engine_hours", label: "Engine Hours" },
  { key: "total_fuel_used_gal", label: "Total Fuel Used" },
  { key: "idle_fuel_used_gal", label: "Idle Fuel Used" },
  { key: "idle_engine_hours", label: "Idle Hours" },
  { key: "vehicle_distance_mi", label: "Odometer" },
  { key: "prop_start_counter_a", label: "Start Count A" },
  { key: "prop_start_counter_b", label: "Start Count B" },
];

// Car-specific field overrides — OBD-II returns different fields
const CAR_ENGINE_FIELDS = [
  { key: "engine_rpm", label: "Engine RPM", highlight: true },
  { key: "engine_load_pct", label: "Engine Load" },
  { key: "absolute_load_pct", label: "Absolute Load" },
  { key: "throttle_position_pct", label: "Throttle" },
  { key: "commanded_throttle_pct", label: "Commanded Throttle" },
  { key: "accel_pedal_pos_pct", label: "Accelerator Pedal" },
  { key: "timing_advance_deg", label: "Timing Advance" },
  { key: "maf_flow_gps", label: "MAF Flow" },
  { key: "commanded_equiv_ratio", label: "Air/Fuel Ratio" },
  { key: "total_fuel_trim_b1_pct", label: "Total Fuel Trim B1" },
  { key: "estimated_mpg", label: "Est. MPG" },
  { key: "volumetric_efficiency_pct", label: "Vol. Efficiency" },
  { key: "rpm_stability_pct", label: "RPM Stability" },
];

const CAR_TEMP_FIELDS = [
  { key: "coolant_temp_f", label: "Coolant", highlight: true },
  { key: "oil_temp_f", label: "Oil" },
  { key: "intake_air_temp_f", label: "Intake Air" },
  { key: "ambient_temp_f", label: "Ambient" },
  { key: "catalyst_temp_b1s1_f", label: "Catalytic Conv" },
];

const CAR_PRESSURE_FIELDS = [
  { key: "boost_pressure_psi", label: "Manifold Pressure", highlight: true },
  { key: "fuel_pressure_psi", label: "Fuel Rail" },
  { key: "fuel_pump_pressure_kpa", label: "Fuel Pump" },
  { key: "barometric_pressure_psi", label: "Barometric" },
  { key: "evap_pressure_pa", label: "EVAP System" },
];

const CAR_VEHICLE_FIELDS = [
  { key: "vehicle_speed_mph", label: "Speed", highlight: true },
  { key: "fuel_level_pct", label: "Fuel Level" },
  { key: "battery_voltage_v", label: "Battery" },
  { key: "runtime_seconds", label: "Engine Runtime" },
  { key: "o2_voltage_b1s1_v", label: "O2 Sensor B1S1" },
  { key: "estimated_mpg", label: "Est. MPG" },
];

const CAR_FUEL_FIELDS = [
  { key: "short_fuel_trim_b1_pct", label: "Short Fuel Trim B1" },
  { key: "long_fuel_trim_b1_pct", label: "Long Fuel Trim B1" },
  { key: "distance_with_mil_mi", label: "Distance w/ MIL" },
  { key: "distance_since_clear_mi", label: "Distance Since Clear" },
  { key: "time_since_clear_min", label: "Time Since Clear" },
  { key: "runtime_with_mil_min", label: "Runtime w/ MIL" },
  { key: "warmup_cycles_since_clear", label: "Warmups Since Clear" },
  { key: "short_fuel_trim_b2_pct", label: "Short Fuel Trim B2" },
  { key: "long_fuel_trim_b2_pct", label: "Long Fuel Trim B2" },
  { key: "calc_fuel_rate_gph", label: "Fuel Rate" },
  { key: "ethanol_fuel_pct", label: "Ethanol %" },
  { key: "mil_on", label: "Check Engine Light" },
  { key: "dtc_count_ecu", label: "ECU DTC Count" },
];

type VehicleMode = "truck" | "car";

interface GaugeGridProps {
  readings: TruckReadings | null;
  vehicleMode: VehicleMode;
  hasData: boolean;
}

export default function GaugeGrid({ readings, vehicleMode, hasData }: GaugeGridProps) {
  // Render a section of fields
  const renderFields = (
    fields: { key: string; label: string; highlight?: boolean }[],
    title: string,
    icon: string
  ) => {
    const available = fields.filter((f) => readings && readings[f.key] !== undefined);
    if (available.length === 0 && !hasData) {
      return (
        <div className="bg-gray-900/50 rounded-xl p-3 sm:p-4">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            {icon} {title}
          </h4>
          <p className="text-xs text-gray-600">Waiting for data...</p>
        </div>
      );
    }
    return (
      <div className="bg-gray-900/50 rounded-xl p-3 sm:p-4">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
          {icon} {title}
        </h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {fields.map((f) => {
            const val = readings?.[f.key];
            if (val === undefined) return null;
            const color =
              typeof val === "number" ? getValueColor(f.key, val) : "text-gray-100";
            return (
              <div key={f.key} className="flex justify-between items-baseline py-0.5">
                <span className="text-xs text-gray-500 truncate mr-2">{f.label}</span>
                <span
                  className={`text-xs font-mono font-bold ${color} ${
                    f.highlight ? "text-sm" : ""
                  }`}
                >
                  {formatValue(f.key, val)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
      {renderFields(
        vehicleMode === "car" ? CAR_ENGINE_FIELDS : ENGINE_FIELDS,
        "Engine", "\u2699\uFE0F"
      )}
      {renderFields(
        vehicleMode === "car" ? CAR_TEMP_FIELDS : TEMP_FIELDS,
        "Temperatures", "\u{1F321}\uFE0F"
      )}
      {renderFields(
        vehicleMode === "car" ? CAR_PRESSURE_FIELDS : PRESSURE_FIELDS,
        "Pressures", "\u{1F4CA}"
      )}
      {renderFields(
        vehicleMode === "car" ? CAR_VEHICLE_FIELDS : VEHICLE_FIELDS,
        "Vehicle", "\u{1F698}"
      )}
      {vehicleMode === "truck" && renderFields(AFTERTREATMENT_FIELDS, "Aftertreatment", "\u{2601}\uFE0F")}
      {vehicleMode === "truck" && renderFields(BRAKES_FIELDS, "Brakes & Safety", "\u{1F6D1}")}
      {vehicleMode === "truck" && renderFields(HYDRAULIC_FIELDS, "PTO / Hydraulics", "\u{1F527}")}
      {vehicleMode === "truck" && renderFields(IDLE_TRIP_FIELDS, "Idle / Trip / Service", "\u{23F1}\uFE0F")}
      {vehicleMode === "truck" && renderFields(AIR_BRAKE_FIELDS, "Air / Wheel Speed", "\u{1F6DE}\uFE0F")}
      {vehicleMode === "truck" && renderFields(NAVIGATION_FIELDS, "Navigation / GPS", "\u{1F4CD}")}
      {vehicleMode === "truck" && renderFields(EXTENDED_ENGINE_FIELDS, "Extended Engine", "\u{1F50C}")}
      {vehicleMode === "truck" && renderFields(COST_FIELDS, "Fuel Cost", "\u{26FD}")}
      {vehicleMode === "truck" && renderFields(HEALTH_FIELDS, "System Health", "\u{1F6A8}")}
      {vehicleMode === "truck" && renderFields(TOTAL_FIELDS, "Lifetime / Identity", "\u{1F4C8}")}
      {vehicleMode === "car" && renderFields(CAR_FUEL_FIELDS, "Diagnostics", "\u{1F527}")}
    </div>
  );
}

// Re-export formatValue for use in other components (e.g., DTCPanel freeze frame display)
export { formatValue };
