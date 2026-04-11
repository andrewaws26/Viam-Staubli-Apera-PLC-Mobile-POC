// CommandCenter.tsx — Top-level operational summary for the truck dashboard.
// Answers three questions in 2 seconds: Is everything OK? If not, what?
// What needs attention? Self-polls cell + truck data independently.
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { assessTruckHealth, type TruckHealth, type HealthStatus } from "@/lib/truck-baseline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Issue {
  id: string;
  severity: "critical" | "warning";
  title: string;
  action: string;
  source: string;
}

interface Subsystem {
  id: string;
  label: string;
  status: "ok" | "warn" | "offline" | "future";
  summary: string;
  section: string; // scroll target
}

type OverallStatus = "clear" | "watch" | "action";

// ---------------------------------------------------------------------------
// Data aggregation — pulls issues from all sources
// ---------------------------------------------------------------------------

function aggregateIssues(
  cellData: Record<string, unknown> | null,
  truckHealth: TruckHealth | null,
): Issue[] {
  const issues: Issue[] = [];
  let id = 0;

  // From truck health baseline
  if (truckHealth) {
    for (const cat of truckHealth.categories) {
      for (const m of cat.metrics) {
        if (m.status === "critical") {
          issues.push({ id: `th-${++id}`, severity: "critical", title: `${m.label}: ${m.value} ${m.unit}`, action: m.detail.split(".")[0], source: "Truck" });
        } else if (m.status === "warning") {
          issues.push({ id: `th-${++id}`, severity: "warning", title: `${m.label}: ${m.value} ${m.unit}`, action: m.detail.split(".")[0], source: "Truck" });
        }
      }
    }
    // Findings (strings like "3 active DTCs", "Fuel level low")
    if (truckHealth.findings) {
      for (const f of truckHealth.findings) {
        const isLow = f.toLowerCase().includes("low") || f.toLowerCase().includes("dtc") || f.toLowerCase().includes("critical");
        issues.push({ id: `tf-${++id}`, severity: isLow ? "warning" : "warning", title: f, action: "Review truck diagnostics", source: "Truck" });
      }
    }
  }

  // From cell data (staubli logs)
  if (cellData) {
    const s = cellData.staubli as Record<string, unknown> | undefined;
    const logs = cellData.staubliLogs as Record<string, unknown> | undefined;

    if (logs) {
      const urps = Number(logs.urps_events_24h || 0);
      if (urps > 0) {
        issues.push({ id: `cl-${++id}`, severity: urps >= 3 ? "critical" : "warning", title: `${urps} URPS Thermal Shutdown${urps > 1 ? "s" : ""} (24h)`, action: "Check cabinet ventilation", source: "Robot" });
      }
      const ecat = Number(logs.ethercat_events_24h || 0);
      if (ecat > 0) {
        issues.push({ id: `cl-${++id}`, severity: ecat >= 5 ? "critical" : "warning", title: `${ecat} EtherCAT Error${ecat > 1 ? "s" : ""} (24h)`, action: "Check fieldbus cabling", source: "Robot" });
      }
      const safety = Number(logs.safety_stops_24h || 0);
      if (safety > 0) {
        issues.push({ id: `cl-${++id}`, severity: "warning", title: `${safety} Safety Stop${safety > 1 ? "s" : ""} (24h)`, action: String(logs.safety_last_cause || "Check safety interlocks"), source: "Robot" });
      }
    }

    if (s && s.connected === false) {
      issues.push({ id: `cs-${++id}`, severity: "critical", title: "Robot Controller Offline", action: "Check network to 192.168.0.254", source: "Robot" });
    }

    const a = cellData.apera as Record<string, unknown> | undefined;
    if (a && a.connected === false) {
      issues.push({ id: `ca-${++id}`, severity: "critical", title: "Vision System Offline", action: "Check Apera PC at 192.168.3.151", source: "Vision" });
    }
  }

  // Sort: critical first, then warning
  issues.sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1));
  return issues.slice(0, 5);
}

function buildSubsystems(
  cellData: Record<string, unknown> | null,
  truckHealth: TruckHealth | null,
  truckReadings: Record<string, unknown> | null,
): Subsystem[] {
  const subs: Subsystem[] = [];

  // Truck Engine
  if (truckReadings) {
    const rpm = Number(truckReadings.engine_rpm || 0);
    const coolant = Number(truckReadings.coolant_temp_f || 0);
    const batt = Number(truckReadings.battery_voltage_v || 0);
    const state = String(truckReadings.vehicle_state || "Unknown");
    const status = truckHealth?.overall === "critical" ? "warn" as const : "ok" as const;
    subs.push({
      id: "truck", label: "Truck Engine", status,
      summary: state === "Engine On" ? `${rpm.toFixed(0)} RPM, ${coolant.toFixed(0)}\u00B0F, ${batt.toFixed(1)}V` : state,
      section: "truck-section",
    });
  } else {
    subs.push({ id: "truck", label: "Truck Engine", status: "offline", summary: "No data", section: "truck-section" });
  }

  // Robot (Staubli)
  if (cellData) {
    const s = cellData.staubli as Record<string, unknown> | undefined;
    if (s && s.connected) {
      const task = String(s.task_selected || "Idle");
      const maxTemp = Math.max(
        Number(s.temp_j1 || 0), Number(s.temp_j2 || 0), Number(s.temp_j3 || 0),
        Number(s.temp_j4 || 0), Number(s.temp_j5 || 0), Number(s.temp_j6 || 0),
      );
      const tempF = maxTemp * 9 / 5 + 32;
      subs.push({ id: "robot", label: "Robot", status: "ok", summary: `${task}, peak ${tempF.toFixed(0)}\u00B0F`, section: "cell-section" });
    } else {
      subs.push({ id: "robot", label: "Robot", status: "offline", summary: "Disconnected", section: "cell-section" });
    }

    // Vision (Apera)
    const a = cellData.apera as Record<string, unknown> | undefined;
    if (a && a.connected) {
      const conf = Number(a.detection_confidence_avg || 0);
      const pipe = String(a.pipeline_state || "unknown");
      subs.push({ id: "vision", label: "Vision", status: "ok", summary: `${pipe}, ${(conf * 100).toFixed(0)}% conf`, section: "cell-section" });
    } else {
      subs.push({ id: "vision", label: "Vision", status: "offline", summary: "Disconnected", section: "cell-section" });
    }

    // Network
    const net = cellData.network as Array<Record<string, unknown>> | undefined;
    if (net && net.length > 0) {
      const up = net.filter((d) => d.reachable).length;
      subs.push({ id: "network", label: "Network", status: up === net.length ? "ok" : "warn", summary: `${up}/${net.length} devices`, section: "cell-section" });
    }
  } else {
    subs.push({ id: "robot", label: "Robot", status: "offline", summary: "No data", section: "cell-section" });
    subs.push({ id: "vision", label: "Vision", status: "offline", summary: "No data", section: "cell-section" });
  }

  // Electrical
  subs.push({ id: "electrical", label: "Electrical", status: "future", summary: "$58 upgrade", section: "electrical-section" });

  return subs;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  simMode: boolean;
  truckId?: string;
}

export default function CommandCenter({ simMode, truckId }: Props) {
  const [cellData, setCellData] = useState<Record<string, unknown> | null>(null);
  const [truckReadings, setTruckReadings] = useState<Record<string, unknown> | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const poll = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (simMode || truckId === "00") params.set("sim", "true");
      if (truckId) params.set("truck", truckId);

      const [cellRes, truckRes] = await Promise.allSettled([
        fetch(`/api/cell-readings?${params}`).then((r) => r.ok ? r.json() : null),
        fetch(`/api/truck-readings?component=truck-engine&${params}`).then((r) => r.ok ? r.json() : null),
      ]);

      if (cellRes.status === "fulfilled" && cellRes.value && !cellRes.value._no_cell) {
        setCellData(cellRes.value);
      }
      if (truckRes.status === "fulfilled" && truckRes.value) {
        setTruckReadings(truckRes.value);
      }
      setLastUpdate(new Date());
    } catch {
      // Silent — subsystems show offline
    }
  }, [simMode, truckId]);

  useEffect(() => {
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, [poll]);

  const truckHealth = useMemo(
    () => truckReadings ? assessTruckHealth(truckReadings) : null,
    [truckReadings],
  );

  const issues = useMemo(() => aggregateIssues(cellData, truckHealth), [cellData, truckHealth]);
  const subsystems = useMemo(() => buildSubsystems(cellData, truckHealth, truckReadings), [cellData, truckHealth, truckReadings]);

  const overall: OverallStatus = issues.some((i) => i.severity === "critical")
    ? "action"
    : issues.length > 0
    ? "watch"
    : "clear";

  const statusConfig = {
    clear: { color: "bg-emerald-500", ring: "ring-emerald-500/20", text: "text-emerald-400", label: "ALL CLEAR", glow: "shadow-emerald-500/30" },
    watch: { color: "bg-amber-500", ring: "ring-amber-500/20", text: "text-amber-400", label: "WATCH", glow: "shadow-amber-500/30" },
    action: { color: "bg-red-500", ring: "ring-red-500/20", text: "text-red-400", label: "ACTION NEEDED", glow: "shadow-red-500/30" },
  }[overall];

  const pillColor = (s: Subsystem["status"]) => {
    switch (s) {
      case "ok": return "bg-emerald-500";
      case "warn": return "bg-amber-500";
      case "offline": return "bg-gray-600";
      case "future": return "bg-amber-600/50";
    }
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-800 bg-[#060a10]">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative z-10 p-3 sm:p-4">
        {/* Three-zone layout */}
        <div className="flex flex-col lg:flex-row gap-3 lg:gap-4 lg:items-stretch">

          {/* ZONE 1: Overall Status */}
          <div className="flex items-center gap-3 lg:flex-col lg:items-center lg:justify-center lg:w-[180px] lg:shrink-0">
            <div className={`relative w-14 h-14 sm:w-16 sm:h-16 lg:w-20 lg:h-20 rounded-full ${statusConfig.color} ${statusConfig.glow} shadow-lg flex items-center justify-center ${overall === "action" ? "animate-pulse" : ""}`}>
              <div className={`absolute inset-0 rounded-full ${statusConfig.ring} ring-[6px] sm:ring-8`} />
              {overall === "clear" ? (
                <svg className="w-7 h-7 sm:w-8 sm:h-8 lg:w-10 lg:h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : overall === "action" ? (
                <svg className="w-7 h-7 sm:w-8 sm:h-8 lg:w-10 lg:h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              ) : (
                <svg className="w-7 h-7 sm:w-8 sm:h-8 lg:w-10 lg:h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </div>
            <div className="lg:text-center">
              <div className={`text-xs sm:text-sm font-black uppercase tracking-[0.2em] ${statusConfig.text}`}>
                {statusConfig.label}
              </div>
              <div className="text-[10px] text-gray-600 font-mono mt-0.5">
                {lastUpdate ? lastUpdate.toLocaleTimeString() : "\u2014"}
              </div>
            </div>
          </div>

          {/* Vertical divider (desktop) */}
          <div className="hidden lg:block w-px bg-gray-800/80 self-stretch" />
          {/* Horizontal divider (mobile) */}
          <div className="lg:hidden h-px bg-gray-800/80" />

          {/* ZONE 2: Active Issues */}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600 mb-2">
              {issues.length > 0 ? `${issues.length} Active Issue${issues.length > 1 ? "s" : ""}` : "Status"}
            </div>

            {issues.length === 0 ? (
              <div className="flex items-center gap-2 py-2">
                <svg className="w-4 h-4 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-xs text-gray-500">No active issues. All systems operating normally.</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {issues.map((issue) => (
                  <div key={issue.id} className="flex items-start gap-2 group">
                    <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${issue.severity === "critical" ? "bg-red-500 animate-pulse" : "bg-amber-500"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold ${issue.severity === "critical" ? "text-red-400" : "text-amber-400"}`}>
                          {issue.title}
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-600 bg-gray-800/80 px-1.5 py-0.5 rounded">
                          {issue.source}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500 leading-tight mt-0.5 truncate">{issue.action}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Vertical divider (desktop) */}
          <div className="hidden lg:block w-px bg-gray-800/80 self-stretch" />
          <div className="lg:hidden h-px bg-gray-800/80" />

          {/* ZONE 3: System Heartbeats */}
          <div className="lg:w-[280px] lg:shrink-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600 mb-2">Systems</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-1.5">
              {subsystems.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => scrollTo(sub.section)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-900/40 border border-gray-800/40 hover:border-gray-700/60 transition-colors text-left group"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${pillColor(sub.status)}`} />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 group-hover:text-gray-400 transition-colors">{sub.label}</div>
                    <div className="text-[10px] text-gray-600 font-mono truncate">{sub.summary}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
