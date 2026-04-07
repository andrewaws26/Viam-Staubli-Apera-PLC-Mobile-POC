"use client";

/**
 * TruckPanel — Orchestrator for truck/vehicle diagnostics dashboard.
 *
 * This component handles data fetching, polling, trend accumulation,
 * driver behavior scoring, and layout. Display logic is delegated to:
 *   - TruckHeader: Title, VIN, mode toggle, connection status
 *   - StatusAlertBar: Vehicle state badges, lamp indicators, DTC flash
 *   - GaugeGrid: Sensor reading cards with threshold coloring
 *   - DTCPanel: Diagnostic Trouble Code display, clearing, on-demand diagnostics
 *   - AIChatPanel: AI mechanic chat + full diagnosis
 *   - TrendChartsGrid: Historical trend sparklines
 *   - ReportButton: PDF report generation with historical data
 *   - TruckMap: GPS position on Leaflet map
 *
 * Future panels (Staubli robot, Apera vision, dash cam) should follow
 * the same pattern: self-contained component with props from TruckPanel.
 */

import AIChatPanel from "./AIChatPanel";
import DTCPanel from "./DTCPanel";
import GaugeGrid from "./GaugeGrid";
import TruckHeader from "./DevTruck/TruckHeader";
import StatusAlertBar from "./DevTruck/StatusAlertBar";
import TrendChartsGrid from "./DevTruck/TrendChartsGrid";
import ReportButton from "./DevTruck/ReportButton";
import TruckNotes from "./TruckNotes";
import TruckChatTab from "./Chat/TruckChatTab";
import MaintenanceTracker from "./MaintenanceTracker";
import DTCHistory from "./DTCHistory";
import dynamic from "next/dynamic";

const TruckMap = dynamic(() => import("./TruckMap"), { ssr: false });

import React, { useState, useEffect, useCallback, useRef } from "react";
import { lookupSPN, lookupFMI } from "../lib/spn-lookup";
import {
  loadDTCHistory, saveDTCHistory, clearDTCHistory,
  buildDTCSnapshot, computeDTCDiff,
  type DTCHistoryEvent, type DTCSnapshot,
} from "../lib/dtc-history";

interface TruckReadings {
  [key: string]: unknown;
}

const TRUCK_POLL_MS = 3000;

type VehicleMode = "truck" | "car";

export default function TruckPanel({ simMode = false, truckId }: { simMode?: boolean; truckId?: string }) {
  const [readings, setReadings] = useState<TruckReadings | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicleMode, setVehicleMode] = useState<VehicleMode>("truck");
  const [modeAutoDetected, setModeAutoDetected] = useState(false);

  // VIN selector for history filtering
  const [selectedHistoryVin, setSelectedHistoryVin] = useState<string>("");
  const [historyVins, setHistoryVins] = useState<string[]>([]);

  // Cached historical data — persists in localStorage across sessions
  const HISTORY_CACHE_KEY = "ironsight_history_cache";
  const [cachedHistory, setCachedHistory] = useState<Record<string, unknown> | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = localStorage.getItem(HISTORY_CACHE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  // Background history fetch — runs every 5 minutes, caches to localStorage
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const vinParam = selectedHistoryVin ? `&vin=${encodeURIComponent(selectedHistoryVin)}` : "";
        const truckParam = truckId ? `&truck_id=${truckId}` : "";
        const resp = await fetch(`/api/truck-history?hours=168${vinParam}${truckParam}`);
        if (resp.ok) {
          const data = await resp.json();
          // Update available VINs from API response
          if (Array.isArray(data.distinctVins) && data.distinctVins.length > 0) {
            setHistoryVins(data.distinctVins);
          }
          if (data.totalPoints > 0) {
            data._cachedAt = new Date().toISOString();
            try { localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(data)); } catch { /* quota */ }
            setCachedHistory(data);
          }
        }
      } catch { /* cloud unavailable */ }
    };

    // Fetch immediately, then every 5 minutes
    const timer = setTimeout(fetchHistory, 3000); // delay 3s to let initial page load settle
    const id = setInterval(fetchHistory, 5 * 60 * 1000);
    return () => { clearTimeout(timer); clearInterval(id); };
  }, [simMode, selectedHistoryVin, truckId]);

  // Trend history — stores last 100 readings per metric
  const MAX_TREND_POINTS = 100;
  const [trendHistory, setTrendHistory] = useState<Record<string, { time: number; value: number }[]>>({});

  // Driver behavior scoring
  const [driverScore, setDriverScore] = useState(100);

  // DTC alert flash state
  const [prevDtcCount, setPrevDtcCount] = useState(0);
  const [dtcFlash, setDtcFlash] = useState(false);
  const driverEventsRef = React.useRef<{ type: string; time: number }[]>([]);
  const prevReadingsRef = React.useRef<TruckReadings | null>(null);

  // DTC history tracking
  const [dtcHistory, setDtcHistory] = useState<DTCHistoryEvent[]>(() => loadDTCHistory());
  const prevDtcSnapshotRef = useRef<DTCSnapshot>({});

  // AI diagnose handoff
  const [diagMessage, setDiagMessage] = useState<string | null>(null);

  const simTickRef = React.useRef(0);

  const fetchReadings = useCallback(async () => {
    if (simMode) {
      simTickRef.current += 1;
      const t = simTickRef.current;
      const rpm = 800 + Math.sin(t * 0.1) * 400 + Math.random() * 50;
      const speed = Math.max(0, 60 + Math.sin(t * 0.05) * 30 + Math.random() * 5);
      // Simulate truck driving a route near Louisville, KY
      const baseLat = 38.2527;
      const baseLon = -85.7585;
      const routeAngle = t * 0.02; // slowly circle
      const simLat = baseLat + Math.sin(routeAngle) * 0.008 + Math.cos(routeAngle * 0.3) * 0.003;
      const simLon = baseLon + Math.cos(routeAngle) * 0.012 + Math.sin(routeAngle * 0.5) * 0.004;
      const heading = ((routeAngle * 180 / Math.PI) + 90) % 360;
      const ptoOn = t % 100 > 80; // PTO active 20% of the time
      const idling = speed < 2 && rpm > 600;

      setReadings({
        // Engine
        engine_rpm: Math.round(rpm),
        engine_load_pct: 40 + Math.sin(t * 0.08) * 25 + Math.random() * 5,
        accel_pedal_pos_pct: 30 + Math.sin(t * 0.12) * 20,
        driver_demand_torque_pct: 35 + Math.sin(t * 0.1) * 20,
        actual_engine_torque_pct: 33 + Math.sin(t * 0.1) * 20,
        exhaust_gas_pressure_psi: 2.1 + Math.sin(t * 0.07) * 0.8,
        friction_torque_pct: 12 + Math.random() * 2,
        // Temps
        coolant_temp_f: 185 + Math.sin(t * 0.02) * 14 + Math.random() * 4,
        oil_temp_f: 203 + Math.sin(t * 0.015) * 18,
        fuel_temp_f: 108 + Math.sin(t * 0.01) * 9,
        intake_manifold_temp_f: 131 + Math.sin(t * 0.03) * 18,
        trans_oil_temp_f: 176 + Math.sin(t * 0.02) * 14,
        ambient_temp_f: 72 + Math.random() * 4,
        // Pressures
        oil_pressure_psi: 45 + Math.sin(t * 0.05) * 6 + Math.random() * 1.5,
        fuel_pressure_psi: 55 + Math.random() * 3,
        boost_pressure_psi: 23 + Math.sin(t * 0.08) * 6,
        barometric_pressure_psi: 14.7 + Math.random() * 0.07,
        // Vehicle
        vehicle_speed_mph: Math.round(speed * 0.621371 * 10) / 10,
        current_gear: speed < 5 ? 0 : Math.min(12, Math.floor(speed / 8) + 1),
        selected_gear: speed < 5 ? 0 : Math.min(12, Math.floor(speed / 8) + 1),
        cruise_control_active: speed > 55 ? 1 : 0,
        vehicle_distance_mi: 187432.5 + t * 0.01,
        vehicle_distance_hr_mi: 187432.5 + t * 0.01,
        // Fuel
        fuel_rate_gph: 4 + Math.sin(t * 0.06) * 2 + Math.random() * 0.5,
        fuel_economy_mpg: 5.9 + Math.sin(t * 0.04) * 1.9,
        fuel_level_pct: Math.max(10, 72 - t * 0.01),
        battery_voltage_v: 13.8 + Math.sin(t * 0.03) * 0.3,
        oil_level_pct: 85 + Math.random() * 3,
        // Lifetime
        engine_hours: 4523.5 + t * 0.001,
        total_fuel_used_gal: 33134 + t * 0.013,
        idle_engine_hours: 1892.3 + (idling ? t * 0.001 : 0),
        idle_fuel_used_gal: 4215.7 + (idling ? t * 0.002 : 0),
        trip_fuel_gal: 12.4 + t * 0.005,
        vin: "1M1AN07Y3GM023456",
        vehicle_vin: "1M1AN07Y3GM023456",
        vehicle_protocol: "j1939",
        software_id: "D13TC-EU6 v22.4.1",
        // GPS
        gps_latitude: simLat,
        gps_longitude: simLon,
        compass_bearing_deg: heading,
        nav_speed_mph: Math.round(speed * 0.621371 * 10) / 10,
        altitude_ft: 462 + Math.sin(t * 0.01) * 30,
        vehicle_pitch_deg: Math.sin(t * 0.03) * 2,
        // Aftertreatment
        dpf_soot_load_pct: 32 + Math.sin(t * 0.005) * 15,
        dpf_diff_pressure_psi: 1.8 + Math.sin(t * 0.04) * 0.6,
        dpf_inlet_temp_f: 750 + Math.sin(t * 0.03) * 150,
        dpf_outlet_temp_f: 680 + Math.sin(t * 0.03) * 130,
        dpf_regen_status: t % 200 > 180 ? 1 : 0,
        def_level_pct: Math.max(5, 68 - t * 0.005),
        def_temp_f: 82 + Math.random() * 5,
        nox_inlet_ppm: 450 + Math.sin(t * 0.06) * 150,
        nox_outlet_ppm: 35 + Math.sin(t * 0.06) * 15,
        scr_efficiency_pct: 95 + Math.random() * 3,
        scr_catalyst_temp_f: 620 + Math.sin(t * 0.025) * 80,
        // Brakes
        brake_pedal_pos_pct: speed < 30 && Math.sin(t * 0.15) > 0.8 ? 40 : 0,
        abs_active: 0,
        brake_air_pressure_psi: 118 + Math.random() * 4,
        air_supply_pressure_psi: 120 + Math.random() * 5,
        air_pressure_circuit1_psi: 119 + Math.random() * 3,
        air_pressure_circuit2_psi: 117 + Math.random() * 4,
        front_axle_speed_mph: Math.round(speed * 0.621371 * 10) / 10,
        // PTO / Hydraulic
        pto_engaged: ptoOn ? 1 : 0,
        pto_rpm: ptoOn ? 1200 + Math.random() * 100 : 0,
        hydraulic_oil_temp_f: ptoOn ? 155 + Math.sin(t * 0.02) * 15 : 95,
        hydraulic_oil_pressure_psi: ptoOn ? 2800 + Math.sin(t * 0.1) * 400 : 0,
        hydraulic_oil_level_pct: 92 + Math.random() * 3,
        retarder_torque_pct: speed > 50 && Math.sin(t * 0.2) > 0.7 ? -25 : 0,
        // Idle / Service
        service_distance_mi: 12450 - t * 0.1,
        fan_speed_pct: (185 + Math.sin(t * 0.02) * 14) > 195 ? 60 + Math.random() * 20 : 0,
        turbo_wastegate_pct: 30 + Math.sin(t * 0.08) * 20,
        // Transmission
        trans_output_rpm: speed > 0 ? rpm * 0.4 : 0,
        clutch_slip_pct: speed < 10 && rpm > 900 ? 5 + Math.random() * 3 : 0,
        // Derived metrics
        vehicle_state: rpm > 0 ? "Engine On" : "Ignition On",
        idle_waste_active: idling && !ptoOn,
        harsh_braking: false,
        harsh_acceleration: false,
        harsh_behavior_flag: false,
        fuel_cost_per_hour: (4 + Math.sin(t * 0.06) * 2) * 3.80,
        fuel_cost_per_mile: 0.62 + Math.random() * 0.05,
        idle_waste_dollars: 4215.7 * 3.80,
        idle_pct: (1892.3 / 4523.5) * 100,
        dpf_health: "OK",
        battery_health: "OK",
        def_low: false,
        // DTCs
        active_dtc_count: 1,
        dtc_0_spn: 3226, dtc_0_fmi: 18, dtc_0_occurrence: 5,
        amber_warning_lamp: 1, malfunction_lamp: 0, red_stop_lamp: 0, protect_lamp: 0,
        // Metadata
        _bus_connected: true,
        _frame_count: t * 105,
        _seconds_since_last_frame: 0.3 + Math.random() * 0.2,
        _can_interface: "can0",
        _protocol: "j1939",
      } as TruckReadings);
      setConnected(true);
      setError(null);
      return;
    }

    try {
      const truckParam = truckId ? `&truck_id=${truckId}` : "";
      const resp = await fetch(`/api/truck-readings?component=truck-engine${truckParam}`);
      if (!resp.ok) throw new Error(`API error: ${resp.status}`);
      const data = await resp.json();

      // Handle offline state
      if (data._offline) {
        setConnected(false);
        setError("Vehicle offline — no recent data");
        return;
      }

      // Handle vehicle off
      if (data._vehicle_off) {
        setReadings(data as TruckReadings);
        setConnected(true);
        setError("Vehicle off — engine not running");
        return;
      }

      setReadings(data as TruckReadings);
      setConnected(true);
      setError(null);
      // Auto-detect vehicle mode from protocol field (only once)
      if (!modeAutoDetected && data._protocol) {
        setVehicleMode(data._protocol === "obd2" ? "car" : "truck");
        setModeAutoDetected(true);
      }
      // Default history VIN selector to connected vehicle (only once)
      if (!selectedHistoryVin && data.vehicle_vin && String(data.vehicle_vin) !== "UNKNOWN" && String(data.vehicle_vin) !== "0") {
        setSelectedHistoryVin(String(data.vehicle_vin));
      }
    } catch (err) {
      setConnected(false);
      setError(err instanceof Error ? err.message : "Connection error");
    }
  }, [simMode, truckId]);

  useEffect(() => {
    fetchReadings();
    const id = setInterval(fetchReadings, TRUCK_POLL_MS);
    return () => clearInterval(id);
  }, [fetchReadings]);


  // Accumulate trend data and score driver behavior when readings change
  useEffect(() => {
    if (!readings) return;
    const now = Date.now();
    const trendKeys = ["engine_rpm", "coolant_temp_f", "oil_temp_f", "boost_pressure_psi", "battery_voltage_v", "vehicle_speed_mph", "throttle_position_pct", "fuel_level_pct", "scr_efficiency_pct", "def_level_pct"];

    setTrendHistory((prev) => {
      const updated = { ...prev };
      for (const key of trendKeys) {
        const val = readings[key];
        if (typeof val !== "number") continue;
        const existing = updated[key] || [];
        const newPoints = [...existing, { time: now, value: val }];
        updated[key] = newPoints.length > MAX_TREND_POINTS ? newPoints.slice(-MAX_TREND_POINTS) : newPoints;
      }
      return updated;
    });

    // Driver behavior scoring
    const prev = prevReadingsRef.current;
    if (prev) {
      const rpm = readings.engine_rpm as number ?? 0;
      const prevRpm = prev.engine_rpm as number ?? 0;
      const speed = readings.vehicle_speed_mph as number ?? 0;
      const throttle = readings.throttle_position_pct as number ?? 0;

      // Harsh acceleration: RPM jump > 1500 in one cycle
      if (rpm - prevRpm > 1500) {
        driverEventsRef.current.push({ type: "harsh_accel", time: now });
      }
      // Over-revving: RPM > 5000
      if (rpm > 5000) {
        driverEventsRef.current.push({ type: "over_rev", time: now });
      }
      // Excessive idling: RPM < 900 and speed = 0 for extended time
      if (rpm > 0 && rpm < 900 && speed === 0) {
        driverEventsRef.current.push({ type: "idle", time: now });
      }
      // Aggressive throttle: > 80%
      if (throttle > 80) {
        driverEventsRef.current.push({ type: "aggressive_throttle", time: now });
      }

      // Keep only last 5 minutes of events
      const cutoff = now - 300000;
      driverEventsRef.current = driverEventsRef.current.filter((e) => e.time > cutoff);

      // Calculate score: start at 100, deduct per event type
      const events = driverEventsRef.current;
      const harshCount = events.filter((e) => e.type === "harsh_accel").length;
      const overRevCount = events.filter((e) => e.type === "over_rev").length;
      const idleSeconds = events.filter((e) => e.type === "idle").length * 3; // 3s per reading cycle
      const aggressiveCount = events.filter((e) => e.type === "aggressive_throttle").length;

      let score = 100;
      score -= harshCount * 5;      // -5 per harsh acceleration
      score -= overRevCount * 8;     // -8 per over-rev
      score -= Math.floor(idleSeconds / 30) * 2; // -2 per 30s of idle
      score -= aggressiveCount * 3;  // -3 per aggressive throttle event
      setDriverScore(Math.max(0, Math.min(100, score)));
    }
    prevReadingsRef.current = readings;
  }, [readings]);

  // DTC count change detection — flash when new DTCs appear
  useEffect(() => {
    if (!readings) return;
    const currentDtcCount = readings.active_dtc_count as number ?? 0;
    if (currentDtcCount > 0 && prevDtcCount === 0) {
      setDtcFlash(true);
      const timer = setTimeout(() => setDtcFlash(false), 3000);
      return () => clearTimeout(timer);
    }
    setPrevDtcCount(currentDtcCount);

    // DTC history: diff current snapshot against previous
    const currentSnap = buildDTCSnapshot(readings as Record<string, unknown>);
    const newEvents = computeDTCDiff(prevDtcSnapshotRef.current, currentSnap);
    if (newEvents.length > 0) {
      setDtcHistory(prev => {
        const updated = [...prev, ...newEvents].slice(-200);
        saveDTCHistory(updated);
        return updated;
      });
    }
    prevDtcSnapshotRef.current = currentSnap;
  }, [readings, prevDtcCount]);

  const busConnected = readings?._bus_connected === true;
  const frameCount = readings?._frame_count as number ?? 0;
  const secsSinceFrame = readings?._seconds_since_last_frame as number ?? -1;
  const dtcCount = readings?.active_dtc_count as number ?? 0;
  const hasData = readings && frameCount > 0;

  // Vehicle state inference
  const vehicleState = (readings?.vehicle_state as string) ?? "Unknown";
  const idleWaste = readings?.idle_waste_active === true;
  const harshBehavior = readings?.harsh_behavior_flag === true;

  // GPS data
  const gpsLat = readings?.gps_latitude as number ?? null;
  const gpsLon = readings?.gps_longitude as number ?? null;

  // Suppress unused variable warning — driverScore is tracked for future dashboard display
  void driverScore;

  return (
    <div className="bg-gray-900/30 rounded-2xl border border-gray-800 p-3 sm:p-5">
      {/* Header */}
      <TruckHeader
        vehicleMode={vehicleMode}
        setVehicleMode={setVehicleMode}
        readings={readings}
        busConnected={busConnected}
        connected={connected}
        frameCount={frameCount}
        error={error}
        historyVins={historyVins}
        selectedHistoryVin={selectedHistoryVin}
        setSelectedHistoryVin={setSelectedHistoryVin}
      />

      {/* Vehicle State + Alerts Bar */}
      <StatusAlertBar
        vehicleState={vehicleState}
        idleWaste={idleWaste}
        harshBehavior={harshBehavior}
        readings={readings}
        dtcFlash={dtcFlash}
      />

      {/* Live Map */}
      {vehicleMode === "truck" && (
        <TruckMap
          latitude={gpsLat}
          longitude={gpsLon}
          vehicleState={vehicleState}
        />
      )}

      {/* Staleness warning */}
      {busConnected && secsSinceFrame > 5 && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-3 py-1.5 mb-3 text-[10px] sm:text-xs text-yellow-300">
          No CAN data for {secsSinceFrame.toFixed(0)}s — check connection
        </div>
      )}

      {/* DTC Display & Management */}
      <DTCPanel
        readings={readings}
        vehicleMode={vehicleMode}
        busConnected={busConnected}
        dtcCount={dtcCount}
        simMode={simMode}
        setReadings={setReadings}
        onDiagnoseCode={(spn, fmi, ecuLabel) => {
          const spnInfo = lookupSPN(spn);
          const fmiText = lookupFMI(fmi);
          setDiagMessage(
            `Diagnose this active DTC from the ${ecuLabel} ECU: SPN ${spn} (${spnInfo.name}) / FMI ${fmi} (${fmiText}). ${spnInfo.description}. Severity: ${spnInfo.severity}. What are the most likely causes and what should I check first?`
          );
        }}
        dtcHistory={dtcHistory}
        onClearDTCHistory={() => {
          clearDTCHistory();
          setDtcHistory([]);
        }}
      />

      {/* Sensor Gauges by category */}
      <GaugeGrid readings={readings} vehicleMode={vehicleMode} hasData={!!hasData} />

      {/* Report Button */}
      <ReportButton readings={readings} cachedHistory={cachedHistory} />

      {/* Trend Charts */}
      <TrendChartsGrid trendHistory={trendHistory} busConnected={busConnected} />

      {/* AI Mechanic Chat */}
      {busConnected && readings && (
        <AIChatPanel
          readings={readings}
          vehicleMode={vehicleMode}
          initialMessage={diagMessage}
          onInitialMessageConsumed={() => setDiagMessage(null)}
          dtcHistory={dtcHistory}
        />
      )}

      {/* DTC History */}
      <DTCHistory truckId={truckId} />

      {/* Maintenance History */}
      <MaintenanceTracker truckId={truckId} />

      {/* Team Chat */}
      <TruckChatTab truckId={truckId || "default"} currentReadings={readings} />

      {/* Truck Notes */}
      <TruckNotes truckId={truckId} />

      {/* Not connected state */}
      {!connected && (
        <div className="text-center py-6 text-gray-600">
          <p className="text-sm">Truck sensor offline</p>
          <p className="text-xs mt-1">{error}</p>
        </div>
      )}
    </div>
  );
}
