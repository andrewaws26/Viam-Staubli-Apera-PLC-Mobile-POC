import { ComponentName, VIAM_COMPONENT_NAMES } from "./sensors";
import { SensorReadings } from "./types";

// Each fault lasts FAULT_DURATION_MS, then clears automatically.
const FAULT_PROBABILITY = 0.03;
const FAULT_DURATION_MS = 5000;

interface MockState {
  faultComponent: ComponentName | null;
  faultUntil: number;
  servoActive: boolean;
  encoderCount: number;
  encoderStartTime: number;
}

const state: MockState = {
  faultComponent: null,
  faultUntil: 0,
  servoActive: false,
  encoderCount: 0,
  encoderStartTime: Date.now(),
};

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
    state.faultComponent = VIAM_COMPONENT_NAMES.plc;
    state.faultUntil = now + FAULT_DURATION_MS;
  }

  const isFaulted = state.faultComponent === componentName;

  switch (componentName) {
    case VIAM_COMPONENT_NAMES.plc: {
      // Derive system state from servo toggle + fault state
      const servoOn = state.servoActive && !isFaulted;
      const systemState = isFaulted ? "fault" : servoOn ? "running" : "idle";

      const readings: SensorReadings = {
        connected: !isFaulted,
        fault: isFaulted,
        system_state: systemState,
        last_fault: isFaulted ? "vibration" : "none",
        servo_power_press_count: 0,
        estop_activation_count: 0,
        current_uptime_seconds: Math.floor((now - state.encoderStartTime) / 1000),
        servo_power_on: servoOn ? 1 : 0,
      };

      // TPS mock values
      readings["tps_power_loop"] = servoOn;
      readings["camera_signal"] = servoOn;
      readings["encoder_enabled"] = servoOn;
      readings["floating_zero"] = false;
      readings["encoder_reset"] = false;
      readings["eject_tps_1"] = false;
      readings["eject_left_tps_2"] = false;
      readings["eject_right_tps_2"] = false;
      readings["air_eagle_1_feedback"] = false;
      readings["air_eagle_2_feedback"] = false;
      readings["air_eagle_3_enable"] = false;
      readings["plate_drop_count"] = servoOn ? Math.floor(Math.random() * 500) : 0;
      readings["plates_per_minute"] = servoOn ? +(8 + Math.random() * 4).toFixed(1) : 0;
      readings["adjustable_tie_spacing"] = 0;
      readings["encoder_ignore"] = 0;
      readings["detector_offset_bits"] = 0;

      // Simulate encoder: when servo is active, encoder advances (~2 ft/s track speed)
      if (servoOn) {
        state.encoderCount += Math.floor(800 + Math.random() * 200); // ~1000 counts/poll
      }
      const wheelCircMm = Math.PI * 152.4; // 6-inch wheel
      const mmPerCount = wheelCircMm / 4000;
      const distMm = state.encoderCount * mmPerCount;
      const distFt = distMm / 304.8;
      const speedMmps = servoOn ? 500 + Math.random() * 100 : 0;
      const speedFtpm = (speedMmps / 304.8) * 60;
      readings["encoder_count"] = state.encoderCount;
      readings["encoder_direction"] = "forward";
      readings["encoder_distance_mm"] = +distMm.toFixed(1);
      readings["encoder_distance_ft"] = +distFt.toFixed(2);
      readings["encoder_speed_mmps"] = servoOn ? +speedMmps.toFixed(1) : 0;
      readings["encoder_speed_ftpm"] = servoOn ? +speedFtpm.toFixed(1) : 0;
      readings["encoder_revolutions"] = +(state.encoderCount / 4000).toFixed(2);

      return readings;
    }
    default:
      return {};
  }
}
