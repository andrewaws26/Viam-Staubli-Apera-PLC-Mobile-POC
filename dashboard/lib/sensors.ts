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
    // Healthy when connected and no active fault
    // Schema: { connected: bool, mode: string, fault: bool, fault_code: int }
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
    // Healthy when server is reachable and vision process is running
    // Schema: { connected: bool, process_running: bool }
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
    // Healthy when Modbus connection is live and no fault bit is set
    // Schema: { connected: bool, fault: bool, button_state: bool }
    isHealthy: (r) => r.connected === true && r.fault === false,
    getFaultMessage: (r) =>
      r.connected !== true
        ? "No Modbus TCP connection"
        : "Communication fault bit set",
  },
  {
    id: "wire",
    label: "Wire / Connection",
    icon: "🔌",
    // Derived from PLC readings: a pulled wire shows up as a PLC fault or
    // loss of connection — there is no direct wire-state sensor
    componentName: VIAM_COMPONENT_NAMES.plc,
    isHealthy: (r) => r.connected === true && r.fault === false,
    getFaultMessage: () => "Wire disconnected — junction box signal lost",
  },
];
