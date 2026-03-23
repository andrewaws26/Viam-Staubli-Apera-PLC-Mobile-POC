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
// TPS Production Stats (shown outside the plate drop section)
// ---------------------------------------------------------------------------
export const TPS_PRODUCTION_FIELDS: {
  key: string;
  label: string;
  unit?: string;
  highlight?: boolean;
}[] = [
  { key: "plates_per_minute", label: "Plate Rate", unit: "/min", highlight: true },
  { key: "plate_drop_count", label: "Total Plates Dropped" },
  { key: "ds2", label: "Tie Spacing (×0.5in)" },
];

// ---------------------------------------------------------------------------
// Operating Mode fields — derived from C-bit coils C20-C31
// ---------------------------------------------------------------------------
export const OPERATING_MODE_FIELDS: {
  key: string;
  label: string;
  type: "bool" | "string";
}[] = [
  { key: "operating_mode", label: "Active Mode", type: "string" },
  { key: "mode_tps1_single", label: "TPS-1 Single", type: "bool" },
  { key: "mode_tps1_double", label: "TPS-1 Double", type: "bool" },
  { key: "mode_tps2_both", label: "TPS-2 Both", type: "bool" },
  { key: "mode_tps2_left", label: "Left Chute", type: "bool" },
  { key: "mode_tps2_right", label: "Right Chute", type: "bool" },
  { key: "mode_tie_team", label: "Tie Team", type: "bool" },
  { key: "mode_2nd_pass", label: "2nd Pass", type: "bool" },
];

// ---------------------------------------------------------------------------
// Drop Pipeline fields — eject chain from C-bit coils
// ---------------------------------------------------------------------------
export const DROP_PIPELINE_FIELDS: {
  key: string;
  label: string;
  type: "bool";
}[] = [
  { key: "drop_enable", label: "Drop Enable", type: "bool" },
  { key: "drop_enable_latch", label: "Drop Latch", type: "bool" },
  { key: "drop_detector_eject", label: "Detector Eject", type: "bool" },
  { key: "drop_encoder_eject", label: "Encoder Eject", type: "bool" },
  { key: "drop_software_eject", label: "SW Eject", type: "bool" },
  { key: "first_tie_detected", label: "1st Tie Found", type: "bool" },
];

// ---------------------------------------------------------------------------
// Detection & Control fields — encoder mode, camera, alarms
// ---------------------------------------------------------------------------
export const DETECTION_FIELDS: {
  key: string;
  label: string;
  type: "bool";
}[] = [
  { key: "encoder_mode", label: "Encoder Mode", type: "bool" },
  { key: "camera_positive", label: "Camera Detection", type: "bool" },
  { key: "backup_alarm", label: "Backup Alarm", type: "bool" },
  { key: "lay_ties_set", label: "Lay Ties", type: "bool" },
  { key: "drop_ties", label: "Drop Ties", type: "bool" },
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
  { key: "ds1", label: "DS1 Encoder Ignore" },
  { key: "ds2", label: "DS2 Tie Spacing (×0.5in)" },
  { key: "ds3", label: "DS3 Tie Spacing (×0.1in)" },
  { key: "ds4", label: "DS4 Miles Laying/10" },
  { key: "ds5", label: "DS5 Det Offset Bits" },
  { key: "ds6", label: "DS6 Det Offset (×0.1in)" },
  { key: "ds7", label: "DS7 Plate Count" },
  { key: "ds8", label: "DS8 Avg Plates/Min" },
  { key: "ds9", label: "DS9 Det Next Tie" },
  { key: "ds10", label: "DS10 Enc Next Tie" },
  { key: "ds11", label: "DS11 1st Tie Distance" },
  { key: "ds12", label: "DS12 Detector Bits" },
  { key: "ds13", label: "DS13 Last Det Laid (in)" },
  { key: "ds14", label: "DS14 2nd Pass Dbl Lay" },
  { key: "ds15", label: "DS15 Tie Team Skips" },
  { key: "ds16", label: "DS16 Tie Team Lays" },
  { key: "ds17", label: "DS17 Skip+Lay-1" },
  { key: "ds18", label: "DS18" },
  { key: "ds19", label: "DS19 HMI" },
  { key: "ds20", label: "DS20" },
  { key: "ds21", label: "DS21" },
  { key: "ds22", label: "DS22" },
  { key: "ds23", label: "DS23" },
  { key: "ds24", label: "DS24" },
  { key: "ds25", label: "DS25" },
];
