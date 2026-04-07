// AperaPanel.tsx — Vision system health, pipeline status, detection results,
// and calibration monitoring from the Apera Vue AI vision system.
// Data source: Pi 5 connects to Apera socket :14040, pushes to Viam.
"use client";

import { useState } from "react";
import type { AperaReadings } from "./CellTypes";
import { TEMP_THRESHOLDS, tempColor } from "./CellTypes";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KV({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] text-gray-600 uppercase tracking-wide truncate">{label}</span>
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

  const isConnected = readings?.connected ?? false;
  const r = readings;

  // Sort detections by count descending
  const sortedDetections = r?.detections_by_class
    ? Object.entries(r.detections_by_class).sort(([, a], [, b]) => b - a)
    : [];

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
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
                  Pipeline
                </h3>
                <div className="flex items-center gap-3 mb-3">
                  <PipelineStateBadge state={r.pipeline_state} />
                  <span className="text-xs text-gray-500">{r.pipeline_name}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                  <KV label="Cycle Time" value={r.last_cycle_ms > 0 ? `${r.last_cycle_ms} ms` : "\u2014"} mono />
                  <KV label="Socket Latency" value={`${r.socket_latency_ms.toFixed(0)} ms`} mono />
                  <KV label="Pick Pose" value={r.pick_pose_available ? "Available" : "None"} color={r.pick_pose_available ? "text-emerald-400" : "text-gray-500"} />
                  <KV label="Trajectory" value={r.trajectory_available ? "Ready" : "None"} color={r.trajectory_available ? "text-emerald-400" : "text-gray-500"} />
                </div>
              </div>

              {/* ---- Detection Results ---- */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
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
                  <div className="grid grid-cols-5 gap-2">
                    {sortedDetections.map(([cls, count]) => (
                      <div key={cls} className="bg-gray-900/50 border border-gray-800/50 rounded-lg p-2 text-center">
                        <div className="text-[10px] text-gray-500 truncate">{cls.replace(/_/g, " ")}</div>
                        <div className="font-mono font-bold text-sm text-gray-200">{count}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ---- Calibration ---- */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
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

              {/* ---- Hardware ---- */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
                  Hardware
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                  <KV label="Camera 1" value={r.camera_1_ok ? "OK" : "ERROR"} color={r.camera_1_ok ? "text-emerald-400" : "text-red-400"} />
                  <KV label="Camera 2" value={r.camera_2_ok ? "OK" : "ERROR"} color={r.camera_2_ok ? "text-emerald-400" : "text-red-400"} />
                  <KV
                    label="GPU Temp"
                    value={`${r.gpu_temp_c.toFixed(0)}°C`}
                    color={tempColor(r.gpu_temp_c, TEMP_THRESHOLDS.gpu_warn, TEMP_THRESHOLDS.gpu_crit)}
                    mono
                  />
                  <KV
                    label="GPU Memory"
                    value={`${r.gpu_memory_used_pct.toFixed(0)}%`}
                    color={r.gpu_memory_used_pct > 90 ? "text-red-400" : r.gpu_memory_used_pct > 75 ? "text-orange-400" : "text-gray-300"}
                    mono
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
