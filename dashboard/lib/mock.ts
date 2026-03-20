import { ComponentName, VIAM_COMPONENT_NAMES } from "./sensors";
import { SensorReadings } from "./types";

// Each fault lasts FAULT_DURATION_MS, then clears automatically.
const FAULT_PROBABILITY = 0.03;
const FAULT_DURATION_MS = 5000;

interface MockState {
  faultComponent: ComponentName | null;
  faultUntil: number;
  tpsPowerOn: boolean;
  encoderCount: number;
  encoderStartTime: number;
}

const state: MockState = {
  faultComponent: null,
  faultUntil: 0,
  tpsPowerOn: false,
  encoderCount: 0,
  encoderStartTime: Date.now(),
};

// Allows the test-fault button to inject a specific component fault
export function injectFault(componentName: ComponentName) {
  state.faultComponent = componentName;
  state.faultUntil = Date.now() + FAULT_DURATION_MS;
  state.tpsPowerOn = false;
}

// Toggle TPS power loop on (simulates power-up).
// Power stays on until fault injection kills it.
export function toggleServo() {
  if (state.faultComponent === VIAM_COMPONENT_NAMES.plc) return;
  state.tpsPowerOn = true;
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
      const powerOn = state.tpsPowerOn && !isFaulted;
      const systemState = isFaulted ? "fault" : powerOn ? "running" : "idle";

      const readings: SensorReadings = {
        connected: !isFaulted,
        fault: isFaulted,
        system_state: systemState,
        last_fault: isFaulted ? "connection_lost" : "none",
        current_uptime_seconds: Math.floor((now - state.encoderStartTime) / 1000),
        total_reads: 0,
        total_errors: 0,
      };

      // TPS Machine Status
      readings["tps_power_loop"] = powerOn;
      readings["camera_signal"] = powerOn;
      readings["encoder_enabled"] = powerOn;
      readings["floating_zero"] = false;
      readings["encoder_reset"] = false;

      // TPS Eject System
      readings["eject_tps_1"] = false;
      readings["eject_left_tps_2"] = false;
      readings["eject_right_tps_2"] = false;
      readings["air_eagle_1_feedback"] = false;
      readings["air_eagle_2_feedback"] = false;
      readings["air_eagle_3_enable"] = false;

      // TPS Production
      readings["plate_drop_count"] = powerOn ? Math.floor(Math.random() * 500) : 0;
      readings["plates_per_minute"] = powerOn ? +(8 + Math.random() * 4).toFixed(1) : 0;

      // Simulate encoder
      if (powerOn) {
        state.encoderCount += Math.floor(800 + Math.random() * 200);
      }
      const wheelCircMm = Math.PI * 406.4; // 16-inch wheel
      const mmPerCount = wheelCircMm / 1000;
      const distMm = state.encoderCount * mmPerCount;
      const distFt = distMm / 304.8;
      const speedMmps = powerOn ? 500 + Math.random() * 100 : 0;
      const speedFtpm = (speedMmps / 304.8) * 60;
      readings["encoder_count"] = state.encoderCount;
      readings["encoder_direction"] = "forward";
      readings["encoder_distance_mm"] = +distMm.toFixed(1);
      readings["encoder_distance_ft"] = +distFt.toFixed(2);
      readings["encoder_speed_mmps"] = powerOn ? +speedMmps.toFixed(1) : 0;
      readings["encoder_speed_ftpm"] = powerOn ? +speedFtpm.toFixed(1) : 0;
      readings["encoder_revolutions"] = +(state.encoderCount / 1000).toFixed(2);

      // Plate drop spacing diagnostics (mock)
      readings["last_drop_spacing_ft"] = powerOn ? +(38 + Math.random() * 4).toFixed(2) : 0;
      readings["last_drop_spacing_mm"] = powerOn ? +(11582 + Math.random() * 1200).toFixed(1) : 0;
      readings["last_drop_encoder_count"] = powerOn ? Math.floor(30000 + Math.random() * 5000) : 0;
      readings["avg_drop_spacing_ft"] = powerOn ? 39.5 : 0;
      readings["min_drop_spacing_ft"] = powerOn ? 37.2 : 0;
      readings["max_drop_spacing_ft"] = powerOn ? 42.1 : 0;
      readings["drop_spacing_history_ft"] = powerOn
        ? Array.from({ length: 12 }, () => +(37 + Math.random() * 6).toFixed(2))
        : [];

      // DS Holding Registers (mock values)
      for (let i = 1; i <= 25; i++) {
        readings[`ds${i}`] = 0;
      }
      readings["ds2"] = 39; // Tie spacing setting

      // Discrete inputs (raw)
      readings["x1"] = false;
      readings["x2"] = false;
      readings["x8"] = false;

      return readings;
    }
    default:
      return {};
  }
}
