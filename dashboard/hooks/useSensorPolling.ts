"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { SENSOR_CONFIGS } from "../lib/sensors";
import { ComponentState, FaultEvent, SensorReadings } from "../lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2000;
const MAX_FAULT_HISTORY = 10;

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface SensorPollingState {
  components: ComponentState[];
  faultHistory: FaultEvent[];
  activeFaultLabels: string[];
  connectionStatus: "connected" | "stale" | "plc-disconnected" | "offline" | "loading";
  connectionDataAge: number | null;
  connectionError: string | null;
  flashKey: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  historySummary: any | null;
  historyLoading: boolean;
  historyError: string | null;
  fetchHistory: () => Promise<void>;
  simMode: boolean;
  setSimMode: (v: boolean | ((prev: boolean) => boolean)) => void;
  pollIntervalMs: number;
}

// ---------------------------------------------------------------------------
// Simulation data factory
// ---------------------------------------------------------------------------

function buildSimReadings(sim: { distance: number; plates: number; tick: number }): SensorReadings {
  return {
    connected: true, fault: false, system_state: "running",
    total_reads: sim.tick * 50 + 200, total_errors: 0,
    uptime_seconds: sim.tick * 2, shift_hours: sim.tick * 2 / 3600,
    encoder_count: sim.tick * 100, encoder_direction: "forward",
    encoder_distance_ft: Math.round(sim.distance * 100) / 100,
    encoder_speed_ftpm: 30, encoder_revolutions: sim.distance / 4.19,
    tps_power_loop: true, camera_signal: sim.tick % 3 !== 0,
    encoder_enabled: true, floating_zero: false, encoder_reset: false,
    eject_tps_1: sim.tick % 2 === 0, eject_left_tps_2: false, eject_right_tps_2: false,
    air_eagle_1_feedback: sim.tick % 2 === 0, air_eagle_2_feedback: false, air_eagle_3_enable: false,
    plate_drop_count: sim.plates, plates_per_minute: 18.5,
    ds1: 1310, ds2: 39, ds3: 195, ds4: 0, ds5: 1314, ds6: 6070,
    ds7: sim.plates, ds8: 18, ds9: Math.floor(Math.random() * 195), ds10: Math.floor(Math.random() * 195),
    ds11: 6070, ds12: 1214, ds13: 5, ds14: 1295, ds15: 0, ds16: 0, ds17: 0, ds18: 0, ds19: 0,
    ds20: 0, ds21: 0, ds22: 0, ds23: 0, ds24: 0, ds25: 1,
    operating_mode: "TPS-1 Single", mode_tps1_single: true, mode_tps1_double: false,
    mode_tps2_both: false, mode_tps2_left: false, mode_tps2_right: false,
    mode_tie_team: false, mode_2nd_pass: false,
    drop_enable: true, drop_enable_latch: true,
    drop_detector_eject: sim.tick % 3 === 0, drop_encoder_eject: sim.tick % 3 !== 0,
    drop_software_eject: false, first_tie_detected: true,
    encoder_mode: false, camera_positive: sim.tick % 3 !== 0, backup_alarm: false,
    lay_ties_set: true, drop_ties: true,
    camera_detections_per_min: 12.5, eject_rate_per_min: 18.5,
    camera_rate_trend: "stable", encoder_noise: 2,
    modbus_response_time_ms: 3.2, detector_eject_rate_per_min: 11.0,
    last_drop_spacing_in: 19.3 + Math.random() * 0.4,
    avg_drop_spacing_in: 19.5, min_drop_spacing_in: 18.9, max_drop_spacing_in: 20.1,
    distance_since_last_drop_in: Math.random() * 19.5, drop_count_in_window: sim.plates,
    dd1_frozen: false, ds10_frozen: false,
    td5_seconds_laying: sim.tick * 2, td6_tie_travel: 0,
    diagnostics: "[]", diagnostics_count: 0, diagnostics_critical: 0, diagnostics_warning: 0,
    diagnostic_log: "", diag_metrics: "",
    location_city: "Louisville", location_region: "Kentucky",
    location_timezone: "America/Kentucky/Louisville",
    weather: "\u2600\uFE0F +48\u00B0F 56% \u219312mph", weather_temp: "+48\u00B0F",
    local_time: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
  } as unknown as SensorReadings;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSensorPolling(onNewFault: () => void): SensorPollingState {
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
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "stale" | "plc-disconnected" | "offline" | "loading">("loading");
  const [connectionDataAge, setConnectionDataAge] = useState<number | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [historySummary, setHistorySummary] = useState<any | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [simMode, setSimMode] = useState(false);
  const simRef = useRef({ distance: 0, plates: 0, tick: 0 });

  const prevFaultIds = useRef<Set<string>>(new Set());
  const prevServoPower = useRef<number | null>(null);

  // Wrap the callback ref so it doesn't cause re-renders
  const onNewFaultRef = useRef(onNewFault);
  onNewFaultRef.current = onNewFault;

  // -------------------------------------------------------------------------
  // Core poll
  // -------------------------------------------------------------------------
  const poll = useCallback(async () => {
    const newStates: ComponentState[] = [];
    const currentFaultIds = new Set<string>();
    const newFaultEvents: FaultEvent[] = [];

    for (const cfg of SENSOR_CONFIGS) {
      let readings: SensorReadings | null = null;
      let status: ComponentState["status"] = "loading";
      let faultMessage: string | null = null;

      if (simMode) {
        simRef.current.tick += 1;
        simRef.current.distance += 0.5;
        const expectedPlates = Math.floor((simRef.current.distance * 12) / 19.5);
        simRef.current.plates = expectedPlates;
        readings = buildSimReadings(simRef.current);
        status = "healthy";
        setConnectionStatus("connected");
        setConnectionDataAge(null);
        setConnectionError(null);
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
          } else {
            status = "error";
            faultMessage = "No recent sensor data";
            setConnectionStatus("offline");
            setConnectionDataAge(null);
            setConnectionError("No data in last 30 seconds");
          }
        } else if (!res.ok) {
          throw new Error(`API returned ${res.status}`);
        } else {
          readings = await res.json() as SensorReadings;

          if (readings._offline) {
            status = "error";
            faultMessage = "No recent sensor data";
            setConnectionStatus("offline");
            setConnectionDataAge(null);
            setConnectionError((readings._reason as string) || "No recent data");
          } else {
            const dataAge = typeof readings._data_age_seconds === "number"
              ? readings._data_age_seconds : null;

            if (dataAge !== null && dataAge > 120) {
              status = "error";
              faultMessage = `Sensor data is ${dataAge}s old`;
              setConnectionStatus("offline");
              setConnectionDataAge(dataAge);
              setConnectionError(`Last data ${dataAge}s ago`);
            } else {
              if (dataAge !== null && dataAge > 30) {
                setConnectionStatus("stale");
              } else if (readings.connected === false) {
                setConnectionStatus("plc-disconnected");
              } else {
                setConnectionStatus("connected");
              }
              setConnectionDataAge(dataAge);
              setConnectionError(null);

              const healthy = cfg.isHealthy(readings);
              status = healthy ? "healthy" : "fault";

              if (!healthy) {
                faultMessage = cfg.getFaultMessage(readings);
                currentFaultIds.add(cfg.id);

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
            }
          }
        }
      } catch (err) {
        status = "error";
        faultMessage = "Sensor read error";
        currentFaultIds.add(cfg.id);
        setConnectionStatus("offline");
        setConnectionDataAge(null);
        setConnectionError(err instanceof Error ? err.message : "Connection error");
      }

      newStates.push({
        id: cfg.id, label: cfg.label, icon: cfg.icon,
        status, readings, lastUpdated: new Date(), faultMessage,
      });
    }

    // Rising-edge fault detection
    const newFaultIds = [...currentFaultIds].filter(
      (id) => !prevFaultIds.current.has(id)
    );

    if (newFaultIds.length > 0) {
      onNewFaultRef.current();
      setFlashKey((k) => k + 1);
    }

    // TPS power loop state change detection
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
  // Historical data — fetched once on mount
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

  // Reset sim state when entering sim mode
  const wrappedSetSimMode = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setSimMode((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      if (next && !prev) {
        simRef.current = { distance: 0, plates: 0, tick: 0 };
      }
      return next;
    });
  }, []);

  return {
    components,
    faultHistory,
    activeFaultLabels,
    connectionStatus,
    connectionDataAge,
    connectionError,
    flashKey,
    historySummary,
    historyLoading,
    historyError,
    fetchHistory,
    simMode,
    setSimMode: wrappedSetSimMode,
    pollIntervalMs: POLL_INTERVAL_MS,
  };
}
