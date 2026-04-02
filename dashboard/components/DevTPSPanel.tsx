"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  PLC_REGISTER_FIELDS,
  ENCODER_DETAIL_FIELDS,
  TPS_STATUS_FIELDS,
  TPS_EJECT_FIELDS,
  OPERATING_MODE_FIELDS,
  DROP_PIPELINE_FIELDS,
  DETECTION_FIELDS,
} from "../lib/sensors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type SensorReadings = Record<string, unknown>;

interface SensorDiagnostic {
  rule: string;
  severity: "critical" | "warning" | "info";
  title: string;
  action: string;
  category?: string;
  evidence?: string;
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

const REGISTER_GROUPS: { name: string; fields: { key: string; label: string }[] }[] = [
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
const SIM_SCENARIOS: {
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

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function bool(v: unknown): boolean {
  return v === true || v === 1;
}

function fmtVal(v: unknown): string {
  if (v === undefined || v === null) return "\u2014";
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
  return `${h}h ${m % 60}m`;
}

function fmtTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function freshnessDot(ts: number | undefined): string {
  if (!ts) return "bg-gray-600";
  const age = Date.now() - ts;
  if (age < 5000) return "bg-green-500";
  if (age < 10000) return "bg-green-700";
  if (age < 30000) return "bg-yellow-500";
  return "bg-red-500";
}

function parseDiagnostics(raw: unknown): SensorDiagnostic[] {
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DevTPSPanel() {
  const [expanded, setExpanded] = useState(true);
  const [readings, setReadings] = useState<SensorReadings | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  // Freshness tracking
  const lastChangeRef = useRef<Record<string, number>>({});
  const prevReadingsRef = useRef<SensorReadings | null>(null);

  // Simulator
  const [simEnabled, setSimEnabled] = useState(false);
  const [simOverrides, setSimOverrides] = useState<Record<string, unknown>>({});
  const simTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simDistRef = useRef(0);
  const simPlatesRef = useRef(0);

  // Remote control
  const [cmdResult, setCmdResult] = useState<{ status: string; message: string } | null>(null);
  const [cmdLoading, setCmdLoading] = useState(false);

  // Encoder calibration
  const [calActualDist, setCalActualDist] = useState("");
  const [calResult, setCalResult] = useState<{ corrected: number; current: number } | null>(null);
  const [calStartEncoder, setCalStartEncoder] = useState<number | null>(null);

  // Shift simulator
  const [shift, setShift] = useState<ShiftState>({
    active: false, startTime: null, startReadings: null, log: [],
  });

  // Raw JSON
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  // -----------------------------------------------------------------------
  // Polling
  // -----------------------------------------------------------------------
  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/sensor-readings?component=plc-monitor");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data: SensorReadings = await res.json();
      const final = simEnabled ? { ...data, ...simOverrides } : data;

      // Track freshness
      const now = Date.now();
      const prev = prevReadingsRef.current;
      if (prev) {
        for (const key of Object.keys(final)) {
          if (JSON.stringify(final[key]) !== JSON.stringify(prev[key])) {
            lastChangeRef.current[key] = now;
          }
        }
      } else {
        for (const key of Object.keys(final)) {
          lastChangeRef.current[key] = now;
        }
      }
      prevReadingsRef.current = { ...final };

      setReadings(final);
      setPollError(null);
      setPollCount((c) => c + 1);
    } catch (err) {
      setPollError(err instanceof Error ? err.message : String(err));
    }
  }, [simEnabled, simOverrides]);

  useEffect(() => {
    if (!expanded) return;
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [expanded, poll]);

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

  // -----------------------------------------------------------------------
  // Remote command
  // -----------------------------------------------------------------------
  const sendCommand = async (command: Record<string, unknown>) => {
    setCmdLoading(true);
    setCmdResult(null);
    try {
      const res = await fetch("/api/plc-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const data = await res.json();
      setCmdResult({
        status: data.status || "error",
        message: data.message || data.error || "Unknown response",
      });
    } catch (err) {
      setCmdResult({
        status: "error",
        message: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setCmdLoading(false);
    }
  };

  // -----------------------------------------------------------------------
  // Simulator toggle
  // -----------------------------------------------------------------------
  const toggleSimulator = () => {
    if (!simEnabled) {
      simDistRef.current = 0;
      simPlatesRef.current = 0;
      setSimOverrides({
        connected: true, tps_power_loop: true, operating_mode: "TPS-1 Single",
        mode_tps1_single: true, drop_enable: true, drop_enable_latch: true,
        encoder_speed_ftpm: 30, encoder_distance_ft: 0, encoder_direction: "forward",
        camera_signal: true, camera_positive: true, camera_detections_per_min: 12,
        camera_rate_trend: "stable", eject_rate_per_min: 10, lay_ties_set: true,
        drop_ties: true, first_tie_detected: true, encoder_mode: false,
        backup_alarm: false, ds2: 39, ds3: 195, plate_drop_count: 0,
        total_reads: 200, diagnostics: "[]", diagnostics_count: 0,
        diagnostics_critical: 0, diagnostics_warning: 0,
      });
      if (simTimerRef.current) clearInterval(simTimerRef.current);
      simTimerRef.current = setInterval(() => {
        simDistRef.current += 0.5;
        if (Math.random() < 0.62) simPlatesRef.current += 1;
        setSimOverrides((prev) => ({
          ...prev,
          encoder_distance_ft: Math.round(simDistRef.current * 10) / 10,
          plate_drop_count: simPlatesRef.current,
          encoder_revolutions: Math.round((simDistRef.current / 4.19) * 100) / 100,
        }));
      }, 1000);
      setSimEnabled(true);
    } else {
      if (simTimerRef.current) clearInterval(simTimerRef.current);
      simTimerRef.current = null;
      setSimOverrides({});
      setSimEnabled(false);
    }
  };

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------
  const isConnected = readings ? bool(readings.connected) : false;
  const diagnostics = readings ? parseDiagnostics(readings.diagnostics) : [];

  // Shift stats
  const shiftStats = (() => {
    if (!shift.startTime || !shift.startReadings || !readings) return null;
    const elapsed = (Date.now() - shift.startTime) / 1000;
    const distance = num(readings.encoder_distance_ft) - num(shift.startReadings.encoder_distance_ft);
    const plates = num(readings.plate_drop_count) - num(shift.startReadings.plate_drop_count);
    const speeds = shift.log.map((l) => l.speed).filter((s) => s > 0);
    const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
    const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
    const ratePerMin = elapsed > 60 ? (plates / elapsed) * 60 : 0;
    return { elapsed, distance, plates, avgSpeed, maxSpeed, ratePerMin, startTime: shift.startTime };
  })();

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <section className="border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left hover:bg-gray-900/30 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isConnected && !pollError ? "bg-green-500" : pollError ? "bg-red-500" : "bg-gray-600"
            }`}
          />
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
            Pi 5 &mdash; TPS / PLC
          </h2>
          {simEnabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-400 uppercase font-bold tracking-wider">
              SIM
            </span>
          )}
        </div>
        <span className="text-gray-600 text-xs shrink-0">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {expanded && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-5">
          {pollError && (
            <div className="p-3 bg-red-950/30 border border-red-900/50 rounded-lg text-xs text-red-400">
              {pollError}
            </div>
          )}

          {/* ============================================================= */}
          {/* PLC Connection                                                 */}
          {/* ============================================================= */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
              PLC Connection
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
              <KV label="Modbus TCP" value={isConnected ? "Connected" : "Disconnected"} />
              <KV label="PLC IP" value="169.168.10.21:502" mono />
              <KV
                label="Response Time"
                value={
                  readings && typeof readings.modbus_response_time_ms === "number"
                    ? `${(readings.modbus_response_time_ms as number).toFixed(1)} ms`
                    : "\u2014"
                }
              />
              <KV
                label="Error Count"
                value={typeof readings?.total_errors === "number" ? (readings.total_errors as number).toLocaleString() : "\u2014"}
              />
              <KV label="Total Reads" value={typeof readings?.total_reads === "number" ? (readings.total_reads as number).toLocaleString() : "\u2014"} />
              <KV
                label="Error Rate"
                value={
                  readings && typeof readings.total_reads === "number" && typeof readings.total_errors === "number" && (readings.total_reads as number) > 0
                    ? `${(((readings.total_errors as number) / (readings.total_reads as number)) * 100).toFixed(3)}%`
                    : "\u2014"
                }
              />
              <KV label="Mode" value={readings?.operating_mode ? String(readings.operating_mode) : "\u2014"} />
              <KV label="Poll #" value={String(pollCount)} />
            </div>
          </div>

          {/* ============================================================= */}
          {/* Live Readings                                                  */}
          {/* ============================================================= */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
              Live Readings
              {readings && (
                <span className="ml-2 text-gray-700 normal-case tracking-normal font-normal">
                  {Object.keys(readings).length} fields, {POLL_MS / 1000}s refresh
                </span>
              )}
            </h3>
            {!readings ? (
              <p className="text-xs text-gray-700 animate-pulse">Waiting for first reading&hellip;</p>
            ) : (
              <div className="space-y-4">
                {REGISTER_GROUPS.map((group) => (
                  <div key={group.name}>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-1">
                      {group.name}
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <tbody>
                          {group.fields.map(({ key, label }) => {
                            const val = readings[key];
                            const lastTs = lastChangeRef.current[key];
                            const isHighlight = key === "ds7" || key === "ds10" || key === "ds8";
                            return (
                              <tr
                                key={key}
                                className={`border-t border-gray-900/50 ${isHighlight ? "bg-blue-950/10" : ""}`}
                              >
                                <td className="py-1 pr-2 w-4">
                                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${freshnessDot(lastTs)}`} />
                                </td>
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
              </div>
            )}
          </div>

          {/* ============================================================= */}
          {/* Active Diagnostics                                             */}
          {/* ============================================================= */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
              Active Diagnostics ({diagnostics.length})
            </h3>
            {diagnostics.length === 0 ? (
              <p className="text-xs text-gray-700">All clear &mdash; no diagnostics firing.</p>
            ) : (
              <div className="space-y-1">
                {diagnostics.map((d, i) => (
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
                    <span className="font-mono">{d.rule}</span> &mdash; {d.title}
                    {d.action && (
                      <span className="block mt-0.5 text-gray-500 text-[10px]">{d.action}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ============================================================= */}
          {/* Raw JSON                                                       */}
          {/* ============================================================= */}
          <div>
            <button
              onClick={() => setShowRaw((r) => !r)}
              className="text-[10px] font-bold uppercase tracking-widest text-gray-600 hover:text-gray-400 transition-colors"
            >
              {showRaw ? "\u25BC" : "\u25B6"} Raw JSON
            </button>
            {showRaw && readings && (
              <div className="mt-2 relative">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(readings, null, 2));
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="absolute top-2 right-2 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 text-[10px] rounded transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <pre className="bg-gray-900/50 border border-gray-800 rounded-lg p-3 text-[10px] sm:text-xs text-gray-400 font-mono overflow-x-auto max-h-96 overflow-y-auto">
                  {JSON.stringify(readings, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* ============================================================= */}
          {/* Encoder Calibration                                            */}
          {/* ============================================================= */}
          <details className="border border-gray-800/50 rounded-xl">
            <summary className="p-3 cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-gray-600 hover:text-gray-400">
              Encoder Calibration
            </summary>
            <div className="px-3 pb-3 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KV label="Wheel Diameter" value={readings?.wheel_diameter_mm !== undefined ? `${readings.wheel_diameter_mm} mm` : "\u2014"} />
                <KV label="Encoder Count" value={readings ? fmtVal(readings.encoder_count) : "\u2014"} />
                <KV label="Distance (ft)" value={readings ? fmtVal(readings.encoder_distance_ft) : "\u2014"} />
                <KV label="Speed (ft/min)" value={readings ? fmtVal(readings.encoder_speed_ftpm) : "\u2014"} />
              </div>
              <div className="bg-gray-900/50 rounded-lg p-3 border-l-2 border-blue-500/40">
                <ol className="text-[10px] text-gray-500 space-y-1 list-decimal list-inside">
                  <li>Mark a start point on the rail.</li>
                  <li>Click &quot;Mark Start&quot; to capture encoder reading.</li>
                  <li>Push truck a known distance (e.g. 100 ft).</li>
                  <li>Enter actual distance and click &quot;Calculate&quot;.</li>
                </ol>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <button
                  onClick={() => {
                    if (readings) {
                      setCalStartEncoder(num(readings.encoder_distance_ft));
                      setCalResult(null);
                    }
                  }}
                  disabled={!readings}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-[10px] font-bold uppercase rounded-lg transition-colors"
                >
                  Mark Start
                </button>
                {calStartEncoder !== null && (
                  <span className="text-[10px] text-gray-500">
                    Start: {calStartEncoder.toFixed(2)} ft
                    {readings && (
                      <span className="ml-2 text-gray-400">
                        | Delta: {(num(readings.encoder_distance_ft) - calStartEncoder).toFixed(2)} ft
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col">
                  <label className="text-[10px] text-gray-600 uppercase tracking-wide mb-0.5">Actual Distance (ft)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={calActualDist}
                    onChange={(e) => setCalActualDist(e.target.value)}
                    placeholder="e.g. 100"
                    className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs font-mono text-gray-200 w-32 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => {
                    if (!readings || calStartEncoder === null || !calActualDist) return;
                    const measured = num(readings.encoder_distance_ft) - calStartEncoder;
                    const actual = parseFloat(calActualDist);
                    if (measured <= 0 || actual <= 0) return;
                    const currentDia = num(readings.wheel_diameter_mm) || 200;
                    setCalResult({ corrected: currentDia * (actual / measured), current: currentDia });
                  }}
                  disabled={!readings || calStartEncoder === null || !calActualDist}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-[10px] font-bold uppercase rounded-lg transition-colors"
                >
                  Calculate
                </button>
              </div>
              {calResult && (
                <div className="bg-green-950/20 border border-green-900/40 rounded-lg p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <KV label="Current Diameter" value={`${calResult.current.toFixed(2)} mm`} />
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] text-green-600 uppercase tracking-wide">Corrected Diameter</span>
                      <span className="font-mono font-bold text-sm text-green-400">{calResult.corrected.toFixed(2)} mm</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-2">
                    Update Viam config: <code className="bg-gray-900 px-1 py-0.5 rounded text-green-400">&quot;wheel_diameter_mm&quot;: {calResult.corrected.toFixed(2)}</code>
                  </p>
                </div>
              )}
            </div>
          </details>

          {/* ============================================================= */}
          {/* Shift Simulator                                                */}
          {/* ============================================================= */}
          <details className="border border-gray-800/50 rounded-xl">
            <summary className="p-3 cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-gray-600 hover:text-gray-400">
              Shift Simulator
              {shift.active && <span className="ml-2 text-green-500 normal-case animate-pulse">ACTIVE</span>}
            </summary>
            <div className="px-3 pb-3 space-y-3">
              <div className="flex gap-2">
                {!shift.active ? (
                  <button
                    onClick={() => setShift({ active: true, startTime: Date.now(), startReadings: readings, log: [] })}
                    disabled={!readings}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white text-[10px] font-bold uppercase rounded-lg transition-colors"
                  >
                    Start Shift
                  </button>
                ) : (
                  <button
                    onClick={() => setShift((p) => ({ ...p, active: false }))}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold uppercase rounded-lg transition-colors"
                  >
                    End Shift
                  </button>
                )}
              </div>
              {shiftStats && (
                <>
                  <div className="text-[10px] text-gray-600">
                    Started: {fmtTimestamp(shiftStats.startTime)} | Samples: {shift.log.length}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <ShiftStat label="Elapsed" value={fmtDuration(shiftStats.elapsed)} />
                    <ShiftStat label="Distance" value={`${shiftStats.distance.toFixed(1)} ft`} color="text-blue-400" />
                    <ShiftStat label="Plates" value={String(shiftStats.plates)} color="text-green-400" />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                    <KV label="Avg Speed" value={`${shiftStats.avgSpeed.toFixed(1)} ft/min`} />
                    <KV label="Max Speed" value={`${shiftStats.maxSpeed.toFixed(1)} ft/min`} />
                    <KV label="Rate" value={`${shiftStats.ratePerMin.toFixed(1)}/min`} />
                    <KV label="Miles" value={`${(shiftStats.distance / 5280).toFixed(3)}`} />
                  </div>
                </>
              )}
              {!shiftStats && !shift.active && (
                <p className="text-[10px] text-gray-600">Track live production metrics during a shift.</p>
              )}
            </div>
          </details>

          {/* ============================================================= */}
          {/* Simulator (Override Mode)                                      */}
          {/* ============================================================= */}
          <details className="border border-purple-800/30 rounded-xl">
            <summary className="p-3 cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-purple-500 hover:text-purple-400">
              Simulator
              {simEnabled && <span className="ml-2 text-green-400 normal-case">(ACTIVE)</span>}
            </summary>
            <div className="px-3 pb-3 space-y-3">
              <p className="text-[10px] text-gray-600">Override live PLC readings with simulated values for testing.</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleSimulator}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                    simEnabled ? "bg-red-700 hover:bg-red-600 text-white" : "bg-purple-700 hover:bg-purple-600 text-white"
                  }`}
                >
                  {simEnabled ? "Stop" : "Start"} Simulator
                </button>
                {simEnabled && (
                  <span className="text-[10px] text-green-400 font-mono">
                    {(simOverrides.encoder_distance_ft as number || 0).toFixed(1)} ft | {simOverrides.plate_drop_count as number || 0} plates
                  </span>
                )}
              </div>
              {simEnabled && (
                <>
                  <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold">Scenarios</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SIM_SCENARIOS.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => setSimOverrides((prev) => ({ ...prev, ...s.overrides }))}
                        className={`${s.color} hover:brightness-110 text-white text-[10px] px-2 py-1.5 rounded-lg transition-all`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                    {[
                      { key: "encoder_speed_ftpm", label: "Speed", type: "number" as const },
                      { key: "camera_detections_per_min", label: "Camera Rate", type: "number" as const },
                      { key: "eject_rate_per_min", label: "Eject Rate", type: "number" as const },
                      { key: "modbus_response_time_ms", label: "Modbus (ms)", type: "number" as const },
                    ].map(({ key, label, type }) => (
                      <div key={key}>
                        <label className="text-[10px] text-gray-600 block mb-0.5">{label}</label>
                        <input
                          type={type}
                          value={String(simOverrides[key] ?? "")}
                          onChange={(e) =>
                            setSimOverrides((prev) => ({
                              ...prev,
                              [key]: parseFloat(e.target.value) || 0,
                            }))
                          }
                          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-300 font-mono"
                        />
                      </div>
                    ))}
                    {[
                      { key: "tps_power_loop", label: "TPS Power" },
                      { key: "backup_alarm", label: "Backup" },
                      { key: "drop_enable", label: "Drop" },
                    ].map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={!!simOverrides[key]}
                          onChange={(e) => setSimOverrides((prev) => ({ ...prev, [key]: e.target.checked }))}
                          className="rounded"
                        />
                        <label className="text-[10px] text-gray-400">{label}</label>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </details>

          {/* ============================================================= */}
          {/* Remote Control                                                 */}
          {/* ============================================================= */}
          <details className="border border-blue-800/30 rounded-xl">
            <summary className="p-3 cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-blue-500 hover:text-blue-400">
              Remote Control (PLC do_command)
            </summary>
            <div className="px-3 pb-3 space-y-3">
              {/* TPS power status */}
              <div className={`p-2 rounded-lg text-[10px] ${
                readings?.tps_power_loop
                  ? "bg-green-950/30 border border-green-800/50 text-green-400"
                  : "bg-yellow-950/30 border border-yellow-800/50 text-yellow-400"
              }`}>
                {readings?.tps_power_loop ? "TPS Power ON" : "TPS Power OFF \u2014 eject commands require physical switch"}
              </div>

              {/* Command result */}
              {cmdResult && (
                <div className={`p-2 rounded-lg text-[10px] ${
                  cmdResult.status === "ok"
                    ? "bg-green-950/30 border border-green-800/50 text-green-300"
                    : "bg-red-950/30 border border-red-800/50 text-red-300"
                }`}>
                  {cmdResult.status === "ok" ? "\u2713" : "\u2715"} {cmdResult.message}
                </div>
              )}

              {/* Eject */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold mb-1">Eject Plate</p>
                <button
                  disabled={cmdLoading}
                  onClick={() => sendCommand({ action: "software_eject" })}
                  className="bg-red-800 hover:bg-red-700 disabled:bg-gray-800 text-white text-[10px] px-4 py-1.5 rounded-lg font-bold transition-colors"
                >
                  {cmdLoading ? "Sending\u2026" : "Eject"}
                </button>
              </div>

              {/* Modes */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold mb-1">Operating Mode</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { mode: "single", label: "TPS-1 Single" },
                    { mode: "double", label: "TPS-1 Double" },
                    { mode: "both", label: "TPS-2 Both" },
                    { mode: "left", label: "Left" },
                    { mode: "right", label: "Right" },
                    { mode: "tie_team", label: "Tie Team" },
                    { mode: "2nd_pass", label: "2nd Pass" },
                  ].map(({ mode, label }) => (
                    <button
                      key={mode}
                      disabled={cmdLoading}
                      onClick={() => sendCommand({ action: "set_mode", mode })}
                      className="bg-cyan-800 hover:bg-cyan-700 disabled:bg-gray-800 text-white text-[10px] px-2 py-1.5 rounded-lg transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Spacing */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold mb-1">
                  Tie Spacing (current: {readings?.ds2 ? `${Number(readings.ds2) * 0.5}"` : "\u2014"})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "18\"", value: 36 },
                    { label: "19\"", value: 38 },
                    { label: "19.5\"", value: 39 },
                    { label: "20\"", value: 40 },
                    { label: "21\"", value: 42 },
                  ].map(({ label, value }) => (
                    <button
                      key={value}
                      disabled={cmdLoading}
                      onClick={() => sendCommand({ action: "set_spacing", value })}
                      className={`text-[10px] px-2 py-1 rounded-lg font-bold transition-colors ${
                        readings?.ds2 === value
                          ? "bg-green-700 text-white"
                          : "bg-gray-700 hover:bg-gray-600 text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold mb-1">Toggles</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {[
                    { action: "toggle_drop_enable", label: "Drop Enable", key: "drop_enable", color: "bg-green-800" },
                    { action: "toggle_encoder", label: "Encoder", key: "encoder_enabled", color: "bg-blue-800" },
                    { action: "toggle_lay_ties", label: "Lay Ties", key: "lay_ties_set", color: "bg-cyan-800" },
                    { action: "toggle_drop_ties", label: "Drop Ties", key: "drop_ties", color: "bg-cyan-800" },
                  ].map(({ action, label, key, color }) => {
                    const isOn = readings?.[key] === true;
                    return (
                      <button
                        key={action}
                        disabled={cmdLoading}
                        onClick={() => sendCommand({ action })}
                        className={`text-[10px] px-2 py-1.5 rounded-lg font-bold transition-colors ${
                          isOn ? `${color} text-white` : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                        }`}
                      >
                        {label}: {isOn ? "ON" : "OFF"}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Utilities */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold mb-1">Utilities</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    disabled={cmdLoading}
                    onClick={() => sendCommand({ action: "reset_counters" })}
                    className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white text-[10px] px-3 py-1.5 rounded-lg font-bold transition-colors"
                  >
                    Reset Pi Counters
                  </button>
                  <button
                    disabled={cmdLoading}
                    onClick={() => sendCommand({ action: "clear_data_counts" })}
                    className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white text-[10px] px-3 py-1.5 rounded-lg font-bold transition-colors"
                  >
                    Clear PLC Counts
                  </button>
                </div>
              </div>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] text-gray-600 uppercase tracking-wide truncate">{label}</span>
      <span className={`text-xs sm:text-sm text-gray-300 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function ShiftStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center p-2 bg-gray-900/50 rounded-xl">
      <span className="text-[10px] text-gray-600 uppercase tracking-wide">{label}</span>
      <span className={`font-mono font-bold text-sm ${color || "text-gray-200"}`}>{value}</span>
    </div>
  );
}
