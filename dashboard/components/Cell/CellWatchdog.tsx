// CellWatchdog.tsx — Cross-system early warning panel. Correlates data from
// Staubli, Apera, PLC, and network to detect problems before they cause
// downtime. This is IronSight's core differentiator.
//
// Watchdog rules run client-side on every poll cycle. Each rule checks a
// condition, and if triggered, generates an alert with severity, category,
// and plain-English explanation of what's happening and what to do.
"use client";

import { useMemo } from "react";
import type { StaubliReadings, AperaReadings, NetworkDevice, CellAlert, AlertSeverity, AlertCategory } from "./CellTypes";
import { alertColor, TEMP_THRESHOLDS } from "./CellTypes";

// ---------------------------------------------------------------------------
// Watchdog Rules
// ---------------------------------------------------------------------------

interface WatchdogInput {
  staubli: StaubliReadings | null;
  apera: AperaReadings | null;
  network: NetworkDevice[];
}

function runWatchdog(input: WatchdogInput): CellAlert[] {
  const alerts: CellAlert[] = [];
  const now = new Date().toISOString();
  let id = 0;

  function alert(severity: AlertSeverity, category: AlertCategory, title: string, detail: string, source: string) {
    alerts.push({ id: `wd-${++id}`, severity, category, title, detail, source, timestamp: now, acknowledged: false });
  }

  const { staubli: s, apera: a, network: n } = input;

  // ---- SAFETY ----
  if (s) {
    if (s.stop1_active) alert("critical", "safety", "E-Stop 1 Active", "Emergency stop category 1 is engaged. Robot arm is locked. Check the E-stop button on the cell.", "Staubli");
    if (s.stop2_active) alert("critical", "safety", "E-Stop 2 Active", "Emergency stop category 2 is engaged. Robot arm is locked.", "Staubli");
    if (s.door_open) alert("warning", "safety", "Guard Door Open", "Cell guard door interlock is open. Robot cannot move until the door is closed and reset.", "Staubli");
  }

  // ---- THERMAL ----
  if (s) {
    const temps = [
      { name: "J1", val: s.temp_j1 }, { name: "J2", val: s.temp_j2 }, { name: "J3", val: s.temp_j3 },
      { name: "J4", val: s.temp_j4 }, { name: "J5", val: s.temp_j5 }, { name: "J6", val: s.temp_j6 },
    ];
    for (const t of temps) {
      if (t.val >= TEMP_THRESHOLDS.motor_crit) {
        alert("critical", "thermal", `Motor ${t.name} Overheating`, `${t.name} motor at ${t.val.toFixed(0)}°C — above ${TEMP_THRESHOLDS.motor_crit}°C critical limit. Risk of thermal shutdown. Reduce cycle speed or check cabinet ventilation.`, "Staubli");
      } else if (t.val >= TEMP_THRESHOLDS.motor_warn) {
        alert("warning", "thermal", `Motor ${t.name} Running Hot`, `${t.name} motor at ${t.val.toFixed(0)}°C — approaching thermal limit. Monitor trend. May need to slow down or improve cooling.`, "Staubli");
      }
    }
    if (s.temp_dsi >= TEMP_THRESHOLDS.dsi_crit) {
      alert("critical", "thermal", "DSI Drive Module Overheating", `Drive module at ${s.temp_dsi.toFixed(0)}°C — this is the same component that caused the URPS thermal shutdowns. Immediate attention needed.`, "Staubli");
    } else if (s.temp_dsi >= TEMP_THRESHOLDS.dsi_warn) {
      alert("warning", "thermal", "DSI Drive Module Warm", `Drive module at ${s.temp_dsi.toFixed(0)}°C — trending toward the thermal protection threshold. Check cabinet fans.`, "Staubli");
    }
  }

  if (a) {
    if (a.gpu_temp_c >= TEMP_THRESHOLDS.gpu_crit) {
      alert("critical", "thermal", "Vision GPU Overheating", `GPU at ${a.gpu_temp_c.toFixed(0)}°C. Vision processing will throttle or fail. Check Apera PC ventilation.`, "Apera");
    } else if (a.gpu_temp_c >= TEMP_THRESHOLDS.gpu_warn) {
      alert("warning", "thermal", "Vision GPU Running Hot", `GPU at ${a.gpu_temp_c.toFixed(0)}°C. May affect detection speed.`, "Apera");
    }
  }

  // ---- POWER ----
  if (s && s.urps_errors_24h > 0) {
    alert(s.urps_errors_24h >= 3 ? "critical" : "warning", "power",
      `${s.urps_errors_24h} Power Supply Errors in 24h`,
      `URPS thermal protection has triggered ${s.urps_errors_24h} time(s) in the last 24 hours. Each event causes an uncontrolled arm stop. Cabinet cooling needs inspection.`,
      "Staubli"
    );
  }
  if (s && s.ethercat_errors_24h > 0) {
    alert(s.ethercat_errors_24h >= 5 ? "critical" : "warning", "communication",
      `${s.ethercat_errors_24h} EtherCAT Errors in 24h`,
      `Fieldbus frame loss detected on J206. Often correlated with URPS thermal events — the power supply overheats, degrades the bus, and eventually causes a shutdown.`,
      "Staubli"
    );
  }

  // ---- CROSS-SYSTEM: Thermal → Bus → Power chain ----
  if (s && s.urps_errors_24h > 0 && s.ethercat_errors_24h > 0) {
    alert("critical", "power",
      "Thermal Shutdown Chain Detected",
      "URPS thermal errors AND EtherCAT frame loss detected together. This is the failure chain: cabinet overheats → bus degrades → power cuts out. Fix the root cause: cabinet cooling.",
      "IronSight"
    );
  }

  // ---- VISION ----
  if (a) {
    if (a.pipeline_state === "error") {
      alert("critical", "vision", "Vision Pipeline Error", "Apera Vue pipeline is in error state. Try restarting via the RESTART VUE button or socket command to port 14050.", "Apera");
    }
    if (!a.camera_1_ok || !a.camera_2_ok) {
      const which = !a.camera_1_ok && !a.camera_2_ok ? "Both cameras" : !a.camera_1_ok ? "Camera 1" : "Camera 2";
      alert("critical", "vision", `${which} Not Responding`, "Stereo vision requires both cameras. Check PoE connections and camera power.", "Apera");
    }
    if (a.gpu_memory_used_pct > 95) {
      alert("warning", "vision", "GPU Memory Nearly Full", `${a.gpu_memory_used_pct.toFixed(0)}% GPU memory used. ML inference may fail. A vision system restart may be needed.`, "Apera");
    }
    if (a.detection_confidence_avg > 0 && a.detection_confidence_avg < 0.4) {
      alert("warning", "vision", "Low Detection Confidence", `Average detection confidence is ${(a.detection_confidence_avg * 100).toFixed(0)}%. Parts may be getting misclassified. Check lighting, camera cleanliness, and calibration.`, "Apera");
    }
  }

  // ---- CALIBRATION ----
  if (a) {
    if (a.calibration_status === "drift") {
      alert("warning", "calibration", "Calibration Drift Detected", `Vision-robot calibration is drifting (${a.cal_residual_mm.toFixed(1)} mm residual). Pick accuracy is degrading. Schedule a recalibration.`, "Apera");
    }
    if (a.calibration_status === "failed") {
      alert("critical", "calibration", "Calibration Failed", "Hand-eye calibration check failed. Picks will be inaccurate. Do not run production until recalibrated.", "Apera");
    }
  }

  // ---- CROSS-SYSTEM: Vision timeout at wrong position ----
  if (s && a && a.pipeline_state === "error" && !s.at_capture) {
    alert("critical", "vision",
      "Vision Error — Robot Not at Capture Position",
      "Vision pipeline failed AND robot is not at the capture position. The robot may have moved during a capture, or the pipeline was triggered from the wrong position.",
      "IronSight"
    );
  }

  // ---- PRODUCTION ----
  if (s && s.part_picked && s.part_desired && s.part_picked !== s.part_desired) {
    alert("warning", "production",
      "Part Mismatch — Picked vs Desired",
      `Robot picked "${s.part_picked}" but target was "${s.part_desired}". Part may be missorted. Check vision detection and bin assignments.`,
      "IronSight"
    );
  }

  // ---- NETWORK ----
  for (const dev of n) {
    if (!dev.reachable) {
      alert(
        dev.name.includes("Staubli") || dev.name.includes("Apera") ? "critical" : "warning",
        "network",
        `${dev.name} Unreachable`,
        `No response from ${dev.name} (${dev.ip}). Last seen: ${dev.last_seen}. Check network cable and switch connections.`,
        "Network"
      );
    }
  }

  // ---- COMMUNICATION ----
  if (s && !s.connected) {
    alert("critical", "communication", "Robot Controller Disconnected", "Cannot reach Staubli REST API. Check network connection to 192.168.0.254.", "Staubli");
  }
  if (a && !a.connected) {
    alert("critical", "communication", "Vision System Disconnected", "Cannot reach Apera socket on port 14040. Check network connection to 192.168.3.151.", "Apera");
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface Props {
  staubli: StaubliReadings | null;
  apera: AperaReadings | null;
  network: NetworkDevice[];
}

export default function CellWatchdog({ staubli, apera, network }: Props) {
  const alerts = useMemo(
    () => runWatchdog({ staubli, apera, network }),
    [staubli, apera, network]
  );

  const criticals = alerts.filter((a) => a.severity === "critical");
  const warnings = alerts.filter((a) => a.severity === "warning");
  const infos = alerts.filter((a) => a.severity === "info");

  const overallStatus = criticals.length > 0 ? "critical" : warnings.length > 0 ? "warning" : "healthy";
  const statusColors = {
    critical: "bg-red-500",
    warning: "bg-orange-500",
    healthy: "bg-emerald-500",
  };
  const statusLabels = {
    critical: `${criticals.length} Critical`,
    warning: `${warnings.length} Warning${warnings.length !== 1 ? "s" : ""}`,
    healthy: "All Systems OK",
  };

  return (
    <section className="border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header with overall status */}
      <div className="p-4 sm:p-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusColors[overallStatus]} ${overallStatus === "critical" ? "animate-pulse" : ""}`} />
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
            Cell Watchdog
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {criticals.length > 0 && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950/50 text-red-400 border border-red-900/50">
              {criticals.length} CRITICAL
            </span>
          )}
          {warnings.length > 0 && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-950/50 text-orange-400 border border-orange-900/50">
              {warnings.length} WARN
            </span>
          )}
          {alerts.length === 0 && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/50 text-emerald-400 border border-emerald-800/50">
              ALL CLEAR
            </span>
          )}
        </div>
      </div>

      {/* Alert list */}
      {alerts.length > 0 && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-2">
          {[...criticals, ...warnings, ...infos].map((alert) => (
            <div key={alert.id} className={`p-3 rounded-lg border ${alertColor(alert.severity)}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] uppercase tracking-wider font-bold opacity-70">{alert.category}</span>
                    <span className="text-[10px] text-gray-600">{alert.source}</span>
                  </div>
                  <h4 className="text-sm font-semibold">{alert.title}</h4>
                  <p className="text-xs opacity-80 mt-1 leading-relaxed">{alert.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Healthy state */}
      {alerts.length === 0 && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6">
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-lg text-center">
            <p className="text-sm text-emerald-400 font-medium">All systems operating normally</p>
            <p className="text-xs text-gray-600 mt-1">
              Monitoring {staubli ? "robot" : ""}{staubli && apera ? " + " : ""}{apera ? "vision" : ""}{network.length > 0 ? ` + ${network.length} devices` : ""}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
