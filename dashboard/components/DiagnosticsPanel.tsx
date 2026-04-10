"use client";

import { useState } from "react";
import { SensorReadings } from "../lib/types";
import FullScreenModal from "./FullScreenModal";

interface Props {
  readings: SensorReadings | null;
}

// ---------------------------------------------------------------------------
// Sensor-side diagnostic (from diagnostics.py via plc_sensor.py)
// ---------------------------------------------------------------------------
interface SensorDiagnostic {
  rule: string;
  severity: "critical" | "warning" | "info";
  title: string;
  action: string;
  category?: string;
  evidence?: string;
}

/**
 * Parse the diagnostics field from readings.
 * Viam serializes Python dicts with single quotes, so the field may be
 * a JSON string, a Python repr string, or already an array.
 */
function parseSensorDiagnostics(raw: unknown): SensorDiagnostic[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as SensorDiagnostic[];
  if (typeof raw !== "string") return [];
  const s = raw.trim();
  if (!s || s === "[]") return [];
  try {
    // Try JSON first
    return JSON.parse(s);
  } catch {
    try {
      // Python repr uses single quotes — convert to JSON
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
// Client-side snapshot checks (fallback when sensor diagnostics unavailable)
// ---------------------------------------------------------------------------
interface DiagnosticCheck {
  id: string;
  label: string;
  severity: "ok" | "warn" | "error";
  message: string;
  action?: string;
}

function runSnapshotChecks(r: SensorReadings): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];

  if (r.connected !== true) {
    checks.push({
      id: "plc-offline",
      label: "PLC Connection",
      severity: "error",
      message: "No Modbus TCP response — PLC may be powered off or Ethernet disconnected.",
      action: "Check the Ethernet cable between the Pi and PLC. Verify PLC has power.",
    });
    return checks;
  }

  checks.push({
    id: "plc-online",
    label: "PLC Connection",
    severity: "ok",
    message: "Modbus TCP responding normally",
  });

  const tpsPower = r.tps_power_loop === true;
  if (!tpsPower) {
    checks.push({
      id: "tps-power-off",
      label: "TPS Power Loop",
      severity: "warn",
      message: "X4 (TPS Power Loop) is OFF — system is idle.",
      action: "Turn on the TPS main switch to begin plate dropping.",
    });
  } else {
    checks.push({
      id: "tps-power-on",
      label: "TPS Power Loop",
      severity: "ok",
      message: "TPS power loop active",
    });
  }

  // Spacing drift (uses sensor-computed fields)
  const lastSpacing = typeof r.last_drop_spacing_in === "number" ? r.last_drop_spacing_in : 0;
  const targetSpacing = 19.5;
  if (lastSpacing > 0) {
    const deviation = Math.abs(lastSpacing - targetSpacing) / targetSpacing;
    if (deviation > 0.2) {
      checks.push({
        id: "spacing-drift",
        label: "Plate Spacing",
        severity: "error",
        message: `Last drop spacing ${lastSpacing.toFixed(1)}" is ${(deviation * 100).toFixed(0)}% off target (${targetSpacing}").`,
        action: "Check track wheel contact with rail. Check for wheel debris. Verify DS2 setting.",
      });
    } else if (deviation > 0.1) {
      checks.push({
        id: "spacing-drift",
        label: "Plate Spacing",
        severity: "warn",
        message: `Last drop spacing ${lastSpacing.toFixed(1)}" is ${(deviation * 100).toFixed(0)}% off target — monitor for drift.`,
        action: "Watch the next few drops. If spacing keeps drifting, check the track wheel.",
      });
    }
  }

  // Drop overdue
  const distSince = typeof r.distance_since_last_drop_in === "number" ? r.distance_since_last_drop_in : 0;
  if (tpsPower && distSince > targetSpacing * 1.2) {
    checks.push({
      id: "drop-overdue",
      label: "Next Drop OVERDUE",
      severity: "error",
      message: `Traveled ${distSince.toFixed(1)}" since last drop — past ${targetSpacing}" target.`,
      action: "Check Drop Enable, operating mode, and air pressure. The plate dropper may have missed.",
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Severity mapping and icons
// ---------------------------------------------------------------------------
const SEVERITY_ICON: Record<string, string> = {
  ok: "\u2713",
  warn: "\u26A0",
  error: "\u2715",
  critical: "\u2715",
  warning: "\u26A0",
  info: "\u2139",
};

const SEVERITY_COLOR: Record<string, string> = {
  ok: "text-green-500",
  warn: "text-yellow-500",
  error: "text-red-500",
  critical: "text-red-500",
  warning: "text-yellow-500",
  info: "text-blue-400",
};

const SEVERITY_BG: Record<string, string> = {
  ok: "",
  warn: "bg-yellow-950/20",
  error: "bg-red-950/20",
  critical: "bg-red-950/30",
  warning: "bg-yellow-950/20",
  info: "bg-blue-950/20",
};

const SEVERITY_MODAL_COLOR: Record<string, string> = {
  ok: "text-green-400",
  warn: "text-yellow-400",
  error: "text-red-400",
  critical: "text-red-400",
  warning: "text-yellow-400",
  info: "text-blue-400",
};

const CATEGORY_LABEL: Record<string, string> = {
  camera: "Plate Flipper",
  encoder: "Encoder",
  eject: "Eject System",
  plc: "PLC Connection",
  operation: "Operation",
};

// Unified type for modal display
interface DiagnosticItem {
  key: string;
  severity: string;
  title: string;
  message?: string;
  action?: string;
  evidence?: string;
  category?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DiagnosticsPanel({ readings }: Props) {
  const [selectedDiag, setSelectedDiag] = useState<DiagnosticItem | null>(null);

  if (!readings) return null;

  // Prefer sensor-side diagnostics (from diagnostics.py), fall back to snapshot checks
  const sensorDiags = parseSensorDiagnostics(readings.diagnostics);
  const snapshotChecks = runSnapshotChecks(readings);

  // Merge: sensor diagnostics first (richer), then snapshot checks that don't overlap
  const sensorRules = new Set(sensorDiags.map((d) => d.rule));

  const hasIssues =
    sensorDiags.some((d) => d.severity === "critical" || d.severity === "warning") ||
    snapshotChecks.some((c) => c.severity === "error" || c.severity === "warn");

  const criticalCount =
    sensorDiags.filter((d) => d.severity === "critical").length +
    snapshotChecks.filter((c) => c.severity === "error" && !sensorRules.has(c.id)).length;
  const warningCount =
    sensorDiags.filter((d) => d.severity === "warning").length +
    snapshotChecks.filter((c) => c.severity === "warn" && !sensorRules.has(c.id)).length;

  // Rolling metrics summary
  const cameraRate = typeof readings.camera_detections_per_min === "number" ? readings.camera_detections_per_min : null;
  const ejectRate = typeof readings.eject_rate_per_min === "number" ? readings.eject_rate_per_min : null;
  const cameraTrend = typeof readings.camera_rate_trend === "string" ? readings.camera_rate_trend : null;
  const modbusTime = typeof readings.modbus_response_time_ms === "number" ? readings.modbus_response_time_ms : null;

  return (
    <>
      <div
        className={[
          "border rounded-2xl p-3 sm:p-6",
          hasIssues ? "border-yellow-900/40 bg-yellow-950/5" : "border-gray-800",
        ].join(" ")}
      >
        <h3
          className={[
            "text-xs font-bold uppercase tracking-widest mb-2 sm:mb-4",
            hasIssues ? "text-yellow-500" : "text-gray-500",
          ].join(" ")}
        >
          System Diagnostics
          {hasIssues && (
            <span className="ml-2 text-yellow-600 normal-case tracking-normal font-normal">
              — {criticalCount > 0 && `${criticalCount} critical`}
              {criticalCount > 0 && warningCount > 0 && ", "}
              {warningCount > 0 && `${warningCount} warning${warningCount > 1 ? "s" : ""}`}
            </span>
          )}
          {!hasIssues && (
            <span className="ml-2 text-green-600 normal-case tracking-normal font-normal">
              — all clear
            </span>
          )}
        </h3>

        {/* Rolling metrics strip */}
        {(cameraRate !== null || ejectRate !== null) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2 pb-2 sm:mb-3 sm:pb-3 border-b border-gray-800">
            {cameraRate !== null && (
              <span>
                Flipper: <span className={cameraRate > 0 ? "text-green-500" : "text-gray-600"}>{cameraRate.toFixed(1)}/min</span>
                {cameraTrend && cameraTrend !== "stable" && (
                  <span className={cameraTrend === "dead" ? "text-red-400 ml-1" : "text-yellow-500 ml-1"}>
                    ({cameraTrend})
                  </span>
                )}
              </span>
            )}
            {ejectRate !== null && (
              <span>
                Ejects: <span className={ejectRate > 0 ? "text-green-500" : "text-gray-600"}>{ejectRate.toFixed(1)}/min</span>
              </span>
            )}
            {modbusTime !== null && (
              <span>
                PLC latency: <span className={modbusTime < 5 ? "text-green-500" : "text-yellow-500"}>{modbusTime.toFixed(1)}ms</span>
              </span>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          {/* Sensor-side diagnostics — tappable rows */}
          {sensorDiags.map((diag, idx) => (
            <button
              key={`sensor-${diag.rule}-${idx}`}
              onClick={() =>
                setSelectedDiag({
                  key: `sensor-${diag.rule}-${idx}`,
                  severity: diag.severity,
                  title: diag.title,
                  action: diag.action,
                  evidence: diag.evidence,
                  category: diag.category,
                })
              }
              className={[
                "w-full text-left py-3 px-3 rounded-lg flex items-center gap-3 tap-target",
                SEVERITY_BG[diag.severity] || "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {/* Severity icon in circle */}
              <span
                className={[
                  "shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                  diag.severity === "critical" || diag.severity === "warning"
                    ? "bg-gray-800"
                    : "bg-gray-800/50",
                  SEVERITY_COLOR[diag.severity] || "text-gray-400",
                ].join(" ")}
              >
                {SEVERITY_ICON[diag.severity] || "?"}
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-bold text-gray-200 text-sm block truncate">
                  {diag.title}
                </span>
                {diag.category && (
                  <span className="text-xs uppercase tracking-wider text-gray-600">
                    {CATEGORY_LABEL[diag.category] || diag.category}
                  </span>
                )}
              </div>
              {/* Tap hint arrow */}
              <span className="text-gray-700 text-sm shrink-0">›</span>
            </button>
          ))}

          {/* Snapshot checks — tappable if they have actions */}
          {snapshotChecks
            .filter((c) => !sensorRules.has(c.id))
            .map((check) => (
              <button
                key={check.id}
                onClick={() =>
                  check.action && check.severity !== "ok"
                    ? setSelectedDiag({
                        key: check.id,
                        severity: check.severity,
                        title: check.label,
                        message: check.message,
                        action: check.action,
                      })
                    : undefined
                }
                className={[
                  "w-full text-left py-3 px-3 rounded-lg flex items-center gap-3",
                  check.action && check.severity !== "ok" ? "tap-target" : "",
                  SEVERITY_BG[check.severity] || "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span
                  className={[
                    "shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                    check.severity !== "ok" ? "bg-gray-800" : "bg-gray-800/50",
                    SEVERITY_COLOR[check.severity] || "text-gray-400",
                  ].join(" ")}
                >
                  {SEVERITY_ICON[check.severity]}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-gray-300 text-sm block truncate">
                    {check.label}
                  </span>
                  <span
                    className={[
                      "text-xs block truncate",
                      check.severity === "ok"
                        ? "text-gray-600"
                        : check.severity === "warn"
                        ? "text-yellow-600"
                        : "text-red-400",
                    ].join(" ")}
                  >
                    {check.message}
                  </span>
                </div>
                {check.action && check.severity !== "ok" && (
                  <span className="text-gray-700 text-sm shrink-0">›</span>
                )}
              </button>
            ))}
        </div>
      </div>

      {/* Full-screen diagnostic detail modal */}
      <FullScreenModal
        open={selectedDiag !== null}
        onClose={() => setSelectedDiag(null)}
        title={selectedDiag?.title || ""}
        titleColor={SEVERITY_MODAL_COLOR[selectedDiag?.severity || "info"]}
      >
        {selectedDiag && (
          <div className="space-y-4">
            {/* Large severity badge */}
            <div className="flex items-center gap-3">
              <span
                className={[
                  "w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold bg-gray-800",
                  SEVERITY_COLOR[selectedDiag.severity] || "text-gray-400",
                ].join(" ")}
              >
                {SEVERITY_ICON[selectedDiag.severity] || "?"}
              </span>
              <div>
                <span
                  className={[
                    "text-sm font-bold uppercase tracking-wide",
                    SEVERITY_MODAL_COLOR[selectedDiag.severity] || "text-gray-400",
                  ].join(" ")}
                >
                  {selectedDiag.severity === "critical" || selectedDiag.severity === "error"
                    ? "Critical Issue"
                    : selectedDiag.severity === "warning" || selectedDiag.severity === "warn"
                    ? "Warning"
                    : "Info"}
                </span>
                {selectedDiag.category && (
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {CATEGORY_LABEL[selectedDiag.category] || selectedDiag.category}
                  </span>
                )}
              </div>
            </div>

            {/* Description / message */}
            {selectedDiag.message && (
              <p className="text-base text-gray-300 leading-relaxed">
                {selectedDiag.message}
              </p>
            )}

            {/* What to do — the key content users need to read */}
            {selectedDiag.action && (
              <div className="bg-blue-950/20 border border-blue-500/30 rounded-xl p-4">
                <h3 className="text-sm font-bold text-blue-400 uppercase tracking-wide mb-2">
                  What To Do
                </h3>
                <p className="text-base text-gray-200 leading-relaxed">
                  {selectedDiag.action}
                </p>
              </div>
            )}

            {/* Evidence */}
            {selectedDiag.evidence && (
              <div className="bg-gray-900 rounded-lg p-3">
                <span className="text-xs text-gray-600 uppercase tracking-wide block mb-1">
                  Details
                </span>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {selectedDiag.evidence}
                </p>
              </div>
            )}
          </div>
        )}
      </FullScreenModal>
    </>
  );
}
