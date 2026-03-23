"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

type SensorReadings = Record<string, unknown>;

interface PreFlightCheck {
  id: string;
  label: string;
  pass: boolean | null; // null = not run yet
  detail: string;
}

interface ShiftState {
  active: boolean;
  startTime: number | null;
  startReadings: SensorReadings | null;
  log: { ts: number; distance_ft: number; plates: number; speed: number }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_MS = 2000;

// All 14 diagnostic rules from diagnostics.py
const DIAGNOSTIC_RULES: {
  id: string;
  category: string;
  title: string;
  description: string;
  triggerCondition: string;
  severity: "critical" | "warning" | "info";
}[] = [
  {
    id: "camera_dead_gradual",
    category: "camera",
    title: "Camera detection degrading",
    description: "Camera rate trend is declining and detections per min < 2",
    triggerCondition: "camera_rate_trend == 'declining' AND camera_detections_per_min < 2",
    severity: "critical",
  },
  {
    id: "camera_dead_sudden",
    category: "camera",
    title: "Camera lost -- check power and cable",
    description: "Camera signal dead for >30s while TPS power is on",
    triggerCondition: "camera_rate_trend == 'dead' AND camera_signal_duration_s > 30 AND tps_power_loop == true",
    severity: "critical",
  },
  {
    id: "camera_intermittent",
    category: "camera",
    title: "Camera connection intermittent",
    description: "Camera rate trend shows intermittent pattern",
    triggerCondition: "camera_rate_trend == 'intermittent'",
    severity: "warning",
  },
  {
    id: "no_ties_present",
    category: "camera",
    title: "No ties detected -- may be normal",
    description: "Camera sees nothing, truck is moving, ejects happening (crossings/switches)",
    triggerCondition: "camera_detections_per_min == 0 AND encoder_speed_ftpm > 5 AND eject_rate_per_min > 0",
    severity: "info",
  },
  {
    id: "encoder_stopped",
    category: "encoder",
    title: "Encoder not reading",
    description: "Speed is 0 while TPS power is on for more than 30 seconds",
    triggerCondition: "encoder_speed_ftpm == 0 AND tps_power_loop == true AND tps_power_duration_s > 30",
    severity: "critical",
  },
  {
    id: "encoder_noisy",
    category: "encoder",
    title: "Encoder signal noisy",
    description: "Encoder noise metric exceeds threshold of 10",
    triggerCondition: "encoder_noise > 10",
    severity: "warning",
  },
  {
    id: "encoder_drift",
    category: "encoder",
    title: "Plate spacing drifting from target",
    description: "Average drop spacing differs from DS2 target by more than 2 inches",
    triggerCondition: "ds2 > 0 AND drop_count_in_window > 10 AND abs(avg_drop_spacing_in - ds2*0.5) > 2.0",
    severity: "warning",
  },
  {
    id: "eject_no_confirm",
    category: "eject",
    title: "Eject firing but no Air Eagle confirmation",
    description: "Ejects are happening but neither Air Eagle 1 nor 2 gives feedback",
    triggerCondition: "eject_rate_per_min > 0 AND air_eagle_1_feedback == false AND air_eagle_2_feedback == false",
    severity: "warning",
  },
  {
    id: "eject_not_firing",
    category: "eject",
    title: "No plates dropping -- check drop system",
    description: "Drop is enabled, truck is moving, but eject rate is 0 for >60s",
    triggerCondition: "drop_enable == true AND encoder_speed_ftpm > 5 AND eject_rate_per_min == 0 AND tps_power_duration_s > 60",
    severity: "critical",
  },
  {
    id: "plc_slow",
    category: "plc",
    title: "PLC communication slowing",
    description: "Modbus response time exceeds 5ms",
    triggerCondition: "modbus_response_time_ms > 5",
    severity: "warning",
  },
  {
    id: "plc_errors",
    category: "plc",
    title: "Frequent communication errors",
    description: "Error rate exceeds 1% of total reads (after 100+ reads)",
    triggerCondition: "total_reads > 100 AND (total_errors / total_reads) > 0.01",
    severity: "warning",
  },
  {
    id: "spacing_wrong",
    category: "operation",
    title: "Tie spacing set to non-standard value",
    description: "DS2 is not the standard 39 (19.5 inches)",
    triggerCondition: "ds2 > 0 AND ds2 != 39",
    severity: "info",
  },
  {
    id: "backward_travel",
    category: "operation",
    title: "Truck moving backward -- plates will not drop",
    description: "Backup alarm is active",
    triggerCondition: "backup_alarm == true",
    severity: "warning",
  },
  {
    id: "drop_disabled_troubleshoot",
    category: "operation",
    title: "TPS powered but drops disabled",
    description: "TPS power is on and truck is moving but drop_enable is off",
    triggerCondition: "tps_power_loop == true AND encoder_speed_ftpm > 3 AND drop_enable == false",
    severity: "critical",
  },
];

// Field groups for the live register monitor
const REGISTER_GROUPS: {
  name: string;
  fields: { key: string; label: string }[];
}[] = [
  {
    name: "Encoder",
    fields: [
      ...ENCODER_DETAIL_FIELDS.map((f) => ({ key: f.key, label: f.label })),
    ],
  },
  {
    name: "Machine Status",
    fields: TPS_STATUS_FIELDS.map((f) => ({ key: f.key, label: f.label })),
  },
  {
    name: "Eject System",
    fields: TPS_EJECT_FIELDS.map((f) => ({ key: f.key, label: f.label })),
  },
  {
    name: "Operating Mode",
    fields: OPERATING_MODE_FIELDS.map((f) => ({ key: f.key, label: f.label })),
  },
  {
    name: "Drop Pipeline",
    fields: DROP_PIPELINE_FIELDS.map((f) => ({ key: f.key, label: f.label })),
  },
  {
    name: "Detection",
    fields: DETECTION_FIELDS.map((f) => ({ key: f.key, label: f.label })),
  },
  {
    name: "Signal Metrics",
    fields: [
      { key: "camera_detections_per_min", label: "Camera Det/min" },
      { key: "eject_rate_per_min", label: "Eject Rate/min" },
      { key: "camera_rate_trend", label: "Camera Trend" },
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
      { key: "distance_since_last_drop_in", label: "Distance Since Drop (in)" },
    ],
  },
  {
    name: "DS Registers",
    fields: PLC_REGISTER_FIELDS.map((f) => ({ key: f.key, label: f.label })),
  },
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function bool(v: unknown): boolean {
  return v === true || v === 1;
}

function fmtVal(v: unknown): string {
  if (v === undefined || v === null) return "--";
  if (typeof v === "boolean") return v ? "ON" : "OFF";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(2);
  }
  return String(v);
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function fmtTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Parse sensor diagnostics (same as DiagnosticsPanel)
interface SensorDiagnostic {
  rule: string;
  severity: "critical" | "warning" | "info";
  title: string;
  action: string;
  category?: string;
  evidence?: string;
}

function parseSensorDiagnostics(raw: unknown): SensorDiagnostic[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as SensorDiagnostic[];
  if (typeof raw !== "string") return [];
  const s = raw.trim();
  if (!s || s === "[]") return [];
  try {
    return JSON.parse(s);
  } catch {
    try {
      const jsonStr = s
        .replace(/'/g, '"')
        .replace(/True/g, "true")
        .replace(/False/g, "false")
        .replace(/None/g, "null");
      return JSON.parse(jsonStr);
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DevPage() {
  const [readings, setReadings] = useState<SensorReadings | null>(null);
  const [prevReadings, setPrevReadings] = useState<SensorReadings | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  // Pre-flight
  const [preFlightChecks, setPreFlightChecks] = useState<PreFlightCheck[]>([]);
  const [preFlightRunning, setPreFlightRunning] = useState(false);
  const [preFlightVerdict, setPreFlightVerdict] = useState<"go" | "nogo" | null>(null);

  // Encoder calibration
  const [calActualDist, setCalActualDist] = useState("");
  const [calResult, setCalResult] = useState<{ corrected: number; current: number } | null>(null);
  const [calStartEncoder, setCalStartEncoder] = useState<number | null>(null);

  // Shift simulator
  const [shift, setShift] = useState<ShiftState>({
    active: false,
    startTime: null,
    startReadings: null,
    log: [],
  });

  const changedKeys = useRef<Set<string>>(new Set());
  const changeTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------
  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/sensor-readings?component=plc-monitor");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data: SensorReadings = await res.json();
      setPrevReadings((prev) => prev);
      setReadings((prev) => {
        setPrevReadings(prev);
        return data;
      });
      setPollError(null);
      setPollCount((c) => c + 1);
    } catch (err) {
      setPollError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // Track changed keys for highlight
  useEffect(() => {
    if (!readings || !prevReadings) return;
    for (const key of Object.keys(readings)) {
      if (readings[key] !== prevReadings[key]) {
        changedKeys.current.add(key);
        // Clear old timeout for this key
        const existing = changeTimeouts.current.get(key);
        if (existing) clearTimeout(existing);
        // Remove after 1.5s
        const timeout = setTimeout(() => {
          changedKeys.current.delete(key);
        }, 1500);
        changeTimeouts.current.set(key, timeout);
      }
    }
  }, [readings, prevReadings]);

  // Update shift log
  useEffect(() => {
    if (!shift.active || !readings) return;
    setShift((prev) => ({
      ...prev,
      log: [
        ...prev.log,
        {
          ts: Date.now(),
          distance_ft: num(readings.encoder_distance_ft),
          plates: num(readings.plate_drop_count),
          speed: num(readings.encoder_speed_ftpm),
        },
      ],
    }));
  }, [readings, shift.active]);

  // -------------------------------------------------------------------------
  // Pre-Flight Check
  // -------------------------------------------------------------------------
  const runPreFlight = useCallback(async () => {
    setPreFlightRunning(true);
    setPreFlightVerdict(null);

    const checks: PreFlightCheck[] = [];

    // Fetch live sensor data
    let data: SensorReadings | null = null;
    try {
      const res = await fetch("/api/sensor-readings?component=plc-monitor");
      if (res.ok) {
        data = await res.json();
      }
    } catch {
      // data stays null
    }

    // 1. PLC connected
    checks.push({
      id: "plc-connected",
      label: "PLC Connected (Modbus TCP)",
      pass: data ? data.connected === true : false,
      detail: data
        ? data.connected === true
          ? "Modbus TCP responding"
          : "No PLC connection"
        : "Failed to fetch sensor data",
    });

    // 2. DS registers
    const dsPresent = data
      ? Array.from({ length: 25 }, (_, i) => `ds${i + 1}`).every(
          (k) => data![k] !== undefined
        )
      : false;
    checks.push({
      id: "ds-registers",
      label: "DS1-DS25 Registers Readable",
      pass: dsPresent,
      detail: dsPresent
        ? "All 25 DS registers present"
        : data
          ? `Missing: ${Array.from({ length: 25 }, (_, i) => `ds${i + 1}`)
              .filter((k) => data![k] === undefined)
              .join(", ")}`
          : "No data",
    });

    // 3. Encoder counting
    const encOk = data ? typeof data.encoder_count === "number" : false;
    checks.push({
      id: "encoder",
      label: "Encoder Counting",
      pass: encOk,
      detail: encOk
        ? `Count: ${data!.encoder_count}`
        : "encoder_count not present or not a number",
    });

    // 4. Discrete inputs
    const discrPresent = data
      ? ["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"].every(
          (k) => data![k] !== undefined
        )
      : false;
    checks.push({
      id: "discrete-inputs",
      label: "Discrete Inputs (X1-X8)",
      pass: discrPresent,
      detail: discrPresent
        ? "All 8 discrete inputs present"
        : "Some X inputs missing",
    });

    // 5. Output coils
    const coilsOk = data ? data.eject_tps_1 !== undefined : false;
    checks.push({
      id: "output-coils",
      label: "Output Coils Readable",
      pass: coilsOk,
      detail: coilsOk
        ? `eject_tps_1 = ${data!.eject_tps_1}`
        : "eject_tps_1 not present",
    });

    // 6. C-bits
    const cbitsOk = data ? data.operating_mode !== undefined : false;
    checks.push({
      id: "c-bits",
      label: "C-Bits (Operating Mode)",
      pass: cbitsOk,
      detail: cbitsOk
        ? `Mode: ${data!.operating_mode}`
        : "operating_mode not present",
    });

    // 7. Diagnostics engine
    const diagOk = data ? typeof data.diagnostics_count === "number" : false;
    checks.push({
      id: "diagnostics",
      label: "Diagnostics Engine Loaded",
      pass: diagOk,
      detail: diagOk
        ? `${data!.diagnostics_count} active diagnostics`
        : "diagnostics_count not found",
    });

    // 8. Viam Cloud syncing
    let cloudOk = false;
    let cloudDetail = "Not checked";
    try {
      const hRes = await fetch("/api/sensor-history?type=summary&hours=1");
      if (hRes.ok) {
        const hData = await hRes.json();
        cloudOk = hData.totalPoints > 0;
        cloudDetail = cloudOk
          ? `${hData.totalPoints} data points in last hour`
          : "0 data points in last hour -- data may not be syncing";
      } else {
        cloudDetail = `History API returned ${hRes.status}`;
      }
    } catch (err) {
      cloudDetail = `History fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    checks.push({
      id: "cloud-sync",
      label: "Viam Cloud Syncing",
      pass: cloudOk,
      detail: cloudDetail,
    });

    // 9. Offline buffer
    const bufferOk = data
      ? num(data.total_reads) > 0
      : false;
    checks.push({
      id: "buffer",
      label: "Sensor Active (total_reads > 0)",
      pass: bufferOk,
      detail: bufferOk
        ? `total_reads: ${data!.total_reads}`
        : "total_reads is 0 or missing",
    });

    const allPass = checks.every((c) => c.pass === true);
    setPreFlightChecks(checks);
    setPreFlightVerdict(allPass ? "go" : "nogo");
    setPreFlightRunning(false);
  }, []);

  // -------------------------------------------------------------------------
  // Shift simulator helpers
  // -------------------------------------------------------------------------
  const startShift = useCallback(() => {
    setShift({
      active: true,
      startTime: Date.now(),
      startReadings: readings,
      log: [],
    });
  }, [readings]);

  const endShift = useCallback(() => {
    setShift((prev) => ({ ...prev, active: false }));
  }, []);

  // Compute shift stats
  const shiftStats = (() => {
    if (!shift.startTime || !shift.startReadings || !readings) return null;

    const elapsed = (Date.now() - shift.startTime) / 1000;
    const startDist = num(shift.startReadings.encoder_distance_ft);
    const startPlates = num(shift.startReadings.plate_drop_count);
    const curDist = num(readings.encoder_distance_ft);
    const curPlates = num(readings.plate_drop_count);
    const distance = curDist - startDist;
    const plates = curPlates - startPlates;
    const speeds = shift.log.map((l) => l.speed).filter((s) => s > 0);
    const avgSpeed = speeds.length > 0
      ? speeds.reduce((a, b) => a + b, 0) / speeds.length
      : 0;
    const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
    const ratePerMin = elapsed > 60 ? (plates / elapsed) * 60 : 0;

    return {
      elapsed,
      distance,
      plates,
      avgSpeed,
      maxSpeed,
      ratePerMin,
      startTime: shift.startTime,
    };
  })();

  // -------------------------------------------------------------------------
  // Active diagnostics from sensor data
  // -------------------------------------------------------------------------
  const activeDiagnostics = readings
    ? parseSensorDiagnostics(readings.diagnostics)
    : [];
  const activeDiagRules = new Set(activeDiagnostics.map((d) => d.rule));

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-3 sm:px-6 py-3 flex items-center justify-between gap-3 sticky top-0 z-40 bg-gray-950/95 backdrop-blur-sm">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-black tracking-widest uppercase text-gray-100 leading-none">
            IronSight Dev Mode
          </h1>
          <p className="text-[10px] sm:text-xs text-gray-600 mt-0.5 tracking-wide">
            TPS System Testing & Calibration
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${readings && !pollError ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-xs text-gray-500 hidden sm:inline">
            Poll #{pollCount}
          </span>
          <a
            href="/"
            className="text-xs text-gray-500 hover:text-gray-300 border border-gray-800 rounded-lg px-3 py-1.5 transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
      </header>

      {pollError && (
        <div className="mx-3 sm:mx-6 mt-3 p-3 bg-red-950/30 border border-red-900/50 rounded-lg text-xs text-red-400">
          Poll error: {pollError}
        </div>
      )}

      <main className="px-3 sm:px-6 py-4 sm:py-6 space-y-4">

        {/* ================================================================ */}
        {/* A. Pre-Flight Check                                              */}
        {/* ================================================================ */}
        <details className="border border-gray-800 rounded-2xl" open>
          <summary className="p-4 sm:p-5 cursor-pointer select-none text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-400">
            A. Pre-Flight Check (Go / No-Go)
          </summary>
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            {/* Verdict banner */}
            {preFlightVerdict && (
              <div
                className={`mb-4 p-4 rounded-xl text-center text-2xl sm:text-3xl font-black uppercase tracking-widest ${
                  preFlightVerdict === "go"
                    ? "bg-green-950/30 border border-green-500/40 text-green-400"
                    : "bg-red-950/30 border border-red-500/40 text-red-400"
                }`}
              >
                {preFlightVerdict === "go" ? "GO" : "NO-GO"}
              </div>
            )}

            <button
              onClick={runPreFlight}
              disabled={preFlightRunning}
              className="mb-4 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-bold uppercase tracking-wider rounded-lg transition-colors"
            >
              {preFlightRunning ? "Running checks..." : "Run All Checks"}
            </button>

            {preFlightChecks.length > 0 && (
              <div className="space-y-1.5">
                {preFlightChecks.map((check) => (
                  <div
                    key={check.id}
                    className={`flex items-start gap-3 py-2 px-3 rounded-lg ${
                      check.pass === true
                        ? "bg-green-950/10"
                        : check.pass === false
                          ? "bg-red-950/20"
                          : ""
                    }`}
                  >
                    <span
                      className={`shrink-0 font-bold text-sm w-5 text-center mt-0.5 ${
                        check.pass === true
                          ? "text-green-500"
                          : check.pass === false
                            ? "text-red-500"
                            : "text-gray-600"
                      }`}
                    >
                      {check.pass === true ? "\u2713" : check.pass === false ? "\u2715" : "-"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="font-bold text-sm text-gray-200">
                        {check.label}
                      </span>
                      <p className="text-xs text-gray-500 mt-0.5">{check.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {preFlightChecks.length === 0 && !preFlightRunning && (
              <p className="text-sm text-gray-600">
                Click &quot;Run All Checks&quot; to validate the system before deployment.
              </p>
            )}
          </div>
        </details>

        {/* ================================================================ */}
        {/* B. Live Register Monitor                                          */}
        {/* ================================================================ */}
        <details className="border border-gray-800 rounded-2xl">
          <summary className="p-4 sm:p-5 cursor-pointer select-none text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-400">
            B. Live Register Monitor
            {readings && (
              <span className="ml-2 text-gray-700 normal-case tracking-normal font-normal">
                -- {Object.keys(readings).length} fields, refreshing every {POLL_MS / 1000}s
              </span>
            )}
          </summary>
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            {!readings ? (
              <p className="text-sm text-gray-600 animate-pulse">
                Waiting for first reading...
              </p>
            ) : (
              <div className="space-y-5">
                {REGISTER_GROUPS.map((group) => (
                  <div key={group.name}>
                    <h4 className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
                      {group.name}
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-700 text-left">
                            <th className="py-1 pr-3 font-normal">Field</th>
                            <th className="py-1 pr-3 font-normal">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.fields.map(({ key, label }) => {
                            const val = readings[key];
                            const changed = changedKeys.current.has(key);
                            return (
                              <tr
                                key={key}
                                className={`border-t border-gray-900/50 transition-colors duration-700 ${
                                  changed ? "bg-yellow-900/20" : ""
                                }`}
                              >
                                <td className="py-1 pr-3 text-gray-500 font-mono whitespace-nowrap">
                                  {label}
                                  <span className="text-gray-800 ml-1">({key})</span>
                                </td>
                                <td className="py-1 font-mono font-bold text-gray-200 whitespace-nowrap">
                                  {fmtVal(val)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {/* Active Diagnostics in the monitor */}
                <div>
                  <h4 className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
                    Active Diagnostics ({activeDiagnostics.length})
                  </h4>
                  {activeDiagnostics.length === 0 ? (
                    <p className="text-xs text-gray-700">All clear -- no diagnostics firing.</p>
                  ) : (
                    <div className="space-y-1">
                      {activeDiagnostics.map((d, i) => (
                        <div
                          key={`${d.rule}-${i}`}
                          className={`py-1.5 px-2 rounded text-xs ${
                            d.severity === "critical"
                              ? "bg-red-950/20 text-red-400"
                              : d.severity === "warning"
                                ? "bg-yellow-950/20 text-yellow-400"
                                : "bg-blue-950/20 text-blue-400"
                          }`}
                        >
                          <span className="font-bold">[{d.severity.toUpperCase()}]</span>{" "}
                          <span className="font-mono">{d.rule}</span> -- {d.title}
                          {d.evidence && (
                            <span className="text-gray-600 ml-1">({d.evidence})</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </details>

        {/* ================================================================ */}
        {/* C. Encoder Calibration Tool                                       */}
        {/* ================================================================ */}
        <details className="border border-gray-800 rounded-2xl">
          <summary className="p-4 sm:p-5 cursor-pointer select-none text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-400">
            C. Encoder Calibration Tool
          </summary>
          <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4">
            {/* Current settings */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-600 uppercase tracking-wide">
                  Wheel Diameter
                </span>
                <span className="font-mono font-bold text-sm text-blue-400">
                  {readings && readings.wheel_diameter_mm !== undefined
                    ? `${readings.wheel_diameter_mm} mm`
                    : "-- mm"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-600 uppercase tracking-wide">
                  Encoder Count
                </span>
                <span className="font-mono font-bold text-sm text-gray-200">
                  {readings ? fmtVal(readings.encoder_count) : "--"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-600 uppercase tracking-wide">
                  Distance (ft)
                </span>
                <span className="font-mono font-bold text-sm text-gray-200">
                  {readings ? fmtVal(readings.encoder_distance_ft) : "--"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-gray-600 uppercase tracking-wide">
                  Speed (ft/min)
                </span>
                <span className="font-mono font-bold text-sm text-gray-200">
                  {readings ? fmtVal(readings.encoder_speed_ftpm) : "--"}
                </span>
              </div>
            </div>

            {/* Instructions */}
            <div className="bg-gray-900/50 rounded-lg p-4 border-l-2 border-blue-500/40">
              <h5 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">
                Calibration Procedure
              </h5>
              <ol className="text-xs text-gray-400 space-y-1.5 list-decimal list-inside">
                <li>Mark a start point on the rail next to the truck wheel.</li>
                <li>
                  Click <strong>&quot;Mark Start&quot;</strong> below to capture the current encoder reading.
                </li>
                <li>Push the truck exactly <strong>100 feet</strong> (or a known distance).</li>
                <li>Enter the actual measured distance in the field below.</li>
                <li>
                  Click <strong>&quot;Calculate&quot;</strong> to compute the corrected wheel diameter.
                </li>
                <li>Update the Viam config with the corrected diameter value.</li>
              </ol>
            </div>

            {/* Calibration controls */}
            <div className="flex flex-wrap items-end gap-3">
              <button
                onClick={() => {
                  if (readings) {
                    setCalStartEncoder(num(readings.encoder_distance_ft));
                    setCalResult(null);
                  }
                }}
                disabled={!readings}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors"
              >
                Mark Start
              </button>

              {calStartEncoder !== null && (
                <span className="text-xs text-gray-500">
                  Start: {calStartEncoder.toFixed(2)} ft
                  {readings && (
                    <span className="ml-2 text-gray-400">
                      | Current: {num(readings.encoder_distance_ft).toFixed(2)} ft
                      | Measured: {(num(readings.encoder_distance_ft) - calStartEncoder).toFixed(2)} ft
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-600 uppercase tracking-wide mb-1">
                  Actual Distance (ft)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={calActualDist}
                  onChange={(e) => setCalActualDist(e.target.value)}
                  placeholder="e.g. 100"
                  className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-200 w-40 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <button
                onClick={() => {
                  if (!readings || calStartEncoder === null || !calActualDist) return;
                  const measured = num(readings.encoder_distance_ft) - calStartEncoder;
                  const actual = parseFloat(calActualDist);
                  if (measured <= 0 || actual <= 0) return;
                  const currentDia = num(readings.wheel_diameter_mm) || 200;
                  const corrected = currentDia * (actual / measured);
                  setCalResult({ corrected, current: currentDia });
                }}
                disabled={!readings || calStartEncoder === null || !calActualDist}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors"
              >
                Calculate
              </button>
            </div>

            {calResult && (
              <div className="bg-green-950/20 border border-green-900/40 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-gray-600 uppercase">Current Diameter</span>
                    <span className="font-mono font-bold text-sm text-gray-400">
                      {calResult.current.toFixed(2)} mm
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-green-600 uppercase">Corrected Diameter</span>
                    <span className="font-mono font-bold text-lg text-green-400">
                      {calResult.corrected.toFixed(2)} mm
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  Update the Viam config for plc-monitor with{" "}
                  <code className="bg-gray-900 px-1.5 py-0.5 rounded text-green-400">
                    &quot;wheel_diameter_mm&quot;: {calResult.corrected.toFixed(2)}
                  </code>
                  {" "}then restart viam-server.
                </p>
              </div>
            )}
          </div>
        </details>

        {/* ================================================================ */}
        {/* D. Shift Simulator                                                */}
        {/* ================================================================ */}
        <details className="border border-gray-800 rounded-2xl">
          <summary className="p-4 sm:p-5 cursor-pointer select-none text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-400">
            D. Shift Simulator
            {shift.active && (
              <span className="ml-2 text-green-500 normal-case tracking-normal font-normal animate-pulse">
                -- ACTIVE
              </span>
            )}
          </summary>
          <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4">
            <div className="flex gap-3">
              {!shift.active ? (
                <button
                  onClick={startShift}
                  disabled={!readings}
                  className="px-5 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-bold uppercase tracking-wider rounded-lg transition-colors"
                >
                  Start Shift
                </button>
              ) : (
                <button
                  onClick={endShift}
                  className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold uppercase tracking-wider rounded-lg transition-colors"
                >
                  End Shift
                </button>
              )}
            </div>

            {shiftStats && (
              <>
                {/* Status line */}
                <div className="text-xs text-gray-500">
                  Started: {fmtTimestamp(shiftStats.startTime)}
                  {!shift.active && " (ended)"}
                  {" | "}
                  Samples: {shift.log.length}
                </div>

                {/* Big 3 */}
                <div className="grid grid-cols-3 gap-3 sm:gap-4">
                  <div className="flex flex-col items-center p-3 bg-gray-900/50 rounded-xl">
                    <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide">
                      Elapsed
                    </span>
                    <span className="font-mono font-bold text-lg sm:text-xl text-gray-200">
                      {fmtDuration(shiftStats.elapsed)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-3 bg-gray-900/50 rounded-xl">
                    <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide">
                      Distance
                    </span>
                    <span className="font-mono font-bold text-lg sm:text-xl text-blue-400">
                      {shiftStats.distance.toFixed(1)}
                      <span className="text-gray-600 font-normal text-xs ml-0.5">ft</span>
                    </span>
                    <span className="text-[10px] text-gray-700">
                      {(shiftStats.distance / 5280).toFixed(3)} mi
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-3 bg-gray-900/50 rounded-xl">
                    <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide">
                      Plates
                    </span>
                    <span className="font-mono font-bold text-lg sm:text-xl text-green-400">
                      {shiftStats.plates}
                    </span>
                    <span className="text-[10px] text-gray-700">
                      {shiftStats.ratePerMin.toFixed(1)}/min
                    </span>
                  </div>
                </div>

                {/* Detail stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] text-gray-600 uppercase">Avg Speed</span>
                    <span className="font-mono font-bold text-xs text-gray-300">
                      {shiftStats.avgSpeed.toFixed(1)} ft/min
                    </span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] text-gray-600 uppercase">Max Speed</span>
                    <span className="font-mono font-bold text-xs text-gray-300">
                      {shiftStats.maxSpeed.toFixed(1)} ft/min
                    </span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] text-gray-600 uppercase">Rate</span>
                    <span className="font-mono font-bold text-xs text-gray-300">
                      {shiftStats.ratePerMin.toFixed(1)} plates/min
                    </span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] text-gray-600 uppercase">Time Active</span>
                    <span className="font-mono font-bold text-xs text-gray-300">
                      {fmtDuration(shiftStats.elapsed)}
                    </span>
                  </div>
                </div>

                {/* Shift report (shown after end) */}
                {!shift.active && (
                  <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 mt-2">
                    <h5 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
                      Shift Summary Report
                    </h5>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                      <div className="flex flex-col">
                        <span className="text-gray-600">Period</span>
                        <span className="text-gray-300 font-mono">
                          {fmtTimestamp(shiftStats.startTime)} - {fmtTimestamp(Date.now())}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-600">Duration</span>
                        <span className="text-gray-300 font-mono">
                          {fmtDuration(shiftStats.elapsed)}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-600">Total Distance</span>
                        <span className="text-gray-300 font-mono">
                          {shiftStats.distance.toFixed(1)} ft ({(shiftStats.distance / 5280).toFixed(3)} mi)
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-600">Total Plates</span>
                        <span className="text-gray-300 font-mono">
                          {shiftStats.plates}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-600">Avg Plate Rate</span>
                        <span className="text-gray-300 font-mono">
                          {shiftStats.ratePerMin.toFixed(1)}/min
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-600">Avg Speed</span>
                        <span className="text-gray-300 font-mono">
                          {shiftStats.avgSpeed.toFixed(1)} ft/min
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-600">Max Speed</span>
                        <span className="text-gray-300 font-mono">
                          {shiftStats.maxSpeed.toFixed(1)} ft/min
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-600">Samples</span>
                        <span className="text-gray-300 font-mono">
                          {shift.log.length}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {!shiftStats && !shift.active && (
              <p className="text-sm text-gray-600">
                Start a simulated shift to track live production metrics.
                All computation is client-side using polled data.
              </p>
            )}
          </div>
        </details>

        {/* ================================================================ */}
        {/* E. Diagnostic Test Panel                                          */}
        {/* ================================================================ */}
        <details className="border border-gray-800 rounded-2xl">
          <summary className="p-4 sm:p-5 cursor-pointer select-none text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-400">
            E. Diagnostic Rules ({DIAGNOSTIC_RULES.length})
            {activeDiagnostics.length > 0 && (
              <span className="ml-2 text-yellow-500 normal-case tracking-normal font-normal">
                -- {activeDiagnostics.length} active
              </span>
            )}
          </summary>
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            <div className="space-y-2">
              {DIAGNOSTIC_RULES.map((rule) => {
                const isActive = activeDiagRules.has(rule.id);
                const liveData = activeDiagnostics.find((d) => d.rule === rule.id);
                return (
                  <div
                    key={rule.id}
                    className={`border rounded-lg p-3 ${
                      isActive
                        ? rule.severity === "critical"
                          ? "border-red-900/50 bg-red-950/15"
                          : rule.severity === "warning"
                            ? "border-yellow-900/50 bg-yellow-950/15"
                            : "border-blue-900/50 bg-blue-950/15"
                        : "border-gray-800/50 bg-gray-900/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`shrink-0 font-bold text-xs w-5 text-center ${
                            isActive
                              ? rule.severity === "critical"
                                ? "text-red-500"
                                : rule.severity === "warning"
                                  ? "text-yellow-500"
                                  : "text-blue-400"
                              : "text-gray-700"
                          }`}
                        >
                          {isActive ? (rule.severity === "info" ? "\u2139" : rule.severity === "warning" ? "\u26A0" : "\u2715") : "\u2713"}
                        </span>
                        <span className="font-bold text-sm text-gray-200">
                          {rule.title}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                          {rule.category}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                          isActive
                            ? rule.severity === "critical"
                              ? "bg-red-500/20 text-red-400"
                              : rule.severity === "warning"
                                ? "bg-yellow-500/20 text-yellow-400"
                                : "bg-blue-500/20 text-blue-400"
                            : "bg-gray-800 text-gray-600"
                        }`}
                      >
                        {isActive ? "ACTIVE" : "CLEAR"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5">{rule.description}</p>
                    <div className="mt-2 bg-gray-900/60 rounded px-2.5 py-1.5 border-l-2 border-gray-700">
                      <span className="text-[10px] text-gray-700 uppercase tracking-wider font-bold">
                        Trigger:
                      </span>
                      <code className="text-[10px] sm:text-xs text-gray-500 font-mono ml-1 break-all">
                        {rule.triggerCondition}
                      </code>
                    </div>
                    {isActive && liveData?.action && (
                      <div className="mt-2 bg-gray-900/50 rounded px-2.5 py-1.5 border-l-2 border-blue-500/40">
                        <span className="text-[10px] text-blue-400 uppercase tracking-wider font-bold">
                          What to do:
                        </span>
                        <span className="text-xs text-gray-400 ml-1">{liveData.action}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </details>

        {/* ================================================================ */}
        {/* F. System Info                                                     */}
        {/* ================================================================ */}
        <details className="border border-gray-800 rounded-2xl">
          <summary className="p-4 sm:p-5 cursor-pointer select-none text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-400">
            F. System Info
          </summary>
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
              <SysInfoItem
                label="Pi Tailscale IP"
                value="100.112.68.52"
              />
              <SysInfoItem
                label="PLC IP"
                value={
                  readings && readings.plc_ip
                    ? String(readings.plc_ip)
                    : "169.168.10.21"
                }
              />
              <SysInfoItem
                label="PLC Port"
                value={
                  readings && readings.plc_port
                    ? String(readings.plc_port)
                    : "502"
                }
              />
              <SysInfoItem
                label="Viam Part ID"
                value="7c24d42f-1d66-4cae-81a4-97e3ff9404b4"
              />
              <SysInfoItem
                label="Modbus Latency"
                value={
                  readings && typeof readings.modbus_response_time_ms === "number"
                    ? `${(readings.modbus_response_time_ms as number).toFixed(1)} ms`
                    : "-- ms"
                }
              />
              <SysInfoItem
                label="Total Reads"
                value={
                  readings && typeof readings.total_reads === "number"
                    ? (readings.total_reads as number).toLocaleString()
                    : "--"
                }
              />
              <SysInfoItem
                label="Total Errors"
                value={
                  readings && typeof readings.total_errors === "number"
                    ? (readings.total_errors as number).toLocaleString()
                    : "--"
                }
              />
              <SysInfoItem
                label="Error Rate"
                value={
                  readings &&
                  typeof readings.total_reads === "number" &&
                  typeof readings.total_errors === "number" &&
                  (readings.total_reads as number) > 0
                    ? `${(((readings.total_errors as number) / (readings.total_reads as number)) * 100).toFixed(3)}%`
                    : "-- %"
                }
              />
              <SysInfoItem
                label="Uptime"
                value={
                  readings && typeof readings.uptime_seconds === "number"
                    ? fmtDuration(readings.uptime_seconds as number)
                    : "--"
                }
              />
              <SysInfoItem
                label="Shift Hours"
                value={
                  readings && typeof readings.shift_hours === "number"
                    ? `${(readings.shift_hours as number).toFixed(1)} hrs`
                    : "-- hrs"
                }
              />
              <SysInfoItem
                label="Encoder Revolutions"
                value={
                  readings && readings.encoder_revolutions !== undefined
                    ? fmtVal(readings.encoder_revolutions)
                    : "--"
                }
              />
              <SysInfoItem
                label="Firmware"
                value={
                  readings && readings.firmware_version
                    ? String(readings.firmware_version)
                    : "N/A"
                }
              />
              <SysInfoItem
                label="Dashboard Polls"
                value={String(pollCount)}
              />
              <SysInfoItem
                label="Poll Interval"
                value={`${POLL_MS / 1000}s`}
              />
              <SysInfoItem
                label="PLC Connected"
                value={
                  readings
                    ? bool(readings.connected)
                      ? "Yes"
                      : "No"
                    : "--"
                }
              />
              <SysInfoItem
                label="Operating Mode"
                value={
                  readings && readings.operating_mode
                    ? String(readings.operating_mode)
                    : "--"
                }
              />
            </div>
          </div>
        </details>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-3 sm:px-6 py-2 sm:py-3 text-[10px] sm:text-xs text-gray-700 flex items-center justify-between">
        <span>
          Dev Mode -- Polling every {POLL_MS / 1000}s
        </span>
        <span>
          IronSight TPS -- {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System Info sub-component
// ---------------------------------------------------------------------------
function SysInfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide truncate">
        {label}
      </span>
      <span className="font-mono text-xs sm:text-sm text-gray-300 truncate">
        {value}
      </span>
    </div>
  );
}
