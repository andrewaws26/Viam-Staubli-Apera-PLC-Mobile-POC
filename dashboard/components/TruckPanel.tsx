"use client";

import { useState, useEffect, useCallback } from "react";

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
    if (key.includes("_c") && !key.includes("count")) return `${value.toFixed(1)}°C`;
    if (key.includes("_v")) return `${value.toFixed(1)}V`;
    if (key.includes("_kpa")) return `${value.toFixed(0)} kPa`;
    if (key.includes("_kmh")) return `${value.toFixed(1)} km/h`;
    if (key.includes("_lph")) return `${value.toFixed(1)} L/h`;
    if (key.includes("_km_l")) return `${value.toFixed(2)} km/L`;
    if (key === "engine_rpm") return `${value.toFixed(0)}`;
    if (key === "engine_hours") return `${value.toFixed(1)} hrs`;
    if (key === "total_fuel_used_l") return `${value.toFixed(0)} L`;
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
  { key: "coolant_temp_c", label: "Coolant", highlight: true },
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

const LAMP_NAMES: Record<string, string> = {
  malfunction_lamp: "MIL",
  red_stop_lamp: "STOP",
  amber_warning_lamp: "WARN",
  protect_lamp: "PROT",
};

export default function TruckPanel() {
  const [readings, setReadings] = useState<TruckReadings | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  const fetchReadings = useCallback(async () => {
    try {
      const res = await fetch("/api/truck-readings?component=truck-engine");
      if (res.status === 404) {
        setConnected(false);
        setError("Truck sensor not configured");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setReadings(data);
      setConnected(true);
      setError(null);
    } catch (err) {
      setConnected(false);
      setError(err instanceof Error ? err.message : "Connection error");
    }
  }, []);

  useEffect(() => {
    fetchReadings();
    const id = setInterval(fetchReadings, TRUCK_POLL_MS);
    return () => clearInterval(id);
  }, [fetchReadings]);

  const handleClearDTCs = async () => {
    setClearing(true);
    setClearResult(null);
    try {
      const res = await fetch("/api/truck-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "clear_dtcs" }),
      });
      const data = await res.json();
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
          <span className="text-lg sm:text-xl">&#x1F69B;</span>
          <div>
            <h3 className="text-sm sm:text-lg font-black tracking-widest uppercase text-gray-100">
              Truck Diagnostics
            </h3>
            <p className="text-[10px] sm:text-xs text-gray-600">
              J1939 CAN Bus — OBD-II Live Data
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
            className={`min-h-[44px] px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors ${
              clearing
                ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                : "bg-red-700 hover:bg-red-600 text-white"
            }`}
          >
            {clearing ? "Clearing..." : "Clear DTCs"}
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
        <div className="bg-gray-900/50 rounded-xl p-3 sm:p-4 mb-3">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            Diagnostic Trouble Codes
          </h4>
          <div className="space-y-1">
            {Array.from({ length: Math.min(dtcCount, 5) }).map((_, i) => {
              const spn = readings?.[`dtc_${i}_spn`] as number;
              const fmi = readings?.[`dtc_${i}_fmi`] as number;
              const occ = readings?.[`dtc_${i}_occurrence`] as number;
              if (spn === undefined) return null;
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 text-xs bg-red-950/30 rounded-lg px-3 py-1.5"
                >
                  <span className="text-red-400 font-mono font-bold">
                    SPN {spn}
                  </span>
                  <span className="text-gray-400">FMI {fmi}</span>
                  <span className="text-gray-500">x{occ}</span>
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
            className="text-[10px] px-3 py-1.5 rounded border border-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
          >
            {clearing ? "Clearing..." : "Clear DTCs"}
          </button>
        </div>
      )}

      {/* Data Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
        {renderFields(ENGINE_FIELDS, "Engine", "\u2699\uFE0F")}
        {renderFields(TEMP_FIELDS, "Temperatures", "\u{1F321}\uFE0F")}
        {renderFields(PRESSURE_FIELDS, "Pressures", "\u{1F4CA}")}
        {renderFields(VEHICLE_FIELDS, "Vehicle", "\u{1F698}")}
        {renderFields(TOTAL_FIELDS, "Lifetime", "\u{1F4C8}")}
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
