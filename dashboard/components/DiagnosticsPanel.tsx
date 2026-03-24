import { SensorReadings } from "../lib/types";

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

const CATEGORY_LABEL: Record<string, string> = {
  camera: "Plate Flipper",
  encoder: "Encoder",
  eject: "Eject System",
  plc: "PLC Connection",
  operation: "Operation",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DiagnosticsPanel({ readings }: Props) {
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
    <div
      className={[
        "border rounded-2xl p-4 sm:p-6",
        hasIssues ? "border-yellow-900/40 bg-yellow-950/5" : "border-gray-800",
      ].join(" ")}
    >
      <h3
        className={[
          "text-xs font-bold uppercase tracking-widest mb-3 sm:mb-4",
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
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-3 pb-3 border-b border-gray-800">
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

      <div className="space-y-2">
        {/* Sensor-side diagnostics (with operator actions) */}
        {sensorDiags.map((diag, idx) => (
          <div
            key={`sensor-${diag.rule}-${idx}`}
            className={[
              "py-2 px-3 rounded-lg",
              SEVERITY_BG[diag.severity] || "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="flex items-start gap-2">
              <span
                className={[
                  "shrink-0 font-bold text-xs mt-0.5 w-4 text-center",
                  SEVERITY_COLOR[diag.severity] || "text-gray-400",
                ].join(" ")}
              >
                {SEVERITY_ICON[diag.severity] || "?"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-gray-200 text-sm">{diag.title}</span>
                  {diag.category && (
                    <span className="text-[10px] uppercase tracking-wider text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                      {CATEGORY_LABEL[diag.category] || diag.category}
                    </span>
                  )}
                </div>
                {diag.action && (
                  <div className="mt-1.5 text-xs text-gray-400 leading-relaxed bg-gray-900/50 rounded px-2 py-1.5 border-l-2 border-blue-500/40">
                    <span className="font-semibold text-blue-400 text-[10px] uppercase tracking-wider">What to do: </span>
                    {diag.action}
                  </div>
                )}
                {diag.evidence && (
                  <div className="mt-1 text-[11px] text-gray-600 italic">{diag.evidence}</div>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Snapshot checks (system-level, always shown) */}
        {snapshotChecks
          .filter((c) => !sensorRules.has(c.id))
          .map((check) => (
            <div
              key={check.id}
              className={[
                "flex items-start gap-2 py-1.5 px-2 rounded-lg text-sm",
                SEVERITY_BG[check.severity] || "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span
                className={[
                  "shrink-0 font-bold text-xs mt-0.5 w-4 text-center",
                  SEVERITY_COLOR[check.severity] || "text-gray-400",
                ].join(" ")}
              >
                {SEVERITY_ICON[check.severity]}
              </span>
              <div className="min-w-0">
                <span className="font-bold text-gray-300 text-xs sm:text-sm">
                  {check.label}
                </span>
                <span className="text-gray-500 mx-1.5">&mdash;</span>
                <span
                  className={[
                    "text-xs sm:text-sm",
                    check.severity === "ok"
                      ? "text-gray-600"
                      : check.severity === "warn"
                      ? "text-yellow-600"
                      : "text-red-400",
                  ].join(" ")}
                >
                  {check.message}
                </span>
                {check.action && check.severity !== "ok" && (
                  <div className="mt-1 text-xs text-gray-400 bg-gray-900/50 rounded px-2 py-1 border-l-2 border-blue-500/40">
                    <span className="font-semibold text-blue-400 text-[10px] uppercase tracking-wider">What to do: </span>
                    {check.action}
                  </div>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
