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
      return {
        connected: !isFaulted,
        fault: isFaulted,
        button_state: !isFaulted,
      };
    default:
      return {};
  }
}
