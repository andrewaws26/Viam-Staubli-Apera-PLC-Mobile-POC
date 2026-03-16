"use client";

// PRIVACY CONSTRAINT: This dashboard displays machine and component state only.
// No fields identifying operators, shift times, or personnel may be displayed.
// See docs/architecture.md section 6 for the full architectural enforcement.

import { useState, useEffect, useCallback, useRef } from "react";
import { SENSOR_CONFIGS, ECAT_SIGNAL_DEFS, ComponentName } from "../lib/sensors";
import { ComponentState, FaultEvent, SensorReadings } from "../lib/types";
import StatusCard from "./StatusCard";
import AlertBanner from "./AlertBanner";
import FaultHistory from "./FaultHistory";
import PlcDetailPanel from "./PlcDetailPanel";
import ConnectionDot from "./ConnectionDot";
import { getMockReadings, injectFault } from "../lib/mock";

const POLL_INTERVAL_MS = 2000;
const MAX_FAULT_HISTORY = 10;
const IS_MOCK = process.env.NEXT_PUBLIC_MOCK_MODE === "true";

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

  const [isEstop, setIsEstop] = useState(false);

  const prevFaultIds = useRef<Set<string>>(new Set());
  const prevEcatSignals = useRef<Record<string, number>>({});
  const prevSystemState = useRef<string | null>(null);
  const playAlarm = useRef(buildAlarmPlayer());

  // -------------------------------------------------------------------------
  // Core poll — called on mount and every POLL_INTERVAL_MS
  // -------------------------------------------------------------------------
  const poll = useCallback(async () => {
    // Lazily import the real Viam client only in non-mock mode.
    // (The module is never bundled if NEXT_PUBLIC_MOCK_MODE=true at build time,
    // but lazy import ensures no SSR issues regardless.)
    const viamModule = IS_MOCK ? null : await import("../lib/viam");
    const viamFetch = viamModule?.getSensorReadings ?? null;

    const newStates: ComponentState[] = [];
    const currentFaultIds = new Set<string>();
    const newFaultEvents: FaultEvent[] = [];

    for (const cfg of SENSOR_CONFIGS) {
      let readings: SensorReadings | null = null;
      let status: ComponentState["status"] = "loading";
      let faultMessage: string | null = null;

      try {
        readings = IS_MOCK
          ? getMockReadings(cfg.componentName)
          : await viamFetch!(cfg.componentName);

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

        if (!IS_MOCK) setSdkConnected(true);
      } catch (err) {
        // Distinguish "component not configured yet" from real errors.
        // ComponentNotFoundError means the SDK connected fine but the
        // component doesn't exist on the machine — show as pending.
        const isNotFound =
          viamModule &&
          err instanceof viamModule.ComponentNotFoundError;

        if (isNotFound) {
          status = "pending";
          faultMessage = "Not configured in Viam yet";
          // Still mark SDK as connected — the machine link works fine
          setSdkConnected(true);
        } else {
          status = "error";
          faultMessage = "Sensor read error";
          currentFaultIds.add(cfg.id);

          if (!IS_MOCK) {
            setSdkConnected(false);
            setSdkError(err instanceof Error ? err.message : "Connection error");
          }
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
    // E-Cat signal change detection — log faults and recoveries
    // -----------------------------------------------------------------
    const plcState = newStates.find((c) => c.id === "plc");
    if (plcState?.readings && plcState.readings.connected === true) {
      const prev = prevEcatSignals.current;
      const ecatEvents: FaultEvent[] = [];

      for (const { key, label, pin } of ECAT_SIGNAL_DEFS) {
        const curVal = Number(plcState.readings[key] ?? 0);
        const prevVal = prev[key];
        if (prevVal !== undefined && prevVal !== curVal) {
          if (curVal === 0 && prevVal === 1) {
            // Signal dropped from 1 → 0
            ecatEvents.push({
              id: `ecat-${key}-${Date.now()}`,
              componentId: "plc",
              componentLabel: "E-Cat Signal",
              message: `E-Cat Signal Lost — ${label} (Pin ${pin})`,
              timestamp: new Date(),
            });
          } else if (curVal === 1 && prevVal === 0) {
            // Signal restored from 0 → 1
            ecatEvents.push({
              id: `ecat-${key}-${Date.now()}`,
              componentId: "plc",
              componentLabel: "E-Cat Signal",
              message: `E-Cat Signal Restored — ${label} (Pin ${pin})`,
              timestamp: new Date(),
            });
          }
        }
        prev[key] = curVal;
      }
      prevEcatSignals.current = prev;

      if (ecatEvents.length > 0) {
        newFaultEvents.push(...ecatEvents);
      }

      // E-stop state change detection — log dedicated history entries
      const curState = String(plcState.readings.system_state ?? "");
      const prevState = prevSystemState.current;
      if (prevState !== null && prevState !== curState) {
        if (curState === "e-stopped") {
          newFaultEvents.push({
            id: `estop-activated-${Date.now()}`,
            componentId: "plc",
            componentLabel: "E-Stop",
            message: "E-Stop Activated — system halted",
            timestamp: new Date(),
          });
        } else if (prevState === "e-stopped") {
          newFaultEvents.push({
            id: `estop-released-${Date.now()}`,
            componentId: "plc",
            componentLabel: "E-Stop",
            message: "E-Stop Released — system ready",
            timestamp: new Date(),
          });
        }
      }
      prevSystemState.current = curState;
      setIsEstop(curState === "e-stopped");
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

    if (IS_MOCK) setSdkConnected(true);
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // -------------------------------------------------------------------------
  // Mock-only: manual fault injection buttons for stakeholder demos
  // -------------------------------------------------------------------------
  const mockFaultTargets: { label: string; component: ComponentName }[] = [
    { label: "Arm", component: "robot-arm-sensor" },
    { label: "Vision", component: "vision-health" },
    { label: "PLC", component: "plc-monitor" },
  ];

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
        <header className="border-b border-gray-800 px-5 py-4 flex items-center justify-between gap-4 shrink-0">
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-widest uppercase text-gray-100 leading-none">
              Robot Cell Monitor
            </h1>
            <p className="text-xs text-gray-600 mt-0.5 tracking-wide">
              Machine state only — no personnel data
            </p>
          </div>
          <ConnectionDot
            connected={sdkConnected}
            error={sdkError}
            isMock={IS_MOCK}
          />
        </header>

        {/* ---------------------------------------------------------------- */}
        {/* Alert Banner — shown only when faults are active                */}
        {/* ---------------------------------------------------------------- */}
        {(activeFaultLabels.length > 0 || isEstop) && (
          <AlertBanner faultNames={activeFaultLabels} isEstop={isEstop} />
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Status Grid                                                      */}
        {/* ---------------------------------------------------------------- */}
        <main className="flex-1 px-5 py-8 flex flex-col gap-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
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
          {/* Mock mode: manual fault injection for demos                    */}
          {/* -------------------------------------------------------------- */}
          {IS_MOCK && (
            <div className="border border-yellow-900/60 bg-yellow-950/20 rounded-2xl px-5 py-4 flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-widest text-yellow-600">
                Demo Controls
              </span>
              {mockFaultTargets.map(({ label, component }) => (
                <button
                  key={component}
                  onClick={() => injectFault(component)}
                  className="px-4 py-1.5 rounded-lg bg-red-800 hover:bg-red-700 active:bg-red-900 text-white text-sm font-bold tracking-wide transition-colors"
                >
                  Fault: {label}
                </button>
              ))}
              <span className="text-xs text-yellow-700 ml-auto hidden sm:block">
                Simulates a wire pull or component failure
              </span>
            </div>
          )}

          {/* -------------------------------------------------------------- */}
          {/* Fault History                                                  */}
          {/* -------------------------------------------------------------- */}
          <FaultHistory events={faultHistory} />
        </main>

        {/* ---------------------------------------------------------------- */}
        {/* Footer                                                           */}
        {/* ---------------------------------------------------------------- */}
        <footer className="border-t border-gray-800 px-5 py-3 text-xs text-gray-700 flex items-center justify-between shrink-0">
          <span>Polling every {POLL_INTERVAL_MS / 1000}s</span>
          <span>
            {IS_MOCK ? "Mock data" : "Live — Viam Cloud"} ·{" "}
            {new Date().getFullYear()}
          </span>
        </footer>
      </div>
    </>
  );
}
