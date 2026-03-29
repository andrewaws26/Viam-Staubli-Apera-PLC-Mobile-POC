"use client";

import { lookupSPN, lookupFMI } from "../lib/spn-lookup";

import React, { useState, useEffect, useCallback } from "react";

interface TruckReadings {
  [key: string]: unknown;
}

const TRUCK_POLL_MS = 3000;

// Gauge thresholds for color coding
const THRESHOLDS: Record<string, { warn: number; crit: number; inverted?: boolean }> = {
  coolant_temp_c: { warn: 95, crit: 105 },
  oil_pressure_kpa: { warn: 200, crit: 100, inverted: true },
  battery_voltage_v: { warn: 12.0, crit: 11.5, inverted: true },
  oil_temp_c: { warn: 110, crit: 130 },
  fuel_level_pct: { warn: 20, crit: 10, inverted: true },
  boost_pressure_kpa: { warn: 250, crit: 300 },
};

function getValueColor(key: string, value: number): string {
  const t = THRESHOLDS[key as keyof typeof THRESHOLDS];
  if (!t) return "text-gray-100";

  if (t.inverted) {
    if (value <= t.crit) return "text-red-400";
    if (value <= t.warn) return "text-yellow-400";
  } else {
    if (value >= t.crit) return "text-red-400";
    if (value >= t.warn) return "text-yellow-400";
  }
  return "text-gray-100";
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "--";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (typeof value === "number") {
    if (key.includes("_pct") || key.includes("_pos")) return `${value.toFixed(1)}%`;
    if (key.includes("_c") && !key.includes("count")) return `${(value * 9/5 + 32).toFixed(0)}°F`;
    if (key.includes("_v")) return `${value.toFixed(1)}V`;
    if (key.includes("_kpa")) return `${(value * 0.14504).toFixed(1)} psi`;
    if (key.includes("_kmh")) return `${(value * 0.621371).toFixed(0)} mph`;
    if (key.includes("_lph")) return `${(value * 0.264172).toFixed(1)} gal/h`;
    if (key.includes("_km_l")) return `${(value * 2.35215).toFixed(1)} mpg`;
    if (key === "engine_rpm") return `${value.toFixed(0)}`;
    if (key === "engine_hours") return `${value.toFixed(1)} hrs`;
    if (key === "total_fuel_used_l") return `${(value * 0.264172).toFixed(0)} gal`;
    if (key === "runtime_seconds") {
      const mins = Math.floor(value / 60);
      const secs = Math.floor(value % 60);
      return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    }
    if (key === "current_gear" || key === "selected_gear") {
      if (value === 0) return "N";
      if (value < 0) return "R";
      return `${value.toFixed(0)}`;
    }
    return value.toFixed(1);
  }
  return String(value);
}

// Field groupings
const ENGINE_FIELDS = [
  { key: "engine_rpm", label: "Engine RPM", highlight: true },
  { key: "engine_load_pct", label: "Engine Load" },
  { key: "accel_pedal_pos_pct", label: "Accelerator" },
  { key: "driver_demand_torque_pct", label: "Demand Torque" },
  { key: "actual_engine_torque_pct", label: "Actual Torque" },
];

const TEMP_FIELDS = [
  { key: "coolant_temp_c", label: "Coolant Temp", highlight: true },
  { key: "oil_temp_c", label: "Oil" },
  { key: "fuel_temp_c", label: "Fuel" },
  { key: "intake_manifold_temp_c", label: "Intake" },
  { key: "trans_oil_temp_c", label: "Trans Oil" },
  { key: "ambient_temp_c", label: "Ambient" },
];

const PRESSURE_FIELDS = [
  { key: "oil_pressure_kpa", label: "Oil Pressure", highlight: true },
  { key: "fuel_pressure_kpa", label: "Fuel Pressure" },
  { key: "boost_pressure_kpa", label: "Boost" },
  { key: "barometric_pressure_kpa", label: "Baro" },
];

const VEHICLE_FIELDS = [
  { key: "vehicle_speed_kmh", label: "Speed", highlight: true },
  { key: "current_gear", label: "Gear" },
  { key: "fuel_rate_lph", label: "Fuel Rate" },
  { key: "fuel_economy_km_l", label: "Fuel Economy" },
  { key: "fuel_level_pct", label: "Fuel Level" },
  { key: "battery_voltage_v", label: "Battery" },
  { key: "oil_level_pct", label: "Oil Level" },
];

const TOTAL_FIELDS = [
  { key: "engine_hours", label: "Engine Hours" },
  { key: "total_fuel_used_l", label: "Total Fuel" },
];

// Car-specific field overrides — OBD-II returns different fields
const CAR_ENGINE_FIELDS = [
  { key: "engine_rpm", label: "Engine RPM", highlight: true },
  { key: "engine_load_pct", label: "Engine Load" },
  { key: "throttle_position_pct", label: "Throttle" },
];

const CAR_TEMP_FIELDS = [
  { key: "coolant_temp_c", label: "Coolant Temp", highlight: true },
  { key: "oil_temp_c", label: "Oil Temp" },
  { key: "intake_air_temp_c", label: "Intake Air" },
  { key: "ambient_temp_c", label: "Ambient" },
];

const CAR_PRESSURE_FIELDS = [
  { key: "boost_pressure_kpa", label: "Manifold Pressure", highlight: true },
  { key: "fuel_pressure_kpa", label: "Fuel Rail Pressure" },
];

const CAR_VEHICLE_FIELDS = [
  { key: "vehicle_speed_kph", label: "Speed", highlight: true },
  { key: "fuel_level_pct", label: "Fuel Level" },
  { key: "battery_voltage_v", label: "Battery" },
  { key: "runtime_seconds", label: "Runtime" },
];

const LAMP_NAMES: Record<string, string> = {
  malfunction_lamp: "MIL",
  red_stop_lamp: "STOP",
  amber_warning_lamp: "WARN",
  protect_lamp: "PROT",
};

type VehicleMode = "truck" | "car";

export default function TruckPanel({ simMode = false }: { simMode?: boolean }) {
  const [readings, setReadings] = useState<TruckReadings | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);
  const [vehicleMode, setVehicleMode] = useState<VehicleMode>("truck");
  const [modeAutoDetected, setModeAutoDetected] = useState(false);

  const simTickRef = React.useRef(0);

  const fetchReadings = useCallback(async () => {
    if (simMode) {
      simTickRef.current += 1;
      const t = simTickRef.current;
      const rpm = 800 + Math.sin(t * 0.1) * 400 + Math.random() * 50;
      const speed = Math.max(0, 60 + Math.sin(t * 0.05) * 30 + Math.random() * 5);
      setReadings({
        engine_rpm: Math.round(rpm),
        engine_load_pct: 40 + Math.sin(t * 0.08) * 25 + Math.random() * 5,
        accel_pedal_pos_pct: 30 + Math.sin(t * 0.12) * 20,
        driver_demand_torque_pct: 35 + Math.sin(t * 0.1) * 20,
        actual_engine_torque_pct: 33 + Math.sin(t * 0.1) * 20,
        coolant_temp_c: 85 + Math.sin(t * 0.02) * 8 + Math.random() * 2,
        oil_temp_c: 95 + Math.sin(t * 0.015) * 10,
        fuel_temp_c: 42 + Math.sin(t * 0.01) * 5,
        intake_manifold_temp_c: 55 + Math.sin(t * 0.03) * 10,
        trans_oil_temp_c: 80 + Math.sin(t * 0.02) * 8,
        ambient_temp_c: 22 + Math.random() * 2,
        oil_pressure_kpa: 310 + Math.sin(t * 0.05) * 40 + Math.random() * 10,
        fuel_pressure_kpa: 380 + Math.random() * 20,
        boost_pressure_kpa: 160 + Math.sin(t * 0.08) * 40,
        barometric_pressure_kpa: 101.3 + Math.random() * 0.5,
        vehicle_speed_kmh: Math.round(speed * 10) / 10,
        current_gear: speed < 5 ? 0 : Math.min(12, Math.floor(speed / 8) + 1),
        fuel_rate_lph: 15 + Math.sin(t * 0.06) * 8 + Math.random() * 2,
        fuel_economy_km_l: 2.5 + Math.sin(t * 0.04) * 0.8,
        fuel_level_pct: Math.max(10, 72 - t * 0.01),
        battery_voltage_v: 13.8 + Math.sin(t * 0.03) * 0.3,
        oil_level_pct: 85 + Math.random() * 3,
        engine_hours: 4523.5 + t * 0.001,
        total_fuel_used_l: 125430 + t * 0.05,
        active_dtc_count: 2,
        ...({
          dtc_0_spn: 3226, dtc_0_fmi: 18, dtc_0_occurrence: 5,
          dtc_1_spn: 5246, dtc_1_fmi: 0, dtc_1_occurrence: 2,
          amber_warning_lamp: 1, malfunction_lamp: 0, red_stop_lamp: 0, protect_lamp: 0,
        }),
        _bus_connected: true,
        _frame_count: t * 47,
        _seconds_since_last_frame: 0.3 + Math.random() * 0.2,
        _can_interface: "can0",
      } as TruckReadings);
      setConnected(true);
      setError(null);
      return;
    }

    try {
      const { getTruckSensorReadings } = await import("../lib/truck-viam");
      const data = await getTruckSensorReadings("truck-engine");
      setReadings(data as TruckReadings);
      setConnected(true);
      setError(null);
      // Auto-detect vehicle mode from protocol field (only once)
      if (!modeAutoDetected && data._protocol) {
        setVehicleMode(data._protocol === "obd2" ? "car" : "truck");
        setModeAutoDetected(true);
      }
    } catch (err) {
      setConnected(false);
      setError(err instanceof Error ? err.message : "Connection error");
    }
  }, [simMode]);

  useEffect(() => {
    fetchReadings();
    const id = setInterval(fetchReadings, TRUCK_POLL_MS);
    return () => clearInterval(id);
  }, [fetchReadings]);

  const handleClearDTCs = async () => {
    setClearing(true);
    setClearResult(null);
    try {
      let data: Record<string, unknown>;
      if (simMode) {
        // In sim mode, just clear the local readings
        await new Promise(r => setTimeout(r, 500));
        data = { success: true };
        setReadings(prev => {
          if (!prev) return prev;
          const cleaned = { ...prev };
          Object.keys(cleaned).forEach(k => {
            if (k.startsWith("dtc_") || k === "active_dtc_count" || k.endsWith("_lamp")) delete cleaned[k];
          });
          cleaned.active_dtc_count = 0;
          return cleaned;
        });
      } else {
        const { sendTruckCommand } = await import("../lib/truck-viam");
        data = await sendTruckCommand("truck-engine", { command: "clear_dtcs" });
      }
      if (data.success) {
        setClearResult("DTCs cleared successfully");
      } else {
        setClearResult(`Failed: ${data.error || data.message || "Unknown error"}`);
      }
    } catch (err) {
      setClearResult(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setClearing(false);
      setTimeout(() => setClearResult(null), 5000);
    }
  };

  const busConnected = readings?._bus_connected === true;
  const frameCount = readings?._frame_count as number ?? 0;
  const secsSinceFrame = readings?._seconds_since_last_frame as number ?? -1;
  const dtcCount = readings?.active_dtc_count as number ?? 0;
  const hasData = readings && frameCount > 0;

  // Render a section of fields
  const renderFields = (
    fields: { key: string; label: string; highlight?: boolean }[],
    title: string,
    icon: string
  ) => {
    const available = fields.filter((f) => readings && readings[f.key] !== undefined);
    if (available.length === 0 && !hasData) {
      return (
        <div className="bg-gray-900/50 rounded-xl p-3 sm:p-4">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            {icon} {title}
          </h4>
          <p className="text-xs text-gray-600">Waiting for data...</p>
        </div>
      );
    }
    return (
      <div className="bg-gray-900/50 rounded-xl p-3 sm:p-4">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
          {icon} {title}
        </h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {fields.map((f) => {
            const val = readings?.[f.key];
            if (val === undefined) return null;
            const color =
              typeof val === "number" ? getValueColor(f.key, val) : "text-gray-100";
            return (
              <div key={f.key} className="flex justify-between items-baseline py-0.5">
                <span className="text-xs text-gray-500 truncate mr-2">{f.label}</span>
                <span
                  className={`text-xs font-mono font-bold ${color} ${
                    f.highlight ? "text-sm" : ""
                  }`}
                >
                  {formatValue(f.key, val)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-gray-900/30 rounded-2xl border border-gray-800 p-3 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg sm:text-xl">{vehicleMode === "truck" ? "\u{1F69B}" : "\u{1F697}"}</span>
          <div>
            <h3 className="text-sm sm:text-lg font-black tracking-widest uppercase text-gray-100">
              {vehicleMode === "truck" ? "Truck Diagnostics" : "Vehicle Diagnostics"}
            </h3>
            <p className="text-[10px] sm:text-xs text-gray-600">
              {vehicleMode === "truck" ? "J1939 CAN Bus — Heavy Duty" : "OBD-II CAN Bus — Live Data"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Vehicle mode toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button
              onClick={() => setVehicleMode("truck")}
              className={`px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors ${
                vehicleMode === "truck"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-500 hover:text-gray-300"
              }`}
            >
              Semi-Truck
            </button>
            <button
              onClick={() => setVehicleMode("car")}
              className={`px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors ${
                vehicleMode === "car"
                  ? "bg-green-600 text-white"
                  : "bg-gray-800 text-gray-500 hover:text-gray-300"
              }`}
            >
              Passenger
            </button>
          </div>
          {/* Connection status */}
          <div className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full ${
                busConnected
                  ? "bg-green-500"
                  : connected
                  ? "bg-yellow-500"
                  : "bg-red-500"
              }`}
            />
            <span className="text-[10px] text-gray-500">
              {busConnected
                ? `CAN OK (${frameCount} frames)`
                : connected
                ? "CAN bus down"
                : error || "Disconnected"}
            </span>
          </div>
        </div>
      </div>

      {/* Staleness warning */}
      {busConnected && secsSinceFrame > 5 && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-3 py-1.5 mb-3 text-[10px] sm:text-xs text-yellow-300">
          No CAN data for {secsSinceFrame.toFixed(0)}s — check connection
        </div>
      )}

      {/* DTC Alert Bar */}
      {dtcCount > 0 && (
        <div className="bg-red-950/50 border border-red-700/50 rounded-lg px-3 py-2 mb-3 flex items-center justify-between">
          <div>
            <span className="text-xs sm:text-sm font-bold text-red-300">
              {dtcCount} Active DTC{dtcCount > 1 ? "s" : ""}
            </span>
            <div className="flex gap-2 mt-1">
              {Object.entries(LAMP_NAMES).map(([key, name]) => {
                const val = readings?.[key] as number;
                if (!val || val === 0) return null;
                return (
                  <span
                    key={key}
                    className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      key === "red_stop_lamp"
                        ? "bg-red-700 text-white"
                        : key === "amber_warning_lamp"
                        ? "bg-yellow-700 text-white"
                        : "bg-orange-700 text-white"
                    }`}
                  >
                    {name}
                  </span>
                );
              })}
            </div>
          </div>
          <button
            onClick={handleClearDTCs}
            disabled={clearing}
            className={`min-h-[56px] px-6 py-3 rounded-xl text-sm sm:text-lg font-black uppercase tracking-wider transition-colors ${
              clearing
                ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                : "bg-red-700 hover:bg-red-600 text-white shadow-lg shadow-red-900/50"
            }`}
          >
            {clearing ? "CLEARING..." : "CLEAR DTCs"}
          </button>
        </div>
      )}

      {/* Clear result toast */}
      {clearResult && (
        <div
          className={`rounded-lg px-3 py-1.5 mb-3 text-xs ${
            clearResult.includes("success")
              ? "bg-green-900/30 border border-green-700/50 text-green-300"
              : "bg-red-900/30 border border-red-700/50 text-red-300"
          }`}
        >
          {clearResult}
        </div>
      )}

      {/* DTC Details */}
      {dtcCount > 0 && (
        <div className="bg-gray-900/50 rounded-2xl border border-red-800/30 p-4 sm:p-5 mb-3">
          <h4 className="text-sm sm:text-base font-black text-red-300 uppercase tracking-wider mb-3">
            Diagnostic Trouble Codes
          </h4>
          <div className="space-y-3">
            {Array.from({ length: Math.min(dtcCount, 5) }).map((_, i) => {
              const spn = readings?.[`dtc_${i}_spn`] as number;
              const fmi = readings?.[`dtc_${i}_fmi`] as number;
              const occ = readings?.[`dtc_${i}_occurrence`] as number;
              if (spn === undefined) return null;
              const spnInfo = lookupSPN(spn);
              const fmiText = lookupFMI(fmi);
              return (
                <div
                  key={i}
                  className="bg-red-950/40 border border-red-800/30 rounded-xl p-3 sm:p-4"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm sm:text-base font-bold text-red-300">
                      {spnInfo.name}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      spnInfo.severity === "critical" ? "bg-red-700 text-white" :
                      spnInfo.severity === "warning" ? "bg-yellow-700 text-white" :
                      "bg-blue-700 text-white"
                    }`}>
                      {spnInfo.severity.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mb-1">
                    SPN {spn} / FMI {fmi} — {fmiText}
                  </div>
                  <div className="text-xs text-gray-500 mb-2">
                    {spnInfo.description} (x{occ} occurrences)
                  </div>
                  <div className="text-xs sm:text-sm text-green-400 bg-green-950/30 rounded-lg px-3 py-2 border border-green-800/30">
                    <span className="font-bold">Fix: </span>{spnInfo.fix}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No DTC — show clear button anyway for manual clearing */}
      {dtcCount === 0 && busConnected && (
        <div className="flex items-center justify-between bg-green-950/20 border border-green-800/30 rounded-lg px-3 py-2 mb-3">
          <span className="text-xs text-green-400">No active trouble codes</span>
          <button
            onClick={handleClearDTCs}
            disabled={clearing}
            className="text-xs px-4 py-2 rounded-lg border border-gray-700 text-gray-500 hover:text-gray-300 transition-colors min-h-[44px]"
          >
            {clearing ? "Clearing..." : "Clear DTCs"}
          </button>
        </div>
      )}

      {/* Data Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
        {renderFields(
          vehicleMode === "car" ? CAR_ENGINE_FIELDS : ENGINE_FIELDS,
          "Engine", "\u2699\uFE0F"
        )}
        {renderFields(
          vehicleMode === "car" ? CAR_TEMP_FIELDS : TEMP_FIELDS,
          "Temperatures", "\u{1F321}\uFE0F"
        )}
        {renderFields(
          vehicleMode === "car" ? CAR_PRESSURE_FIELDS : PRESSURE_FIELDS,
          "Pressures", "\u{1F4CA}"
        )}
        {renderFields(
          vehicleMode === "car" ? CAR_VEHICLE_FIELDS : VEHICLE_FIELDS,
          "Vehicle", "\u{1F698}"
        )}
        {vehicleMode === "truck" && renderFields(TOTAL_FIELDS, "Lifetime", "\u{1F4C8}")}
      </div>

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
