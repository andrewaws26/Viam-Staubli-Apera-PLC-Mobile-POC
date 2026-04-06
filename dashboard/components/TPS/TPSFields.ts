// TPSFields.ts — Type definitions, constants, register group definitions,
// simulator scenario presets, and shared helper functions for the TPS panel.

import {
  PLC_REGISTER_FIELDS,
  ENCODER_DETAIL_FIELDS,
  TPS_STATUS_FIELDS,
  TPS_EJECT_FIELDS,
  OPERATING_MODE_FIELDS,
  DROP_PIPELINE_FIELDS,
  DETECTION_FIELDS,
} from "../../lib/sensors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type SensorReadings = Record<string, unknown>;

export interface SensorDiagnostic {
  rule: string;
  severity: "critical" | "warning" | "info";
  title: string;
  action: string;
  category?: string;
  evidence?: string;
}

export interface ShiftState {
  active: boolean;
  startTime: number | null;
  startReadings: SensorReadings | null;
  log: { ts: number; distance_ft: number; plates: number; speed: number }[];
}

export interface ShiftStats {
  elapsed: number;
  distance: number;
  plates: number;
  avgSpeed: number;
  maxSpeed: number;
  ratePerMin: number;
  startTime: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const POLL_MS = 2000;

export const REGISTER_GROUPS: { name: string; fields: { key: string; label: string }[] }[] = [
  { name: "Encoder", fields: ENCODER_DETAIL_FIELDS.map((f) => ({ key: f.key, label: f.label })) },
  { name: "Machine Status", fields: TPS_STATUS_FIELDS.map((f) => ({ key: f.key, label: f.label })) },
  { name: "Eject System", fields: TPS_EJECT_FIELDS.map((f) => ({ key: f.key, label: f.label })) },
  { name: "Operating Mode", fields: OPERATING_MODE_FIELDS.map((f) => ({ key: f.key, label: f.label })) },
  { name: "Drop Pipeline", fields: DROP_PIPELINE_FIELDS.map((f) => ({ key: f.key, label: f.label })) },
  { name: "Detection", fields: DETECTION_FIELDS.map((f) => ({ key: f.key, label: f.label })) },
  {
    name: "Signal Metrics",
    fields: [
      { key: "camera_detections_per_min", label: "Flipper Det/min" },
      { key: "eject_rate_per_min", label: "Eject Rate/min" },
      { key: "camera_rate_trend", label: "Flipper Trend" },
      { key: "encoder_noise", label: "Encoder Noise" },
      { key: "modbus_response_time_ms", label: "Modbus Latency (ms)" },
    ],
  },
  {
    name: "Drop Spacing",
    fields: [
      { key: "last_drop_spacing_in", label: "Last Spacing (in)" },
      { key: "avg_drop_spacing_in", label: "Avg Spacing (in)" },
      { key: "min_drop_spacing_in", label: "Min Spacing (in)" },
      { key: "max_drop_spacing_in", label: "Max Spacing (in)" },
      { key: "distance_since_last_drop_in", label: "Since Drop (in)" },
    ],
  },
  { name: "DS Registers", fields: PLC_REGISTER_FIELDS.map((f) => ({ key: f.key, label: f.label })) },
  {
    name: "Connection",
    fields: [
      { key: "total_reads", label: "Total Reads" },
      { key: "total_errors", label: "Total Errors" },
      { key: "uptime_seconds", label: "Uptime (s)" },
      { key: "shift_hours", label: "Shift Hours" },
      { key: "drop_count_in_window", label: "Drops in Window" },
    ],
  },
];

// Simulator scenario presets
export const SIM_SCENARIOS: {
  label: string;
  color: string;
  overrides: Record<string, unknown>;
}[] = [
  {
    label: "Normal Operation",
    color: "bg-green-800",
    overrides: {
      tps_power_loop: true, camera_detections_per_min: 12, camera_rate_trend: "stable",
      encoder_speed_ftpm: 30, drop_enable: true, backup_alarm: false,
      operating_mode: "TPS-1 Single", mode_tps1_single: true, camera_positive: true,
      eject_rate_per_min: 10, diagnostics: "[]", diagnostics_count: 0,
      diagnostics_critical: 0, diagnostics_warning: 0,
    },
  },
  {
    label: "Camera Dead",
    color: "bg-red-800",
    overrides: {
      camera_signal: false, camera_positive: false, camera_detections_per_min: 0,
      camera_rate_trend: "dead", camera_signal_duration_s: 120,
      diagnostics: "[{\"rule\":\"camera_dead_sudden\",\"severity\":\"critical\",\"title\":\"Camera lost\",\"action\":\"Check power and cable\",\"category\":\"camera\"}]",
      diagnostics_count: 1, diagnostics_critical: 1, diagnostics_warning: 0,
    },
  },
  {
    label: "Camera Degrading",
    color: "bg-yellow-800",
    overrides: {
      camera_detections_per_min: 3, camera_rate_trend: "declining", camera_positive: false,
      diagnostics: "[{\"rule\":\"camera_dead_gradual\",\"severity\":\"critical\",\"title\":\"Camera degrading\",\"action\":\"Clean lens\",\"category\":\"camera\"}]",
      diagnostics_count: 1, diagnostics_critical: 1, diagnostics_warning: 0,
    },
  },
  {
    label: "Encoder Stopped",
    color: "bg-red-800",
    overrides: {
      encoder_speed_ftpm: 0, encoder_noise: 0,
      diagnostics: "[{\"rule\":\"encoder_stopped\",\"severity\":\"critical\",\"title\":\"Encoder not reading\",\"action\":\"Check wheel and cable\",\"category\":\"encoder\"}]",
      diagnostics_count: 1, diagnostics_critical: 1, diagnostics_warning: 0,
    },
  },
  {
    label: "Backward",
    color: "bg-orange-800",
    overrides: {
      backup_alarm: true, encoder_direction: "reverse",
      diagnostics: "[{\"rule\":\"backward_travel\",\"severity\":\"warning\",\"title\":\"Truck moving backward\",\"action\":\"Move forward\",\"category\":\"operation\"}]",
      diagnostics_count: 1, diagnostics_critical: 0, diagnostics_warning: 1,
    },
  },
  {
    label: "Drops Disabled",
    color: "bg-red-800",
    overrides: {
      drop_enable: false, drop_enable_latch: false, eject_rate_per_min: 0,
      operating_mode: "None", mode_tps1_single: false,
      diagnostics: "[{\"rule\":\"drop_disabled_troubleshoot\",\"severity\":\"critical\",\"title\":\"TPS powered but drops disabled\",\"action\":\"Select mode and enable drop\",\"category\":\"operation\"}]",
      diagnostics_count: 1, diagnostics_critical: 1, diagnostics_warning: 0,
    },
  },
  {
    label: "PLC Slow",
    color: "bg-yellow-800",
    overrides: {
      modbus_response_time_ms: 15.5,
      diagnostics: "[{\"rule\":\"plc_slow\",\"severity\":\"warning\",\"title\":\"PLC communication slowing\",\"action\":\"Check Ethernet cable\",\"category\":\"plc\"}]",
      diagnostics_count: 1, diagnostics_critical: 0, diagnostics_warning: 1,
    },
  },
  {
    label: "TPS Off",
    color: "bg-gray-700",
    overrides: {
      tps_power_loop: false, encoder_speed_ftpm: 0, camera_signal: false,
      camera_detections_per_min: 0, eject_rate_per_min: 0, drop_enable: false,
      operating_mode: "None", diagnostics: "[]", diagnostics_count: 0,
      diagnostics_critical: 0, diagnostics_warning: 0,
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

export function bool(v: unknown): boolean {
  return v === true || v === 1;
}

export function fmtVal(v: unknown): string {
  if (v === undefined || v === null) return "\u2014";
  if (typeof v === "boolean") return v ? "ON" : "OFF";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(2);
  }
  return String(v);
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function fmtTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function freshnessDot(ts: number | undefined): string {
  if (!ts) return "bg-gray-600";
  const age = Date.now() - ts;
  if (age < 5000) return "bg-green-500";
  if (age < 10000) return "bg-green-700";
  if (age < 30000) return "bg-yellow-500";
  return "bg-red-500";
}

export function parseDiagnostics(raw: unknown): SensorDiagnostic[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as SensorDiagnostic[];
  if (typeof raw !== "string") return [];
  const s = raw.trim();
  if (!s || s === "[]") return [];
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse(
        s.replace(/'/g, '"').replace(/True/g, "true").replace(/False/g, "false").replace(/None/g, "null")
      );
    } catch {
      return [];
    }
  }
}
