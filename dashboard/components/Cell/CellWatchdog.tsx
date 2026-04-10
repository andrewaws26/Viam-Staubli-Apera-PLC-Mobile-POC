// CellWatchdog.tsx — Cross-system early warning panel. Correlates data from
// Staubli, Apera, PLC, and network to detect problems before they cause
// downtime. This is IronSight's core differentiator.
//
// Watchdog rules run client-side on every poll cycle. Each rule checks a
// condition, and if triggered, generates an alert with severity, category,
// and plain-English explanation of what's happening and what to do.
"use client";

import { useMemo } from "react";
import type { StaubliReadings, AperaReadings, NetworkDevice, InternetHealth, SwitchVpnHealth, PiHealth, CellAlert, AlertSeverity, AlertCategory } from "./CellTypes";
import { alertColor, TEMP_THRESHOLDS } from "./CellTypes";

// ---------------------------------------------------------------------------
// Watchdog Rules
// ---------------------------------------------------------------------------

interface WatchdogInput {
  staubli: StaubliReadings | null;
  apera: AperaReadings | null;
  network: NetworkDevice[];
  internet: InternetHealth | null;
  switchVpn: SwitchVpnHealth | null;
  piHealth: PiHealth | null;
}

function runWatchdog(input: WatchdogInput): CellAlert[] {
  const alerts: CellAlert[] = [];
  const now = new Date().toISOString();
  let id = 0;

  function alert(severity: AlertSeverity, category: AlertCategory, title: string, detail: string, source: string) {
    alerts.push({ id: `wd-${++id}`, severity, category, title, detail, source, timestamp: now, acknowledged: false });
  }

  const { staubli: s, apera: a, network: n, internet: inet, switchVpn: sw, piHealth: pi } = input;
  const cToF = (c: number) => (c * 9 / 5 + 32).toFixed(0);

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
        alert("critical", "thermal", `Motor ${t.name} Overheating`, `${t.name} motor at ${cToF(t.val)}°F — above ${cToF(TEMP_THRESHOLDS.motor_crit)}°F critical limit. Risk of thermal shutdown. Reduce cycle speed or check cabinet ventilation.`, "Staubli");
      } else if (t.val >= TEMP_THRESHOLDS.motor_warn) {
        alert("warning", "thermal", `Motor ${t.name} Running Hot`, `${t.name} motor at ${cToF(t.val)}°F — approaching thermal limit. Monitor trend. May need to slow down or improve cooling.`, "Staubli");
      }
    }
    if (s.temp_dsi >= TEMP_THRESHOLDS.dsi_crit) {
      alert("critical", "thermal", "DSI Drive Module Overheating", `Drive module at ${cToF(s.temp_dsi)}°F — this is the same component that caused the URPS thermal shutdowns. Immediate attention needed.`, "Staubli");
    } else if (s.temp_dsi >= TEMP_THRESHOLDS.dsi_warn) {
      alert("warning", "thermal", "DSI Drive Module Warm", `Drive module at ${cToF(s.temp_dsi)}°F — trending toward the thermal protection threshold. Check cabinet fans.`, "Staubli");
    }
  }

  if (a) {
    if (a.system_status === "down") {
      alert("critical", "vision", "Apera Vue System Down", "Containerloader reports system is DOWN. Use Restart Apera button or check the vision PC directly.", "Apera");
    } else if (a.system_status === "busy") {
      alert("info", "vision", "Apera Vue Initializing", "Vision system is starting up (busy). Detections will resume once fully loaded.", "Apera");
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
    if (!a.app_manager_ok && a.connected) {
      alert("warning", "vision", "App Manager Unreachable", "Apera app manager on :44334 is not responding. Remote restart may not be available.", "Apera");
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

  // ---- INTERNET UPLINK ----
  if (inet) {
    if (!inet.reachable) {
      alert("critical", "network", "Internet Down", "No internet connectivity. Viam Cloud sync will fail. Check cellular router.", "Infra");
    } else {
      if (inet.packet_loss_pct > 10) {
        alert("warning", "network", `${inet.packet_loss_pct}% Packet Loss`, "High packet loss on cellular link. Data sync may be unreliable.", "Infra");
      }
      if (inet.latency_ms > 500) {
        alert("warning", "network", "High Internet Latency", `${inet.latency_ms.toFixed(0)}ms latency. Remote monitoring may be sluggish.`, "Infra");
      }
      if (!inet.viam_reachable) {
        alert("critical", "communication", "Viam Cloud Unreachable", "Internet is up but cannot reach Viam Cloud. Data is being buffered locally.", "Infra");
      }
      if (!inet.dns_ok) {
        alert("warning", "network", "DNS Resolution Failing", "DNS is not resolving. Cellular router may be in a degraded state.", "Infra");
      }
    }
  }

  // ---- SWITCH / VPN ----
  if (sw) {
    if (!sw.eth0_up) {
      alert("critical", "network", "Ethernet Link Down", "Pi 5 eth0 has no carrier. Check cable to switch.", "Infra");
    }
    if (!sw.vpn_reachable) {
      alert("critical", "network", "Stridelinx VPN Down", "Cannot reach the cellular router. All internet and remote access is lost.", "Infra");
    }
    if (sw.vpn_reachable && !sw.vpn_web_ok) {
      alert("warning", "network", "Stridelinx Web UI Down", "VPN gateway pings but web management is not responding.", "Infra");
    }
  }

  // ---- PI 5 HEALTH ----
  if (pi) {
    if (pi.undervoltage_now) {
      alert("critical", "power", "Pi 5 Undervoltage", "Power supply voltage is low. Pi may reboot unexpectedly. Check USB-C power supply.", "Infra");
    }
    if (pi.throttled_now) {
      alert("warning", "thermal", "Pi 5 Thermal Throttle", `CPU at ${cToF(pi.cpu_temp_c)}°F — performance is being throttled. Improve ventilation.`, "Infra");
    }
    if (pi.cpu_temp_c >= 80) {
      alert("critical", "thermal", "Pi 5 CPU Overheating", `CPU at ${cToF(pi.cpu_temp_c)}°F — risk of shutdown. Move Pi or add cooling.`, "Infra");
    } else if (pi.cpu_temp_c >= 70) {
      alert("warning", "thermal", "Pi 5 CPU Warm", `CPU at ${cToF(pi.cpu_temp_c)}°F — approaching thermal throttle.`, "Infra");
    }
    if (pi.mem_used_pct > 90) {
      alert("warning", "power", "Pi 5 Memory Low", `${pi.mem_used_pct.toFixed(0)}% memory used. Module may crash if it runs out.`, "Infra");
    }
    if (pi.disk_used_pct > 90) {
      alert("warning", "power", "Pi 5 Disk Nearly Full", `${pi.disk_used_pct.toFixed(0)}% disk used (${pi.disk_free_gb.toFixed(0)} GB free). Data capture may stop.`, "Infra");
    }
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
  internet?: InternetHealth | null;
  switchVpn?: SwitchVpnHealth | null;
  piHealth?: PiHealth | null;
}

export default function CellWatchdog({ staubli, apera, network, internet = null, switchVpn = null, piHealth = null }: Props) {
  const alerts = useMemo(
    () => runWatchdog({ staubli, apera, network, internet, switchVpn, piHealth }),
    [staubli, apera, network, internet, switchVpn, piHealth]
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
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-950/50 text-red-400 border border-red-900/50">
              {criticals.length} CRITICAL
            </span>
          )}
          {warnings.length > 0 && (
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-orange-950/50 text-orange-400 border border-orange-900/50">
              {warnings.length} WARN
            </span>
          )}
          {alerts.length === 0 && (
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-950/50 text-emerald-400 border border-emerald-800/50">
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
                    <span className="text-xs uppercase tracking-wider font-bold opacity-70">{alert.category}</span>
                    <span className="text-xs text-gray-500">{alert.source}</span>
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
            <p className="text-xs text-gray-500 mt-1">
              Monitoring {staubli ? "robot" : ""}{staubli && apera ? " + " : ""}{apera ? "vision" : ""}{network.length > 0 ? ` + ${network.length} devices` : ""}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
