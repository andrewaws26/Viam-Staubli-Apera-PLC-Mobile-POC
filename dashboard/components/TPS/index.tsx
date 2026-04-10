// index.tsx — Main TPS panel orchestrator. Manages polling, state, and
// composes sub-components for registers, diagnostics, simulator, and controls.
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import TPSRegisterTable from "./TPSRegisterTable";
import TPSDiagnosticsPanel from "./TPSDiagnosticsPanel";
import TPSSimulator from "./TPSSimulator";
import TPSRemoteControl from "./TPSRemoteControl";
import {
  POLL_MS,
  num,
  bool,
  fmtVal,
  fmtDuration,
  fmtTimestamp,
  parseDiagnostics,
} from "./TPSFields";
import type { SensorReadings, ShiftState, ShiftStats } from "./TPSFields";

// ---------------------------------------------------------------------------
// Sub-components (small, kept inline)
// ---------------------------------------------------------------------------

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-xs text-gray-500 uppercase tracking-wide truncate">{label}</span>
      <span className={`text-xs sm:text-sm text-gray-300 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function ShiftStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center p-2 bg-gray-900/50 rounded-xl">
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`font-mono font-bold text-sm ${color || "text-gray-200"}`}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
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

  const shiftStats: ShiftStats | null = (() => {
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
        className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left hover:bg-gray-800/50 transition-colors"
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
            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-400 uppercase font-bold tracking-wider">
              SIM
            </span>
          )}
        </div>
        <span className="text-gray-500 text-xs shrink-0">
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

          {/* PLC Connection */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
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

          {/* Live Readings */}
          {!readings ? (
            <p className="text-xs text-gray-700 animate-pulse">Waiting for first reading&hellip;</p>
          ) : (
            <TPSRegisterTable
              readings={readings}
              lastChangeMap={lastChangeRef.current}
              pollMs={POLL_MS}
            />
          )}

          {/* Active Diagnostics */}
          <TPSDiagnosticsPanel diagnostics={diagnostics} />

          {/* Raw JSON */}
          <div>
            <button
              onClick={() => setShowRaw((r) => !r)}
              className="text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-400 transition-colors"
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
                  className="absolute top-2 right-2 px-2 py-1 bg-gray-800 hover:bg-gray-800/50 text-gray-400 text-xs rounded transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <pre className="bg-gray-900/50 border border-gray-800 rounded-lg p-3 text-xs sm:text-xs text-gray-400 font-mono overflow-x-auto max-h-96 overflow-y-auto">
                  {JSON.stringify(readings, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Encoder Calibration */}
          <details className="border border-gray-800/50 rounded-xl">
            <summary className="p-3 cursor-pointer select-none text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-400">
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
                <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
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
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-bold uppercase rounded-lg transition-colors"
                >
                  Mark Start
                </button>
                {calStartEncoder !== null && (
                  <span className="text-xs text-gray-500">
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
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Actual Distance (ft)</label>
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
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-bold uppercase rounded-lg transition-colors"
                >
                  Calculate
                </button>
              </div>
              {calResult && (
                <div className="bg-green-950/20 border border-green-900/40 rounded-lg p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <KV label="Current Diameter" value={`${calResult.current.toFixed(2)} mm`} />
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs text-green-600 uppercase tracking-wide">Corrected Diameter</span>
                      <span className="font-mono font-bold text-sm text-green-400">{calResult.corrected.toFixed(2)} mm</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Update Viam config: <code className="bg-gray-900 px-1 py-0.5 rounded text-green-400">&quot;wheel_diameter_mm&quot;: {calResult.corrected.toFixed(2)}</code>
                  </p>
                </div>
              )}
            </div>
          </details>

          {/* Shift Simulator */}
          <details className="border border-gray-800/50 rounded-xl">
            <summary className="p-3 cursor-pointer select-none text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-400">
              Shift Simulator
              {shift.active && <span className="ml-2 text-green-500 normal-case animate-pulse">ACTIVE</span>}
            </summary>
            <div className="px-3 pb-3 space-y-3">
              <div className="flex gap-2">
                {!shift.active ? (
                  <button
                    onClick={() => setShift({ active: true, startTime: Date.now(), startReadings: readings, log: [] })}
                    disabled={!readings}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white text-xs font-bold uppercase rounded-lg transition-colors"
                  >
                    Start Shift
                  </button>
                ) : (
                  <button
                    onClick={() => setShift((p) => ({ ...p, active: false }))}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold uppercase rounded-lg transition-colors"
                  >
                    End Shift
                  </button>
                )}
              </div>
              {shiftStats && (
                <>
                  <div className="text-xs text-gray-500">
                    Started: {fmtTimestamp(shiftStats.startTime)} | Samples: {shift.log.length}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <ShiftStat label="Elapsed" value={fmtDuration(shiftStats.elapsed)} />
                    <ShiftStat label="Distance" value={`${shiftStats.distance.toFixed(1)} ft`} color="text-blue-400" />
                    <ShiftStat label="Plates" value={String(shiftStats.plates)} color="text-green-400" />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <KV label="Avg Speed" value={`${shiftStats.avgSpeed.toFixed(1)} ft/min`} />
                    <KV label="Max Speed" value={`${shiftStats.maxSpeed.toFixed(1)} ft/min`} />
                    <KV label="Rate" value={`${shiftStats.ratePerMin.toFixed(1)}/min`} />
                    <KV label="Miles" value={`${(shiftStats.distance / 5280).toFixed(3)}`} />
                  </div>
                </>
              )}
              {!shiftStats && !shift.active && (
                <p className="text-xs text-gray-500">Track live production metrics during a shift.</p>
              )}
            </div>
          </details>

          {/* Simulator (Override Mode) */}
          <TPSSimulator
            simEnabled={simEnabled}
            simOverrides={simOverrides}
            onToggle={toggleSimulator}
            onApplyOverrides={(overrides) => setSimOverrides((prev) => ({ ...prev, ...overrides }))}
          />

          {/* Remote Control (PLC do_command) */}
          <TPSRemoteControl readings={readings} />
        </div>
      )}
    </section>
  );
}
