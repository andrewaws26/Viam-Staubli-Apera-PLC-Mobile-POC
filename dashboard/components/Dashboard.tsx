"use client";

// PRIVACY CONSTRAINT: This dashboard displays machine and component state only.
// No fields identifying operators, shift times, or personnel may be displayed.
// See docs/architecture.md section 6 for the full architectural enforcement.

import { useState, useEffect, useCallback, useRef } from "react";
import { SENSOR_CONFIGS } from "../lib/sensors";
import { ComponentState, FaultEvent, SensorReadings } from "../lib/types";
import StatusCard from "./StatusCard";
import AlertBanner from "./AlertBanner";
import FaultHistory from "./FaultHistory";
import PlcDetailPanel from "./PlcDetailPanel";
import DiagnosticsPanel from "./DiagnosticsPanel";
import HistoryPanel from "./HistoryPanel";
import TruckPanel from "./TruckPanel";
import PiHealthCard from "./PiHealthCard";
import ConnectionDot from "./ConnectionDot";
const POLL_INTERVAL_MS = 2000;
const MAX_FAULT_HISTORY = 10;

// ---------------------------------------------------------------------------
// Audio — industrial klaxon using Web Audio API.
// Two alternating sawtooth tones mimic a factory alarm. The function returns
// a callable that plays the sound on demand.
// ---------------------------------------------------------------------------
function buildAlarmPlayer() {
  return () => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();

      // Pattern: 880Hz on — gap — 1100Hz on — gap — 880Hz on — gap — 1100Hz on
      const bursts = [
        { freq: 880, t0: 0.0, t1: 0.18 },
        { freq: 1100, t0: 0.22, t1: 0.4 },
        { freq: 880, t0: 0.44, t1: 0.62 },
        { freq: 1100, t0: 0.66, t1: 0.84 },
      ];

      bursts.forEach(({ freq, t0, t1 }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.22, ctx.currentTime + t0);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t1);
        osc.start(ctx.currentTime + t0);
        osc.stop(ctx.currentTime + t1 + 0.05);
      });
    } catch {
      // Browser blocked autoplay — user must interact with the page first
    }
  };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const [components, setComponents] = useState<ComponentState[]>(() =>
    SENSOR_CONFIGS.map((cfg) => ({
      id: cfg.id,
      label: cfg.label,
      icon: cfg.icon,
      status: "loading" as const,
      readings: null,
      lastUpdated: null,
      faultMessage: null,
    }))
  );

  const [faultHistory, setFaultHistory] = useState<FaultEvent[]>([]);
  const [activeFaultLabels, setActiveFaultLabels] = useState<string[]>([]);
  const [sdkConnected, setSdkConnected] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0); // bumping triggers flash animation

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [historySummary, setHistorySummary] = useState<any | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Simulation mode
  const [simMode, setSimMode] = useState(false);
  const simRef = useRef({ distance: 0, plates: 0, tick: 0 });

  const prevFaultIds = useRef<Set<string>>(new Set());
  const prevServoPower = useRef<number | null>(null);
  const playAlarm = useRef(buildAlarmPlayer());

  // -------------------------------------------------------------------------
  // Core poll — called on mount and every POLL_INTERVAL_MS
  // -------------------------------------------------------------------------
  const poll = useCallback(async () => {
    // Readings are fetched via /api/sensor-readings (server-side Data API)
    // so Viam credentials never reach the browser and no WebRTC is needed.

    const newStates: ComponentState[] = [];
    const currentFaultIds = new Set<string>();
    const newFaultEvents: FaultEvent[] = [];

    for (const cfg of SENSOR_CONFIGS) {
      let readings: SensorReadings | null = null;
      let status: ComponentState["status"] = "loading";
      let faultMessage: string | null = null;

      // Simulation mode — generate realistic production readings
      if (simMode) {
        simRef.current.tick += 1;
        simRef.current.distance += 0.5; // 0.5 ft/sec = 30 ft/min
        // Drop a plate every 19.5 inches of travel (1.625 ft)
        const expectedPlates = Math.floor((simRef.current.distance * 12) / 19.5);
        simRef.current.plates = expectedPlates;
        const d = simRef.current;
        readings = {
          connected: true, fault: false, system_state: "running",
          total_reads: d.tick * 50 + 200, total_errors: 0,
          uptime_seconds: d.tick * 2, shift_hours: d.tick * 2 / 3600,
          encoder_count: d.tick * 100, encoder_direction: "forward",
          encoder_distance_ft: Math.round(d.distance * 100) / 100,
          encoder_speed_ftpm: 30, encoder_revolutions: d.distance / 4.19,
          tps_power_loop: true, camera_signal: d.tick % 3 !== 0,
          encoder_enabled: true, floating_zero: false, encoder_reset: false,
          eject_tps_1: d.tick % 2 === 0, eject_left_tps_2: false, eject_right_tps_2: false,
          air_eagle_1_feedback: d.tick % 2 === 0, air_eagle_2_feedback: false, air_eagle_3_enable: false,
          plate_drop_count: d.plates, plates_per_minute: 18.5,
          ds1: 1310, ds2: 39, ds3: 195, ds4: 0, ds5: 1314, ds6: 6070,
          ds7: d.plates, ds8: 18, ds9: Math.floor(Math.random() * 195), ds10: Math.floor(Math.random() * 195),
          ds11: 6070, ds12: 1214, ds13: 5, ds14: 1295, ds15: 0, ds16: 0, ds17: 0, ds18: 0, ds19: 0,
          ds20: 0, ds21: 0, ds22: 0, ds23: 0, ds24: 0, ds25: 1,
          operating_mode: "TPS-1 Single", mode_tps1_single: true, mode_tps1_double: false,
          mode_tps2_both: false, mode_tps2_left: false, mode_tps2_right: false,
          mode_tie_team: false, mode_2nd_pass: false,
          drop_enable: true, drop_enable_latch: true,
          drop_detector_eject: d.tick % 3 === 0, drop_encoder_eject: d.tick % 3 !== 0,
          drop_software_eject: false, first_tie_detected: true,
          encoder_mode: false, camera_positive: d.tick % 3 !== 0, backup_alarm: false,
          lay_ties_set: true, drop_ties: true,
          camera_detections_per_min: 12.5, eject_rate_per_min: 18.5,
          camera_rate_trend: "stable", encoder_noise: 2,
          modbus_response_time_ms: 3.2, detector_eject_rate_per_min: 11.0,
          last_drop_spacing_in: 19.3 + Math.random() * 0.4,
          avg_drop_spacing_in: 19.5, min_drop_spacing_in: 18.9, max_drop_spacing_in: 20.1,
          distance_since_last_drop_in: Math.random() * 19.5, drop_count_in_window: d.plates,
          dd1_frozen: false, ds10_frozen: false,
          td5_seconds_laying: d.tick * 2, td6_tie_travel: 0,
          diagnostics: "[]", diagnostics_count: 0, diagnostics_critical: 0, diagnostics_warning: 0,
          diagnostic_log: "", diag_metrics: "",
          location_city: "Louisville", location_region: "Kentucky",
          location_timezone: "America/Kentucky/Louisville",
          weather: "☀️ +48°F 56% ↓12mph", weather_temp: "+48°F",
          local_time: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
        } as unknown as SensorReadings;
        status = "healthy";
        setSdkConnected(true);
        setSdkError(null);

        newStates.push({ id: cfg.id, label: cfg.label, icon: cfg.icon, status, readings, lastUpdated: new Date(), faultMessage: null });
        continue;
      }

      try {
        const res = await fetch(`/api/sensor-readings?component=${cfg.componentName}`);
        if (res.status === 404) {
          const body = await res.json();
          if (body.error === "component_not_found") {
            status = "pending";
            faultMessage = "Not configured in Viam yet";
            setSdkConnected(true);
          } else {
            // no_recent_data — machine may be offline
            status = "error";
            faultMessage = "No recent sensor data";
            setSdkConnected(false);
            setSdkError("No data in last 30 seconds");
          }
        } else if (!res.ok) {
          throw new Error(`API returned ${res.status}`);
        } else {
          readings = await res.json() as SensorReadings;

          const healthy = cfg.isHealthy(readings);
          status = healthy ? "healthy" : "fault";

          if (!healthy) {
            faultMessage = cfg.getFaultMessage(readings);
            currentFaultIds.add(cfg.id);

            // Only record a new history entry when this fault is newly detected
            if (!prevFaultIds.current.has(cfg.id)) {
              newFaultEvents.push({
                id: `${cfg.id}-${Date.now()}`,
                componentId: cfg.id,
                componentLabel: cfg.label,
                message: faultMessage,
                timestamp: new Date(),
              });
            }
          }

          setSdkConnected(true);
          setSdkError(null);
        }
      } catch (err) {
        status = "error";
        faultMessage = "Sensor read error";
        currentFaultIds.add(cfg.id);

        setSdkConnected(false);
        setSdkError(err instanceof Error ? err.message : "Connection error");
      }

      newStates.push({
        id: cfg.id,
        label: cfg.label,
        icon: cfg.icon,
        status,
        readings,
        lastUpdated: new Date(),
        faultMessage,
      });
    }

    // -----------------------------------------------------------------------
    // Detect *new* faults (rising edge) — trigger alarm + flash
    // -----------------------------------------------------------------------
    const newFaultIds = [...currentFaultIds].filter(
      (id) => !prevFaultIds.current.has(id)
    );

    if (newFaultIds.length > 0) {
      playAlarm.current();
      setFlashKey((k) => k + 1); // triggers CSS flash animation via key change
    }

    // -----------------------------------------------------------------
    // State change detection for TPS power loop
    // -----------------------------------------------------------------
    const plcState = newStates.find((c) => c.id === "plc");
    if (plcState?.readings && plcState.readings.connected === true) {
      const curPower = plcState.readings.tps_power_loop === true ? 1 : 0;
      const prevPower = prevServoPower.current;
      if (prevPower !== null && prevPower !== curPower) {
        newFaultEvents.push({
          id: `power-change-${Date.now()}`,
          componentId: "plc",
          componentLabel: "TPS Power",
          message: curPower === 1 ? "TPS Power ON" : "TPS Power OFF",
          timestamp: new Date(),
        });
      }
      prevServoPower.current = curPower;
    }

    prevFaultIds.current = currentFaultIds;

    setComponents(newStates);
    setActiveFaultLabels(
      newStates
        .filter((c) => c.status === "fault" || c.status === "error")
        .map((c) => c.label)
    );

    if (newFaultEvents.length > 0) {
      setFaultHistory((prev) =>
        [...newFaultEvents, ...prev].slice(0, MAX_FAULT_HISTORY)
      );
    }

  }, [simMode]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // -------------------------------------------------------------------------
  // Historical data — fetched once on mount (NOT on the 2-second poll).
  // -------------------------------------------------------------------------
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch("/api/sensor-history?type=summary&hours=8");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setHistorySummary(data);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <>
      {/* Full-screen flash overlay — re-mounts on each new fault via key */}
      {flashKey > 0 && (
        <div
          key={flashKey}
          className="fixed inset-0 pointer-events-none z-50"
          style={{ animation: "flashOut 0.7s ease-out forwards" }}
        />
      )}

      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        {/* ---------------------------------------------------------------- */}
        {/* Header                                                           */}
        {/* ---------------------------------------------------------------- */}
        <header className="border-b border-gray-800 px-2 sm:px-5 py-2 sm:py-4 flex items-center justify-between gap-2 sm:gap-4 shrink-0">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-black tracking-widest uppercase text-gray-100 leading-none">
              TPS Monitor
            </h1>
            <p className="text-[10px] sm:text-xs text-gray-600 mt-0.5 tracking-wide truncate">
              IronSight — Live Production & Fleet Data
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                if (!simMode) {
                  simRef.current = { distance: 0, plates: 0, tick: 0 };
                }
                setSimMode(!simMode);
              }}
              className={`text-[10px] sm:text-xs min-h-[44px] px-3 sm:px-3 py-2 rounded-lg font-bold transition-colors ${
                simMode
                  ? "bg-purple-700 text-white"
                  : "border border-gray-700 text-gray-500 hover:text-gray-300"
              }`}
            >
              {simMode ? "SIM ON" : "SIM"}
            </button>
            <ConnectionDot
              connected={simMode || sdkConnected}
              error={simMode ? null : sdkError}
            />
          </div>
        </header>
        {simMode && (
          <div className="bg-purple-900/30 border-b border-purple-700/50 px-3 sm:px-5 py-1.5 text-[10px] sm:text-xs text-purple-300">
            Simulation mode — showing simulated production data. <button onClick={() => setSimMode(false)} className="underline hover:text-white ml-1">Stop</button>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Alert Banner — shown only when faults are active                */}
        {/* ---------------------------------------------------------------- */}
        {activeFaultLabels.length > 0 && (
          <AlertBanner faultNames={activeFaultLabels} isEstop={false} />
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Status Grid                                                      */}
        {/* ---------------------------------------------------------------- */}
        <main className="flex-1 px-2 sm:px-5 py-2 sm:py-8 flex flex-col gap-2 sm:gap-6">
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-6">
            {components.map((comp) => (
              <StatusCard key={comp.id} component={comp} />
            ))}
          </div>

          {/* Pi Health Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
            <PiHealthCard label="TPS Monitoring" icon="💻" host="tps" simMode={simMode} />
            <PiHealthCard label="Truck Monitoring" icon="🚛" host="truck" simMode={simMode} />
          </div>

          {/* Location & Weather bar */}
          {(() => {
            const plcComp = components.find((c) => c.id === "plc");
            const r = plcComp?.readings;
            if (!r) return null;
            const city = r.location_city as string || "";
            const region = r.location_region as string || "";
            const weather = r.weather as string || "";
            const localTime = r.local_time as string || "";
            if (!city && !weather) return null;
            return (
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-500 bg-gray-900/50 rounded-xl px-4 py-2">
                {localTime && <span className="text-gray-300 font-mono">{localTime}</span>}
                {city && <span>{city}{region ? `, ${region}` : ""}</span>}
                {weather && <span className="text-gray-300">{weather}</span>}
              </div>
            );
          })()}

          {/* -------------------------------------------------------------- */}
          {/* PLC Sensor Data Detail Panel                                   */}
          {/* -------------------------------------------------------------- */}
          {(() => {
            const plcComp = components.find((c) => c.id === "plc");
            if (plcComp && plcComp.readings && plcComp.status !== "pending") {
              return <PlcDetailPanel readings={plcComp.readings} />;
            }
            return null;
          })()}

          {/* -------------------------------------------------------------- */}
          {/* System Diagnostics                                            */}
          {/* -------------------------------------------------------------- */}
          {(() => {
            const plcComp = components.find((c) => c.id === "plc");
            if (plcComp && plcComp.readings) {
              return <DiagnosticsPanel readings={plcComp.readings} />;
            }
            return null;
          })()}

          {/* -------------------------------------------------------------- */}
          {/* Production History (Viam Data API)                            */}
          {/* -------------------------------------------------------------- */}
          <HistoryPanel
            summary={historySummary}
            loading={historyLoading}
            error={historyError}
            onRefresh={fetchHistory}
          />


          {/* -------------------------------------------------------------- */}
          {/* Truck Diagnostics (J1939 CAN Bus)                            */}
          {/* -------------------------------------------------------------- */}
          <TruckPanel simMode={simMode} />

          {/* -------------------------------------------------------------- */}
          {/* Fault History                                                  */}
          {/* -------------------------------------------------------------- */}
          <FaultHistory events={faultHistory} />
        </main>

        {/* ---------------------------------------------------------------- */}
        {/* Footer                                                           */}
        {/* ---------------------------------------------------------------- */}
        <footer className="border-t border-gray-800 px-3 sm:px-5 py-2 sm:py-3 text-[10px] sm:text-xs text-gray-700 flex items-center justify-between shrink-0">
          <span>Polling every {POLL_INTERVAL_MS / 1000}s</span>
          <span>
            Live — Viam Cloud ·{" "}
            {new Date().getFullYear()}
          </span>
        </footer>
      </div>
    </>
  );
}
