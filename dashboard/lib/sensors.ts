import { SensorReadings } from "./types";

// Viam component names must match the names configured in the Viam app.
// Components not yet deployed will be handled gracefully as "pending".
export const VIAM_COMPONENT_NAMES = {
  robotArm: "robot-arm-sensor",
  vision: "vision-health",
  plc: "plc-sensor",
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
    // Healthy when Modbus connection is live, system is not faulted/e-stopped
    isHealthy: (r) =>
      r.connected === true &&
      r.fault === false &&
      r.system_state !== "e-stopped",
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
    isHealthy: (r) => r.connected === true && r.fault === false,
    getFaultMessage: () => "Wire disconnected — junction box signal lost",
  },
];

// PLC sensor data field labels for the detail panel
export const PLC_SENSOR_FIELDS = [
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
] as const;
