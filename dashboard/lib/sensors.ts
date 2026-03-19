import { SensorReadings } from "./types";

// Viam component names must match the names configured in the Viam app.
// Components not yet deployed will be handled gracefully as "pending".
export const VIAM_COMPONENT_NAMES = {
  robotArm: "robot-arm-sensor",
  vision: "vision-health",
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
    id: "robot-arm",
    label: "Robot Arm",
    icon: "🦾",
    componentName: VIAM_COMPONENT_NAMES.robotArm,
    isHealthy: (r) => r.connected === true && r.fault === false,
    getFaultMessage: (r) =>
      r.connected !== true
        ? "Controller unreachable"
        : `Fault — code ${r.fault_code ?? "unknown"}`,
  },
  {
    id: "vision",
    label: "Vision System",
    icon: "📷",
    componentName: VIAM_COMPONENT_NAMES.vision,
    isHealthy: (r) => r.connected === true && r.process_running === true,
    getFaultMessage: (r) =>
      r.connected !== true
        ? "Server unreachable"
        : "Vision process not running",
  },
  {
    id: "plc",
    label: "PLC / Controller",
    icon: "🖥",
    componentName: VIAM_COMPONENT_NAMES.plc,
    // Healthy when Modbus connection is live, no fault, and not e-stopped
    isHealthy: (r) =>
      r.connected === true && r.fault === false && r.system_state !== "e-stopped",
    isEstop: (r) => r.system_state === "e-stopped",
    getFaultMessage: (r) => {
      if (r.connected !== true) return "No Modbus TCP connection";
      if (r.system_state === "e-stopped") return "E-STOP ACTIVE";
      const fault = r.last_fault ?? "unknown";
      return `Fault: ${String(fault).toUpperCase()}`;
    },
  },
  {
    id: "wire",
    label: "Wire / Connection",
    icon: "🔌",
    componentName: VIAM_COMPONENT_NAMES.plc,
    isHealthy: (r) =>
      r.connected === true && r.fault === false && r.system_state !== "e-stopped",
    isEstop: (r) => r.system_state === "e-stopped",
    getFaultMessage: (r) =>
      r.system_state === "e-stopped"
        ? "E-STOP — system halted"
        : "Wire disconnected — junction box signal lost",
  },
];

// ---------------------------------------------------------------------------
// PLC detail panel field definitions.
// The plc-sensor module (plc_sensor.py) reads raw Modbus registers and
// returns ALREADY-DECODED named keys: system_state is a string like "idle",
// temperature_f is a float like 72.5, etc.  No additional decoding needed
// on the dashboard side — just display the values.
// ---------------------------------------------------------------------------
export const PLC_DETAIL_FIELDS: {
  key: string;
  label: string;
  unit?: string;
}[] = [
  { key: "system_state", label: "System State" },
  { key: "cycle_count", label: "Cycle Count" },
  { key: "temperature_f", label: "Temperature", unit: "°F" },
  { key: "humidity_pct", label: "Humidity", unit: "%" },
  { key: "vibration_x", label: "Vibration X", unit: "m/s²" },
  { key: "vibration_y", label: "Vibration Y", unit: "m/s²" },
  { key: "vibration_z", label: "Vibration Z", unit: "m/s²" },
  { key: "pressure_simulated", label: "Pressure" },
  { key: "servo1_position", label: "Servo 1 Pos", unit: "°" },
  { key: "servo2_position", label: "Servo 2 Pos", unit: "°" },
  { key: "last_fault", label: "Last Fault" },
  { key: "button_state", label: "Button" },
  { key: "servo_power_press_count", label: "Servo Presses" },
  { key: "estop_activation_count", label: "E-Stop Count" },
  { key: "current_uptime_seconds", label: "Uptime", unit: "s" },
  { key: "last_estop_duration_seconds", label: "Last E-Stop Duration", unit: "s" },
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
  { key: "encoder_distance_mm", label: "Distance (metric)", unit: "mm" },
  { key: "encoder_speed_mmps", label: "Speed (metric)", unit: "mm/s" },
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
  { key: "adjustable_tie_spacing", label: "Tie Spacing Setting" },
  { key: "encoder_ignore", label: "Encoder Ignore" },
  { key: "detector_offset_bits", label: "Detector Offset" },
];

// ---------------------------------------------------------------------------
// E-Cat signal definitions for the 25-pin cable status grid.
// Each entry maps a reading key to a display label and pin number.
// ---------------------------------------------------------------------------
export interface EcatSignalDef {
  key: string;
  label: string;
  pin: number;
}

export const ECAT_SIGNAL_DEFS: EcatSignalDef[] = [
  { key: "servo_power_on",     label: "Servo Power ON",    pin: 1 },
  { key: "servo_disable",      label: "Servo Disable",     pin: 2 },
  { key: "plate_cycle",        label: "Plate Cycle",       pin: 3 },
  { key: "abort_stow",         label: "Abort / Stow",      pin: 4 },
  { key: "speed",              label: "Speed",             pin: 5 },
  { key: "gripper_lock",       label: "Gripper Lock",      pin: 6 },
  { key: "clear_position",     label: "Clear Position",    pin: 7 },
  { key: "belt_forward",       label: "Belt Forward",      pin: 8 },
  { key: "belt_reverse",       label: "Belt Reverse",      pin: 9 },
  { key: "lamp_servo_power",   label: "Lamp: Servo Power", pin: 10 },
  { key: "lamp_servo_disable", label: "Lamp: Servo Disable", pin: 11 },
  { key: "lamp_plate_cycle",   label: "Lamp: Plate Cycle", pin: 12 },
  { key: "lamp_abort_stow",    label: "Lamp: Abort/Stow",  pin: 13 },
  { key: "lamp_speed",         label: "Lamp: Speed",       pin: 14 },
  { key: "lamp_gripper_lock",  label: "Lamp: Gripper Lock", pin: 15 },
  { key: "lamp_clear_position",label: "Lamp: Clear Pos",   pin: 16 },
  { key: "lamp_belt_forward",  label: "Lamp: Belt Fwd",    pin: 17 },
  { key: "lamp_belt_reverse",  label: "Lamp: Belt Rev",    pin: 18 },
  { key: "emag_status",        label: "E-Mag Status",      pin: 19 },
  { key: "emag_on",            label: "E-Mag ON",          pin: 20 },
  { key: "emag_part_detect",   label: "E-Mag Part Detect", pin: 21 },
  { key: "emag_malfunction",   label: "E-Mag Malfunction", pin: 22 },
  { key: "poe_status",         label: "POE Status",        pin: 23 },
  { key: "estop_enable",       label: "E-Stop Enable",     pin: 24 },
  { key: "estop_off",          label: "E-Stop OFF",        pin: 25 },
];
