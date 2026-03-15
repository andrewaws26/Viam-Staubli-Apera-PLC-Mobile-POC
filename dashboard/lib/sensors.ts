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
    // Healthy when Modbus connection is live and no fault active
    isHealthy: (r) => r.connected === true && r.fault === false,
    getFaultMessage: (r) => {
      if (r.connected !== true) return "No Modbus TCP connection";
      if (r.fault_coil) return "Fault coil active";
      return "PLC fault detected";
    },
  },
  {
    id: "wire",
    label: "Wire / Connection",
    icon: "🔌",
    componentName: VIAM_COMPONENT_NAMES.plc,
    isHealthy: (r) => r.connected === true && r.fault === false,
    getFaultMessage: () => "Wire disconnected — junction box signal lost",
  },
];

// ---------------------------------------------------------------------------
// PLC register-to-field mapping.
// The plc-monitor sensor returns raw Modbus registers as register_100..113
// plus top-level booleans (connected, fault, fault_coil, button_state).
// This table maps each register to a human-friendly label and optional unit,
// with a `scale` divisor for fixed-point values (e.g. register / 10 → °F).
// ---------------------------------------------------------------------------
export const PLC_REGISTER_MAP: {
  register: string;
  label: string;
  unit?: string;
  scale?: number;
}[] = [
  { register: "register_100", label: "System State" },
  { register: "register_101", label: "Cycle Count" },
  { register: "register_102", label: "Temperature", unit: "°F", scale: 10 },
  { register: "register_103", label: "Humidity", unit: "%", scale: 10 },
  { register: "register_104", label: "Vibration X", unit: "m/s²", scale: 100 },
  { register: "register_105", label: "Vibration Y", unit: "m/s²", scale: 100 },
  { register: "register_106", label: "Vibration Z", unit: "m/s²", scale: 100 },
  { register: "register_107", label: "Pressure", unit: "psi", scale: 10 },
  { register: "register_108", label: "Servo 1 Pos", unit: "°", scale: 10 },
  { register: "register_109", label: "Servo 2 Pos", unit: "°", scale: 10 },
  { register: "register_110", label: "Servo 3 Pos", unit: "°", scale: 10 },
  { register: "register_111", label: "Servo 4 Pos", unit: "°", scale: 10 },
  { register: "register_112", label: "Servo 5 Pos", unit: "°", scale: 10 },
  { register: "register_113", label: "Servo 6 Pos", unit: "°", scale: 10 },
];

// System-state integer → human label
const SYSTEM_STATES: Record<number, string> = {
  0: "idle",
  1: "running",
  2: "fault",
  3: "e-stopped",
  4: "paused",
};

/** Decode raw plc-monitor readings into display-friendly key/value pairs. */
export function decodePlcReadings(
  raw: SensorReadings
): { label: string; value: string; unit?: string }[] {
  const rows: { label: string; value: string; unit?: string }[] = [];

  for (const { register, label, unit, scale } of PLC_REGISTER_MAP) {
    const v = raw[register];
    if (v === undefined || v === null) continue;

    let display: string;
    if (register === "register_100") {
      // Decode system state integer to label
      const num = typeof v === "number" ? v : parseInt(String(v), 10);
      display = SYSTEM_STATES[num] ?? String(v);
    } else if (scale && typeof v === "number") {
      display = (v / scale).toFixed(scale >= 100 ? 2 : 1);
    } else {
      display = String(v);
    }

    rows.push({ label, value: display, unit });
  }

  // Append top-level boolean fields
  if (raw.button_state !== undefined) {
    rows.push({
      label: "Button State",
      value: raw.button_state ? "PRESSED" : "released",
    });
  }
  if (raw.fault_coil !== undefined) {
    rows.push({
      label: "Fault Coil",
      value: raw.fault_coil ? "ACTIVE" : "clear",
    });
  }

  return rows;
}
