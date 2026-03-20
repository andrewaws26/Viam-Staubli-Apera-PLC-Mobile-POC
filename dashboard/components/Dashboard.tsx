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

  const prevFaultIds = useRef<Set<string>>(new Set());
  const prevServoPower = useRef<number | null>(null);
  const playAlarm = useRef(buildAlarmPlayer());

  // -------------------------------------------------------------------------
  // Core poll — called on mount and every POLL_INTERVAL_MS
  // -------------------------------------------------------------------------
  const poll = useCallback(async () => {
    // In live mode, readings are fetched via /api/sensor-readings (server-side
    // proxy) so Viam credentials never reach the browser.
    const { getSensorReadings, ComponentNotFoundError } = await import("../lib/viam");

    const newStates: ComponentState[] = [];
    const currentFaultIds = new Set<string>();
    const newFaultEvents: FaultEvent[] = [];

    for (const cfg of SENSOR_CONFIGS) {
      let readings: SensorReadings | null = null;
      let status: ComponentState["status"] = "loading";
      let faultMessage: string | null = null;

      try {
        readings = await getSensorReadings(cfg.componentName);

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
      } catch (err) {
        // ComponentNotFoundError means the API route connected fine but the
        // component doesn't exist on the machine — show as pending.
        const isNotFound =
          ComponentNotFoundError && err instanceof ComponentNotFoundError;

        if (isNotFound) {
          status = "pending";
          faultMessage = "Not configured in Viam yet";
          setSdkConnected(true);
        } else {
          status = "error";
          faultMessage = "Sensor read error";
          currentFaultIds.add(cfg.id);

          setSdkConnected(false);
          setSdkError(err instanceof Error ? err.message : "Connection error");
        }
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

  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

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
        <header className="border-b border-gray-800 px-3 sm:px-5 py-3 sm:py-4 flex items-center justify-between gap-3 sm:gap-4 shrink-0">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-black tracking-widest uppercase text-gray-100 leading-none">
              TPS Monitor
            </h1>
            <p className="text-[10px] sm:text-xs text-gray-600 mt-0.5 tracking-wide truncate">
              Tie Plate System — Live Production Data
            </p>
          </div>
          <ConnectionDot
            connected={sdkConnected}
            error={sdkError}
          />
        </header>

        {/* ---------------------------------------------------------------- */}
        {/* Alert Banner — shown only when faults are active                */}
        {/* ---------------------------------------------------------------- */}
        {activeFaultLabels.length > 0 && (
          <AlertBanner faultNames={activeFaultLabels} isEstop={false} />
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Status Grid                                                      */}
        {/* ---------------------------------------------------------------- */}
        <main className="flex-1 px-3 sm:px-5 py-4 sm:py-8 flex flex-col gap-4 sm:gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {components.map((comp) => (
              <StatusCard key={comp.id} component={comp} />
            ))}
          </div>

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
