import { SensorReadings } from "./types";

// Viam component names must match the names configured in the Viam app.
// Components not yet deployed will be handled gracefully as "pending".
export const VIAM_COMPONENT_NAMES = {
  plc: "plc-monitor",
} as const;

export type ComponentName =
  (typeof VIAM_COMPONENT_NAMES)[keyof typeof VIAM_COMPONENT_NAMES];

export interface SensorConfig {
  id: string;
  label: string;
  icon: string;
  componentName: ComponentName;
  // Returns true when the component is in a healthy state
  isHealthy: (readings: SensorReadings) => boolean;
  // Returns true when the component is in E-stop state
  isEstop?: (readings: SensorReadings) => boolean;
  // Returns a human-readable fault description
  getFaultMessage: (readings: SensorReadings) => string;
}

export const SENSOR_CONFIGS: SensorConfig[] = [
  {
    id: "plc",
    label: "TPS Controller",
    icon: "\u{1F5A5}",
    componentName: VIAM_COMPONENT_NAMES.plc,
    // Healthy when Modbus connection is live and no fault
    isHealthy: (r) => r.connected === true && r.fault === false,
    getFaultMessage: (r) => {
      if (r.connected !== true) return "No Modbus TCP connection to PLC";
      const fault = r.last_fault ?? "unknown";
      return `Fault: ${String(fault).toUpperCase()}`;
    },
  },
];

// ---------------------------------------------------------------------------
// Encoder detail fields — displayed in a dedicated panel section.
// The plc-sensor module computes distance/speed from raw encoder counts
// using the configured wheel diameter.
// ---------------------------------------------------------------------------
export const ENCODER_DETAIL_FIELDS: {
  key: string;
  label: string;
  unit?: string;
  highlight?: boolean;
}[] = [
  { key: "encoder_distance_ft", label: "Distance Traveled", unit: "ft", highlight: true },
  { key: "encoder_speed_ftpm", label: "Track Speed", unit: "ft/min", highlight: true },
  { key: "encoder_direction", label: "Direction" },
  { key: "encoder_count", label: "Raw Pulse Count" },
  { key: "encoder_revolutions", label: "Wheel Revolutions" },
  { key: "shift_hours", label: "Shift Hours", unit: "hrs" },
];

// ---------------------------------------------------------------------------
// TPS Machine Status fields
// ---------------------------------------------------------------------------
export const TPS_STATUS_FIELDS: {
  key: string;
  label: string;
  type?: "bool" | "number" | "string";
}[] = [
  { key: "tps_power_loop", label: "TPS Power Loop", type: "bool" },
  { key: "camera_signal", label: "Camera Signal", type: "bool" },
  { key: "encoder_enabled", label: "Encoder", type: "bool" },
  { key: "floating_zero", label: "Floating Zero", type: "bool" },
  { key: "encoder_reset", label: "Encoder Reset", type: "bool" },
];

// ---------------------------------------------------------------------------
// TPS Eject System fields
// ---------------------------------------------------------------------------
export const TPS_EJECT_FIELDS: {
  key: string;
  label: string;
  type?: "bool" | "number";
}[] = [
  { key: "eject_tps_1", label: "Eject TPS-1", type: "bool" },
  { key: "eject_left_tps_2", label: "Eject Left TPS-2", type: "bool" },
  { key: "eject_right_tps_2", label: "Eject Right TPS-2", type: "bool" },
  { key: "air_eagle_1_feedback", label: "Air Eagle 1", type: "bool" },
  { key: "air_eagle_2_feedback", label: "Air Eagle 2", type: "bool" },
  { key: "air_eagle_3_enable", label: "Air Eagle 3 Drop", type: "bool" },
];

// ---------------------------------------------------------------------------
// TPS Production Stats
// ---------------------------------------------------------------------------
export const TPS_PRODUCTION_FIELDS: {
  key: string;
  label: string;
  unit?: string;
  highlight?: boolean;
}[] = [
  { key: "plates_per_minute", label: "Plate Rate", unit: "/min", highlight: true },
  { key: "plate_drop_count", label: "Total Plates Dropped" },
  { key: "ds2", label: "Tie Spacing Setting" },
  { key: "ds1", label: "DS1" },
  { key: "ds5", label: "DS5" },
];

// ---------------------------------------------------------------------------
// Plate Drop Spacing — encoder-based diagnostics for sync issues
// ---------------------------------------------------------------------------
export const DROP_SPACING_FIELDS: {
  key: string;
  label: string;
  unit?: string;
  highlight?: boolean;
  warn?: (v: number, target: number) => boolean;
}[] = [
  { key: "distance_since_last_drop_in", label: "Distance Since Last Drop", unit: "in", highlight: true },
  { key: "last_drop_spacing_in", label: "Last Drop Spacing", unit: "in", highlight: true },
  { key: "avg_drop_spacing_in", label: "Avg Spacing (last 20)", unit: "in" },
  { key: "min_drop_spacing_in", label: "Min Spacing", unit: "in" },
  { key: "max_drop_spacing_in", label: "Max Spacing", unit: "in" },
];

// ---------------------------------------------------------------------------
// PLC DS Holding Registers (DS1-DS25)
// All 25 registers from the Click PLC ladder logic — raw values for
// complete visibility into what the PLC is doing.
// ---------------------------------------------------------------------------
export const PLC_REGISTER_FIELDS: {
  key: string;
  label: string;
}[] = [
  { key: "ds1", label: "DS1" },
  { key: "ds2", label: "DS2" },
  { key: "ds3", label: "DS3" },
  { key: "ds4", label: "DS4" },
  { key: "ds5", label: "DS5" },
  { key: "ds6", label: "DS6" },
  { key: "ds7", label: "DS7" },
  { key: "ds8", label: "DS8" },
  { key: "ds9", label: "DS9" },
  { key: "ds10", label: "DS10" },
  { key: "ds11", label: "DS11" },
  { key: "ds12", label: "DS12" },
  { key: "ds13", label: "DS13" },
  { key: "ds14", label: "DS14" },
  { key: "ds15", label: "DS15" },
  { key: "ds16", label: "DS16" },
  { key: "ds17", label: "DS17" },
  { key: "ds18", label: "DS18" },
  { key: "ds19", label: "DS19" },
  { key: "ds20", label: "DS20" },
  { key: "ds21", label: "DS21" },
  { key: "ds22", label: "DS22" },
  { key: "ds23", label: "DS23" },
  { key: "ds24", label: "DS24" },
  { key: "ds25", label: "DS25" },
];
