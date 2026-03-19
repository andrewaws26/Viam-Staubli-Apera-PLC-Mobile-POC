import { ComponentName, VIAM_COMPONENT_NAMES, ECAT_SIGNAL_DEFS } from "./sensors";
import { SensorReadings } from "./types";

// Each fault lasts FAULT_DURATION_MS, then clears automatically.
// With 4 indicators polling at 2s and 3% fault probability, expect a
// fault event roughly every 15–20 seconds — dramatic enough for a demo.
const FAULT_PROBABILITY = 0.03;
const FAULT_DURATION_MS = 5000;

interface MockState {
  faultComponent: ComponentName | null;
  faultUntil: number;
  servoActive: boolean;
}

const state: MockState = { faultComponent: null, faultUntil: 0, servoActive: false };

// Allows the test-fault button to inject a specific component fault
export function injectFault(componentName: ComponentName) {
  state.faultComponent = componentName;
  state.faultUntil = Date.now() + FAULT_DURATION_MS;
  // Fault kills servo power (matches real hardware behavior)
  state.servoActive = false;
}

// Latch servo power ON (simulates pressing the blue Fuji AR22F0L push button).
// Power stays on until e-stop (fault injection) kills it — matches real hardware.
export function toggleServo() {
  // Reject if PLC is currently faulted
  if (state.faultComponent === VIAM_COMPONENT_NAMES.plc) return;
  // Latch ON — only e-stop / fault can turn it off
  state.servoActive = true;
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
    case VIAM_COMPONENT_NAMES.plc: {
      // Derive system state from servo toggle + fault state
      const servoOn = state.servoActive && !isFaulted;
      const systemState = isFaulted ? "fault" : servoOn ? "running" : "idle";

      // Mock output matches plc_sensor.py get_readings(): already-decoded named keys
      const readings: SensorReadings = {
        connected: !isFaulted,
        fault: isFaulted,
        system_state: systemState,
        last_fault: isFaulted ? "vibration" : "none",
        button_state: servoOn ? "pressed" : "released",
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

      // Add E-Cat signal mock values — derive from system state
      for (const { key } of ECAT_SIGNAL_DEFS) {
        if (key === "servo_power_on" || key === "lamp_servo_power") {
          // ON only when servo is active
          readings[key] = servoOn ? 1 : 0;
        } else if (key === "servo_disable" || key === "lamp_servo_disable") {
          // Servo disable is ASSERTED (1) when idle, DEASSERTED (0) when running
          readings[key] = servoOn ? 0 : 1;
        } else if (key === "plate_cycle" || key === "lamp_plate_cycle") {
          readings[key] = servoOn ? 1 : 0;
        } else if (key === "estop_off" || key === "emag_malfunction") {
          readings[key] = 0; // Normally OFF
        } else {
          readings[key] = 1;
        }
      }

      return readings;
    }
    default:
      return {};
  }
}
