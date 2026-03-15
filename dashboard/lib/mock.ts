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
      // Mock plc-monitor output: top-level booleans + raw Modbus registers
      return {
        connected: !isFaulted,
        fault: isFaulted,
        fault_coil: isFaulted,
        button_state: false,
        register_100: isFaulted ? 2 : 1,                          // system state (0=idle,1=running,2=fault)
        register_101: 47 + Math.floor(Math.random() * 10),        // cycle count
        register_102: Math.floor((70 + Math.random() * 5) * 10),  // temperature × 10
        register_103: Math.floor((43 + Math.random() * 5) * 10),  // humidity × 10
        register_104: isFaulted ? 1250 : Math.floor((Math.random() * 0.2 - 0.1) * 100), // vib X × 100
        register_105: isFaulted ? 830 : Math.floor((Math.random() * 0.2 - 0.1) * 100),  // vib Y × 100
        register_106: Math.floor((9.81 + Math.random() * 0.2 - 0.1) * 100),             // vib Z × 100
        register_107: 500 + Math.floor(Math.random() * 50),       // pressure × 10
        register_108: Math.floor(Math.random() * 1800),            // servo 1 × 10
        register_109: Math.random() > 0.5 ? 900 : 0,              // servo 2 × 10
        register_110: Math.floor(Math.random() * 900),             // servo 3 × 10
        register_111: Math.floor(Math.random() * 900),             // servo 4 × 10
        register_112: Math.floor(Math.random() * 1800),            // servo 5 × 10
        register_113: Math.floor(Math.random() * 1800),            // servo 6 × 10
      };
    default:
      return {};
  }
}
