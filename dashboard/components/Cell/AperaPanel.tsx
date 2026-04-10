// AperaPanel.tsx — Vision system health, pipeline status, detection results,
// calibration monitoring, and remote management for the Apera Vue AI vision system.
// Data source: Pi 5 connects to Apera socket :14040, management via :44333/:44334.
"use client";

import { useState } from "react";
import type { AperaReadings } from "./CellTypes";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KV({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-xs text-gray-600 uppercase tracking-wide truncate">{label}</span>
      <span className={`text-xs sm:text-sm truncate ${mono ? "font-mono" : ""} ${color || "text-gray-300"}`}>{value}</span>
    </div>
  );
}

function PipelineStateBadge({ state }: { state: AperaReadings["pipeline_state"] }) {
  const styles: Record<string, string> = {
    idle: "bg-gray-800/50 text-gray-500 border-gray-700/50",
    capturing: "bg-blue-950/40 text-blue-400 border-blue-800/50",
    detecting: "bg-purple-950/40 text-purple-400 border-purple-800/50",
    planning: "bg-cyan-950/40 text-cyan-400 border-cyan-800/50",
    error: "bg-red-950/40 text-red-400 border-red-800/50",
  };
  return (
    <span className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border ${styles[state] || styles.idle}`}>
      {state}
    </span>
  );
}

function SystemStatusBadge({ status }: { status: AperaReadings["system_status"] }) {
  const styles: Record<string, string> = {
    alive: "bg-emerald-950/40 text-emerald-400 border-emerald-800/50",
    busy: "bg-blue-950/40 text-blue-400 border-blue-800/50",
    down: "bg-red-950/40 text-red-400 border-red-800/50",
    unreachable: "bg-gray-800/50 text-gray-500 border-gray-700/50",
    unknown: "bg-gray-800/50 text-gray-500 border-gray-700/50",
  };
  return (
    <span className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border ${styles[status] || styles.unknown}`}>
      {status}
    </span>
  );
}

function CalibrationBadge({ status }: { status: AperaReadings["calibration_status"] }) {
  const styles: Record<string, string> = {
    ok: "bg-emerald-950/40 text-emerald-400 border-emerald-800/50",
    drift: "bg-orange-950/40 text-orange-400 border-orange-800/50",
    failed: "bg-red-950/40 text-red-400 border-red-800/50",
    unchecked: "bg-gray-800/50 text-gray-500 border-gray-700/50",
  };
  return (
    <span className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border ${styles[status] || styles.unchecked}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface Props {
  readings: AperaReadings | null;
  pollError?: string | null;
}

export default function AperaPanel({ readings, pollError }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);

  const isConnected = readings?.connected ?? false;
  const r = readings;

  // Sort detections by count descending
  const sortedDetections = r?.detections_by_class
    ? Object.entries(r.detections_by_class).sort(([, a], [, b]) => b - a)
    : [];

  const sendCommand = async (command: string) => {
    setActionPending(command);
    setActionResult(null);
    try {
      const resp = await fetch("/api/cell-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const data = await resp.json();
      if (data.error) {
        setActionResult(`Error: ${data.message || data.error}`);
      } else {
        setActionResult(data.message || "OK");
      }
    } catch (err) {
      setActionResult(`Failed: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setActionPending(null);
      setTimeout(() => setActionResult(null), 5000);
    }
  };

  return (
    <section className="border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left hover:bg-gray-900/30 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            isConnected && !pollError ? "bg-green-500" : pollError ? "bg-red-500" : "bg-gray-600"
          }`} />
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
            Apera Vue &mdash; AI Vision System
          </h2>
        </div>
        <span className="text-gray-600 text-xs shrink-0">{expanded ? "\u25B2" : "\u25BC"}</span>
      </button>

      {expanded && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-5">
          {pollError && (
            <div className="p-3 bg-red-950/30 border border-red-900/50 rounded-lg text-xs text-red-400">
              {pollError}
            </div>
          )}

          {!r ? (
            <p className="text-xs text-gray-700 animate-pulse">Waiting for vision system connection&hellip;</p>
          ) : (
            <>
              {/* ---- Pipeline Status ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
                  Pipeline
                </h3>
                <div className="flex items-center gap-3 mb-3">
                  <PipelineStateBadge state={r.pipeline_state} />
                  <span className="text-xs text-gray-500">{r.pipeline_name}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                  <KV label="Cycle Time" value={r.last_cycle_ms > 0 ? `${r.last_cycle_ms.toFixed(0)} ms` : "\u2014"} mono />
                  <KV label="Socket Latency" value={`${r.socket_latency_ms.toFixed(0)} ms`} mono />
                  <KV label="Pick Pose" value={r.pick_pose_available ? "Available" : "None"} color={r.pick_pose_available ? "text-emerald-400" : "text-gray-500"} />
                  <KV label="Trajectory" value={r.trajectory_available ? "Ready" : "None"} color={r.trajectory_available ? "text-emerald-400" : "text-gray-500"} />
                </div>
              </div>

              {/* ---- Detection Results ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
                  Detections
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 mb-3">
                  <KV label="Total Found" value={String(r.total_detections)} mono />
                  <KV
                    label="Avg Confidence"
                    value={r.detection_confidence_avg > 0 ? `${(r.detection_confidence_avg * 100).toFixed(0)}%` : "\u2014"}
                    color={r.detection_confidence_avg < 0.5 ? "text-orange-400" : "text-emerald-400"}
                    mono
                  />
                </div>

                {sortedDetections.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {sortedDetections.map(([cls, count]) => (
                      <div key={cls} className="bg-gray-900/50 border border-gray-800/50 rounded-lg p-2 text-center">
                        <div className="text-xs text-gray-500 truncate">{cls.replace(/_/g, " ")}</div>
                        <div className="font-mono font-bold text-sm text-gray-200">{count}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ---- Calibration ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
                  Calibration
                </h3>
                <div className="flex items-center gap-3 mb-2">
                  <CalibrationBadge status={r.calibration_status} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                  <KV label="Residual" value={r.cal_residual_mm > 0 ? `${r.cal_residual_mm.toFixed(2)} mm` : "\u2014"} mono />
                  <KV label="Last Check" value={r.last_cal_check || "Never"} />
                </div>
              </div>

              {/* ---- System Health & Controls ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
                  System Health
                </h3>
                <div className="flex items-center gap-3 mb-3">
                  <SystemStatusBadge status={r.system_status} />
                  <KV
                    label="App Manager"
                    value={r.app_manager_ok ? "Online" : "Offline"}
                    color={r.app_manager_ok ? "text-emerald-400" : "text-gray-500"}
                  />
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    onClick={() => sendCommand("apera_reconnect")}
                    disabled={!!actionPending}
                    className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg border border-blue-800/50 bg-blue-950/30 text-blue-400 hover:bg-blue-900/40 disabled:opacity-50 transition-colors"
                  >
                    {actionPending === "apera_reconnect" ? "Reconnecting\u2026" : "Reconnect Socket"}
                  </button>
                  <button
                    onClick={() => sendCommand("apera_health")}
                    disabled={!!actionPending}
                    className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg border border-cyan-800/50 bg-cyan-950/30 text-cyan-400 hover:bg-cyan-900/40 disabled:opacity-50 transition-colors"
                  >
                    {actionPending === "apera_health" ? "Checking\u2026" : "Health Check"}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Restart the Apera Vue vision system? This will briefly interrupt detections.")) {
                        sendCommand("apera_restart");
                      }
                    }}
                    disabled={!!actionPending}
                    className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg border border-orange-800/50 bg-orange-950/30 text-orange-400 hover:bg-orange-900/40 disabled:opacity-50 transition-colors"
                  >
                    {actionPending === "apera_restart" ? "Restarting\u2026" : "Restart Apera"}
                  </button>
                </div>

                {/* Action result feedback */}
                {actionResult && (
                  <div className={`mt-2 p-2 rounded-lg text-xs ${
                    actionResult.startsWith("Error") || actionResult.startsWith("Failed")
                      ? "bg-red-950/30 border border-red-900/50 text-red-400"
                      : "bg-emerald-950/30 border border-emerald-900/50 text-emerald-400"
                  }`}>
                    {actionResult}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
