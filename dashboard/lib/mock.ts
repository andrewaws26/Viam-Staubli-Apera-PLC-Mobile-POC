import { ComponentName, VIAM_COMPONENT_NAMES } from "./sensors";
import { SensorReadings } from "./types";

// Each fault lasts FAULT_DURATION_MS, then clears automatically.
// With 4 indicators polling at 2s and 3% fault probability, expect a
// fault event roughly every 15–20 seconds — dramatic enough for a demo.
const FAULT_PROBABILITY = 0.03;
const FAULT_DURATION_MS = 5000;

interface MockState {
  faultComponent: ComponentName | null;
  faultUntil: number;
}

const state: MockState = { faultComponent: null, faultUntil: 0 };

// Allows the test-fault button to inject a specific component fault
export function injectFault(componentName: ComponentName) {
  state.faultComponent = componentName;
  state.faultUntil = Date.now() + FAULT_DURATION_MS;
}

export function getMockReadings(componentName: ComponentName): SensorReadings {
  const now = Date.now();

  // Clear expired fault
  if (state.faultUntil > 0 && now > state.faultUntil) {
    state.faultComponent = null;
    state.faultUntil = 0;
  }

  // Randomly inject a new fault (one component at a time for demo clarity)
  if (!state.faultComponent && Math.random() < FAULT_PROBABILITY) {
    const components: ComponentName[] = [
      VIAM_COMPONENT_NAMES.robotArm,
      VIAM_COMPONENT_NAMES.vision,
      VIAM_COMPONENT_NAMES.plc,
    ];
    state.faultComponent =
      components[Math.floor(Math.random() * components.length)];
    state.faultUntil = now + FAULT_DURATION_MS;
  }

  const isFaulted = state.faultComponent === componentName;

  switch (componentName) {
    case VIAM_COMPONENT_NAMES.robotArm:
      return {
        connected: !isFaulted,
        mode: "auto",
        fault: isFaulted,
        fault_code: isFaulted ? 42 : 0,
      };
    case VIAM_COMPONENT_NAMES.vision:
      return {
        connected: !isFaulted,
        process_running: !isFaulted,
      };
    case VIAM_COMPONENT_NAMES.plc:
      // Mock output matches plc_sensor.py get_readings(): already-decoded named keys
      return {
        connected: !isFaulted,
        fault: isFaulted,
        system_state: isFaulted ? "fault" : "running",
        last_fault: isFaulted ? "vibration" : "none",
        servo_power_on: true,
        plate_cycle_active: !isFaulted,
        vibration_x: isFaulted ? 12.5 : +(Math.random() * 0.2 - 0.1).toFixed(2),
        vibration_y: isFaulted ? 8.3 : +(Math.random() * 0.2 - 0.1).toFixed(2),
        vibration_z: 9.81 + +(Math.random() * 0.2 - 0.1).toFixed(2),
        temperature_f: +(70 + Math.random() * 5).toFixed(1),
        humidity_pct: +(43 + Math.random() * 5).toFixed(1),
        pressure_simulated: 500 + Math.floor(Math.random() * 50),
        servo1_position: Math.floor(Math.random() * 180),
        servo2_position: Math.random() > 0.5 ? 90 : 0,
        cycle_count: 47 + Math.floor(Math.random() * 10),
      };
    default:
      return {};
  }
}
