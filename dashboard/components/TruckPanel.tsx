"use client";

import { lookupSPN, lookupFMI } from "../lib/spn-lookup";
import { lookupPCode } from "../lib/pcode-lookup";
import TrendChart from "./TrendChart";

import React, { useState, useEffect, useCallback } from "react";

interface TruckReadings {
  [key: string]: unknown;
}

const TRUCK_POLL_MS = 3000;

// Gauge thresholds for color coding
const THRESHOLDS: Record<string, { warn: number; crit: number; inverted?: boolean }> = {
  coolant_temp_f: { warn: 203, crit: 221 },
  oil_pressure_psi: { warn: 29, crit: 14.5, inverted: true },
  battery_voltage_v: { warn: 12.0, crit: 11.5, inverted: true },
  oil_temp_f: { warn: 230, crit: 266 },
  fuel_level_pct: { warn: 20, crit: 10, inverted: true },
  boost_pressure_psi: { warn: 36, crit: 43.5 },
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
    if (key.endsWith("_f")) return `${value.toFixed(0)}°F`;
    if (key.endsWith("_v")) return `${value.toFixed(1)}V`;
    if (key.endsWith("_psi")) return `${value.toFixed(1)} PSI`;
    if (key.endsWith("_mph")) return `${value.toFixed(0)} mph`;
    if (key.endsWith("_gph")) return `${value.toFixed(1)} gal/h`;
    if (key.endsWith("_mpg")) return `${value.toFixed(1)} mpg`;
    if (key === "engine_rpm") return `${value.toFixed(0)}`;
    if (key === "engine_hours") return `${value.toFixed(1)} hrs`;
    if (key === "total_fuel_used_gal") return `${value.toFixed(0)} gal`;
    if (key === "runtime_seconds") {
      const mins = Math.floor(value / 60);
      const secs = Math.floor(value % 60);
      return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    }
    if (key === "runtime_with_mil_min" || key === "time_since_clear_min") {
      const hrs = Math.floor(value / 60);
      const mins = Math.floor(value % 60);
      return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    }
    if (key === "distance_with_mil_mi" || key === "distance_since_clear_mi") return `${value.toFixed(1)} mi`;
    if (key === "timing_advance_deg") return `${value.toFixed(1)}°`;
    if (key === "maf_flow_gps") return `${value.toFixed(1)} g/s`;
    if (key === "commanded_equiv_ratio") return `${value.toFixed(3)}`;
    if (key === "evap_pressure_pa") return `${value.toFixed(0)} Pa`;
    if (key === "o2_voltage_b1s1_v") return `${value.toFixed(2)}V`;
    if (key === "warmup_cycles_since_clear") return `${value.toFixed(0)}`;
    if (key === "current_gear" || key === "selected_gear") {
      if (value === 0) return "N";
      if (value < 0) return "R";
      return `${value.toFixed(0)}`;
    }
    if (key === "estimated_mpg") return `${value.toFixed(1)} mpg`;
    if (key === "calc_fuel_rate_gph") return `${value.toFixed(2)} gal/h`;
    if (key === "rpm_stability_pct") return `${value.toFixed(0)}%`;
    if (key === "volumetric_efficiency_pct") return `${value.toFixed(0)}%`;
    if (key === "total_fuel_trim_b1_pct") return `${value.toFixed(1)}%`;
    if (key === "dtc_count_ecu") return `${value.toFixed(0)}`;
    if (key === "mil_on") return value ? "ON" : "OFF";
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
  { key: "coolant_temp_f", label: "Coolant Temp", highlight: true },
  { key: "oil_temp_f", label: "Oil" },
  { key: "fuel_temp_f", label: "Fuel" },
  { key: "intake_manifold_temp_f", label: "Intake" },
  { key: "trans_oil_temp_f", label: "Trans Oil" },
  { key: "ambient_temp_f", label: "Ambient" },
];

const PRESSURE_FIELDS = [
  { key: "oil_pressure_psi", label: "Oil Pressure", highlight: true },
  { key: "fuel_pressure_psi", label: "Fuel Pressure" },
  { key: "boost_pressure_psi", label: "Boost" },
  { key: "barometric_pressure_psi", label: "Baro" },
];

const VEHICLE_FIELDS = [
  { key: "vehicle_speed_mph", label: "Speed", highlight: true },
  { key: "current_gear", label: "Gear" },
  { key: "fuel_rate_gph", label: "Fuel Rate" },
  { key: "fuel_economy_mpg", label: "Fuel Economy" },
  { key: "fuel_level_pct", label: "Fuel Level" },
  { key: "battery_voltage_v", label: "Battery" },
  { key: "oil_level_pct", label: "Oil Level" },
];

const TOTAL_FIELDS = [
  { key: "engine_hours", label: "Engine Hours" },
  { key: "total_fuel_used_gal", label: "Total Fuel" },
];

// Car-specific field overrides — OBD-II returns different fields
const CAR_ENGINE_FIELDS = [
  { key: "engine_rpm", label: "Engine RPM", highlight: true },
  { key: "engine_load_pct", label: "Engine Load" },
  { key: "absolute_load_pct", label: "Absolute Load" },
  { key: "throttle_position_pct", label: "Throttle" },
  { key: "commanded_throttle_pct", label: "Commanded Throttle" },
  { key: "accel_pedal_pos_pct", label: "Accelerator Pedal" },
  { key: "timing_advance_deg", label: "Timing Advance" },
  { key: "maf_flow_gps", label: "MAF Flow" },
  { key: "commanded_equiv_ratio", label: "Air/Fuel Ratio" },
  { key: "total_fuel_trim_b1_pct", label: "Total Fuel Trim B1" },
  { key: "estimated_mpg", label: "Est. MPG" },
  { key: "volumetric_efficiency_pct", label: "Vol. Efficiency" },
  { key: "rpm_stability_pct", label: "RPM Stability" },
];

const CAR_TEMP_FIELDS = [
  { key: "coolant_temp_f", label: "Coolant", highlight: true },
  { key: "oil_temp_f", label: "Oil" },
  { key: "intake_air_temp_f", label: "Intake Air" },
  { key: "ambient_temp_f", label: "Ambient" },
  { key: "catalyst_temp_b1s1_f", label: "Catalytic Conv" },
];

const CAR_PRESSURE_FIELDS = [
  { key: "boost_pressure_psi", label: "Manifold Pressure", highlight: true },
  { key: "fuel_pressure_psi", label: "Fuel Rail" },
  { key: "fuel_pump_pressure_kpa", label: "Fuel Pump" },
  { key: "barometric_pressure_psi", label: "Barometric" },
  { key: "evap_pressure_pa", label: "EVAP System" },
];

const CAR_VEHICLE_FIELDS = [
  { key: "vehicle_speed_mph", label: "Speed", highlight: true },
  { key: "fuel_level_pct", label: "Fuel Level" },
  { key: "battery_voltage_v", label: "Battery" },
  { key: "runtime_seconds", label: "Engine Runtime" },
  { key: "o2_voltage_b1s1_v", label: "O2 Sensor B1S1" },
  { key: "estimated_mpg", label: "Est. MPG" },
];

const CAR_FUEL_FIELDS = [
  { key: "short_fuel_trim_b1_pct", label: "Short Fuel Trim B1" },
  { key: "long_fuel_trim_b1_pct", label: "Long Fuel Trim B1" },
  { key: "distance_with_mil_mi", label: "Distance w/ MIL" },
  { key: "distance_since_clear_mi", label: "Distance Since Clear" },
  { key: "time_since_clear_min", label: "Time Since Clear" },
  { key: "runtime_with_mil_min", label: "Runtime w/ MIL" },
  { key: "warmup_cycles_since_clear", label: "Warmups Since Clear" },
  { key: "short_fuel_trim_b2_pct", label: "Short Fuel Trim B2" },
  { key: "long_fuel_trim_b2_pct", label: "Long Fuel Trim B2" },
  { key: "calc_fuel_rate_gph", label: "Fuel Rate" },
  { key: "ethanol_fuel_pct", label: "Ethanol %" },
  { key: "mil_on", label: "Check Engine Light" },
  { key: "dtc_count_ecu", label: "ECU DTC Count" },
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

  // Advanced diagnostics state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [freezeFrame, setFreezeFrame] = useState<Record<string, any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [readiness, setReadiness] = useState<Record<string, any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pendingDTCs, setPendingDTCs] = useState<any[] | null>(null);
  const [vin, setVin] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState<string | null>(null);
  const [aiDiagnosis, setAiDiagnosis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  // Trend history — stores last 100 readings per metric
  const MAX_TREND_POINTS = 100;
  const [trendHistory, setTrendHistory] = useState<Record<string, { time: number; value: number }[]>>({});

  // Driver behavior scoring
  const [driverScore, setDriverScore] = useState(100);
  const driverEventsRef = React.useRef<{ type: string; time: number }[]>([]);
  const prevReadingsRef = React.useRef<TruckReadings | null>(null);

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
        coolant_temp_f: 185 + Math.sin(t * 0.02) * 14 + Math.random() * 4,
        oil_temp_f: 203 + Math.sin(t * 0.015) * 18,
        fuel_temp_f: 108 + Math.sin(t * 0.01) * 9,
        intake_manifold_temp_f: 131 + Math.sin(t * 0.03) * 18,
        trans_oil_temp_f: 176 + Math.sin(t * 0.02) * 14,
        ambient_temp_f: 72 + Math.random() * 4,
        oil_pressure_psi: 45 + Math.sin(t * 0.05) * 6 + Math.random() * 1.5,
        fuel_pressure_psi: 55 + Math.random() * 3,
        boost_pressure_psi: 23 + Math.sin(t * 0.08) * 6,
        barometric_pressure_psi: 14.7 + Math.random() * 0.07,
        vehicle_speed_mph: Math.round(speed * 0.621371 * 10) / 10,
        current_gear: speed < 5 ? 0 : Math.min(12, Math.floor(speed / 8) + 1),
        fuel_rate_gph: 4 + Math.sin(t * 0.06) * 2 + Math.random() * 0.5,
        fuel_economy_mpg: 5.9 + Math.sin(t * 0.04) * 1.9,
        fuel_level_pct: Math.max(10, 72 - t * 0.01),
        battery_voltage_v: 13.8 + Math.sin(t * 0.03) * 0.3,
        oil_level_pct: 85 + Math.random() * 3,
        engine_hours: 4523.5 + t * 0.001,
        total_fuel_used_gal: 33134 + t * 0.013,
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

  // Accumulate trend data and score driver behavior when readings change
  useEffect(() => {
    if (!readings) return;
    const now = Date.now();
    const trendKeys = ["engine_rpm", "coolant_temp_f", "oil_temp_f", "boost_pressure_psi", "battery_voltage_v", "vehicle_speed_mph", "throttle_position_pct", "fuel_level_pct"];

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

  // Generate PDF report with historical data
  const [reportLoading, setReportLoading] = useState(false);
  const generateReport = async () => {
    if (!readings) return;
    setReportLoading(true);
    const r = readings;
    const now = new Date().toLocaleString();
    const protocol = r._protocol === "obd2" ? "OBD-II" : "J1939";

    // Fetch historical data — try Viam Cloud first, fall back to Pi's local HTTP server
    let history: { totalPoints: number; totalMinutes: number; periodStart: string; periodEnd: string; source?: string; summary: Record<string, Record<string, number>>; dtcEvents: { timestamp: string; code: string }[] } | null = null;
    try {
      const resp = await fetch("/api/truck-history?hours=168");
      if (resp.ok) {
        const data = await resp.json();
        if (data.totalPoints > 0) history = data;
      }
    } catch { /* cloud unavailable */ }

    // Fallback: fetch directly from Pi's history server (reachable via Tailscale from browser)
    if (!history) {
      try {
        const resp = await fetch("http://100.113.196.68:8090?days=7", { signal: AbortSignal.timeout(15000) });
        if (resp.ok) {
          const data = await resp.json();
          if (data.totalPoints > 0) history = data;
        }
      } catch { /* Pi unreachable */ }
    }

    // Generate AI health summary using live readings + historical data
    let aiSummary = "";
    try {
      const aiResp = await fetch("/api/ai-report-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readings: r, history }),
      });
      if (aiResp.ok) {
        const aiData = await aiResp.json();
        aiSummary = aiData.summary || "";
      }
    } catch { /* AI summary is optional */ }
    setReportLoading(false);

    const fmtTime = (iso: string) => new Date(iso).toLocaleString();
    const fmtNum = (v: unknown, decimals = 1) => typeof v === "number" ? v.toFixed(decimals) : "—";

    // SVG trend chart generator for the report
    const makeSvgChart = (label: string, data: number[], timestamps: string[], unit: string, color: string, warnLine?: number) => {
      if (!data || data.length < 3) return "";
      const filtered: { v: number; t: string }[] = [];
      data.forEach((v, i) => { if (typeof v === "number") filtered.push({ v, t: timestamps[i] || "" }); });
      if (filtered.length < 3) return "";

      const w = 370, h = 130;
      const left = 55, right = 10, top = 8, bottom = 28; // margins for labels
      const chartW = w - left - right;
      const chartH = h - top - bottom;
      const minV = Math.min(...filtered.map(d => d.v));
      const maxV = Math.max(...filtered.map(d => d.v));
      const range = maxV - minV || 1;
      const avgV = filtered.reduce((a, d) => a + d.v, 0) / filtered.length;

      // Data polyline
      const points = filtered.map((d, i) => {
        const x = left + (i / (filtered.length - 1)) * chartW;
        const y = top + (1 - (d.v - minV) / range) * chartH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ");

      // Horizontal grid lines (min, avg, max)
      const yMin = top + chartH;
      const yMax = top;
      const yAvg = top + (1 - (avgV - minV) / range) * chartH;

      // Warning line
      let warnHtml = "";
      if (warnLine !== undefined && warnLine >= minV && warnLine <= maxV) {
        const yWarn = top + (1 - (warnLine - minV) / range) * chartH;
        warnHtml = `<line x1="${left}" y1="${yWarn}" x2="${left + chartW}" y2="${yWarn}" stroke="#ef4444" stroke-width="1" stroke-dasharray="4,3" /><text x="${left - 4}" y="${yWarn + 3}" font-size="8" fill="#ef4444" text-anchor="end">WARN</text>`;
      }

      // Time axis labels (start, middle, end)
      const fmtShort = (iso: string) => { try { const d = new Date(iso); return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
      const startLabel = fmtShort(filtered[0].t);
      const midLabel = fmtShort(filtered[Math.floor(filtered.length / 2)].t);
      const endLabel = fmtShort(filtered[filtered.length - 1].t);

      return `<div style="display:inline-block;margin:6px;vertical-align:top;width:${w}px;">
        <div style="font-size:12px;color:#1f2937;font-weight:700;margin-bottom:4px;">${label}</div>
        <svg width="${w}" height="${h}" style="background:#ffffff;border:1px solid #d1d5db;border-radius:8px;">
          <!-- Grid lines -->
          <line x1="${left}" y1="${yMax}" x2="${left + chartW}" y2="${yMax}" stroke="#e5e7eb" stroke-width="0.5" />
          <line x1="${left}" y1="${yAvg}" x2="${left + chartW}" y2="${yAvg}" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="3,3" />
          <line x1="${left}" y1="${yMin}" x2="${left + chartW}" y2="${yMin}" stroke="#e5e7eb" stroke-width="0.5" />
          <!-- Y-axis labels -->
          <text x="${left - 4}" y="${yMax + 4}" font-size="9" fill="#6b7280" text-anchor="end" font-family="monospace">${fmtNum(maxV)}${unit}</text>
          <text x="${left - 4}" y="${yAvg + 3}" font-size="9" fill="#9ca3af" text-anchor="end" font-family="monospace">${fmtNum(avgV)}${unit}</text>
          <text x="${left - 4}" y="${yMin}" font-size="9" fill="#6b7280" text-anchor="end" font-family="monospace">${fmtNum(minV)}${unit}</text>
          ${warnHtml}
          <!-- Data line -->
          <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" />
          <!-- Time axis -->
          <text x="${left}" y="${h - 6}" font-size="9" fill="#9ca3af">${startLabel}</text>
          <text x="${left + chartW / 2}" y="${h - 6}" font-size="9" fill="#9ca3af" text-anchor="middle">${midLabel}</text>
          <text x="${left + chartW}" y="${h - 6}" font-size="9" fill="#9ca3af" text-anchor="end">${endLabel}</text>
        </svg>
      </div>`;
    };

    const historySection = history && history.totalPoints > 0 ? `
<h2>Historical Data (Last ${history.totalMinutes} minutes — ${history.totalPoints} readings)</h2>
<p style="color:#6b7280;font-size:12px;">Source: ${history.source === "offline-buffer" ? "Pi Local Buffer" : "Viam Cloud"} | Period: ${fmtTime(history.periodStart)} to ${fmtTime(history.periodEnd)}</p>

<table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0;">
  <tr style="background:#f3f4f6;"><th style="text-align:left;padding:6px;">Parameter</th><th style="padding:6px;">Min</th><th style="padding:6px;">Avg</th><th style="padding:6px;">Max</th></tr>
  ${history.summary?.engine_rpm ? `<tr><td style="padding:4px 6px;">Engine RPM</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.engine_rpm.min, 0)}</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.engine_rpm.avg, 0)}</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.engine_rpm.max, 0)}</td></tr>` : ""}
  ${history.summary?.coolant_temp_f ? `<tr style="background:#fafafa;"><td style="padding:4px 6px;">Coolant Temp</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.coolant_temp_f.min)}°F</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.coolant_temp_f.avg)}°F</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.coolant_temp_f.max)}°F</td></tr>` : ""}
  ${history.summary?.oil_temp_f ? `<tr><td style="padding:4px 6px;">Oil Temp</td><td style="text-align:center;font-family:monospace;">—</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.oil_temp_f.avg)}°F</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.oil_temp_f.max)}°F</td></tr>` : ""}
  ${history.summary?.battery_voltage_v ? `<tr style="background:#fafafa;"><td style="padding:4px 6px;">Battery Voltage</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.battery_voltage_v.min, 2)}V</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.battery_voltage_v.avg, 2)}V</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.battery_voltage_v.max, 2)}V</td></tr>` : ""}
  ${history.summary?.vehicle_speed_mph ? `<tr><td style="padding:4px 6px;">Vehicle Speed</td><td style="text-align:center;font-family:monospace;">—</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.vehicle_speed_mph.avg)} mph</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.vehicle_speed_mph.max)} mph</td></tr>` : ""}
  ${history.summary?.short_fuel_trim_b1_pct ? `<tr style="background:#fafafa;"><td style="padding:4px 6px;">Short Fuel Trim B1</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.short_fuel_trim_b1_pct.min)}%</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.short_fuel_trim_b1_pct.avg)}%</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.short_fuel_trim_b1_pct.max)}%</td></tr>` : ""}
  ${history.summary?.long_fuel_trim_b1_pct ? `<tr><td style="padding:4px 6px;">Long Fuel Trim B1</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.long_fuel_trim_b1_pct.min)}%</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.long_fuel_trim_b1_pct.avg)}%</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.long_fuel_trim_b1_pct.max)}%</td></tr>` : ""}
  ${history.summary?.fuel_level_pct ? `<tr style="background:#fafafa;"><td style="padding:4px 6px;">Fuel Level</td><td colspan="2" style="text-align:center;font-family:monospace;">${fmtNum(history.summary.fuel_level_pct.start)}% → ${fmtNum(history.summary.fuel_level_pct.end)}%</td><td style="text-align:center;font-family:monospace;">${fmtNum(history.summary.fuel_level_pct.consumed)}% used</td></tr>` : ""}
</table>

${(history as Record<string, unknown>).timeSeries ? (() => {
  const ts = (history as Record<string, unknown>).timeSeries as Record<string, unknown>[];
  const times = ts.map(p => String(p.t || ""));
  return `
<h2>Trend Charts</h2>
<div style="display:flex;flex-wrap:wrap;justify-content:center;">
  ${makeSvgChart("Engine RPM", ts.map(p => Number(p.rpm || 0)), times, "", "#6366f1")}
  ${makeSvgChart("Coolant Temp", ts.map(p => Number(p.coolant_f || 0)), times, "°F", "#ef4444", 221)}
  ${makeSvgChart("Battery Voltage", ts.map(p => Number(p.battery_v || 0)), times, "V", "#3b82f6", 12)}
  ${makeSvgChart("Vehicle Speed", ts.map(p => Number(p.speed_mph || 0)), times, " mph", "#10b981")}
  ${makeSvgChart("Fuel Level", ts.map(p => Number(p.fuel_pct || 0)), times, "%", "#06b6d4")}
  ${makeSvgChart("Short Fuel Trim", ts.map(p => Number(p.short_trim || 0)), times, "%", "#f59e0b")}
</div>`;
})() : ""}

${history.dtcEvents && history.dtcEvents.length > 0 ? `
<h2>DTC Events During Period</h2>
${history.dtcEvents.map(e => `<div class="dtc"><span class="dtc-code">${e.code}</span> <span style="color:#6b7280;font-size:12px;">at ${fmtTime(e.timestamp)}</span></div>`).join("")}
` : ""}
` : `<h2>Historical Data</h2><p style="color:#9ca3af;">No historical data available from Viam Cloud for this period. Data capture is active and will be available in future reports.</p>`;

    const html = `<!DOCTYPE html>
<html><head><title>IronSight Vehicle Diagnostic Report</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #1a1a1a; }
  h1 { font-size: 24px; border-bottom: 3px solid #2563eb; padding-bottom: 8px; }
  h2 { font-size: 16px; color: #2563eb; margin-top: 24px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .badge { background: #2563eb; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .field { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f3f4f6; }
  .label { color: #6b7280; font-size: 13px; }
  .value { font-weight: bold; font-family: monospace; font-size: 13px; }
  .dtc { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin: 8px 0; }
  .dtc-code { font-weight: bold; color: #dc2626; font-size: 16px; }
  .footer { margin-top: 30px; padding-top: 10px; border-top: 2px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="header">
  <div>
    <h1>IronSight Vehicle Diagnostic Report</h1>
    <p style="color:#6b7280;margin:0;">Generated: ${now}</p>
    <p style="color:#6b7280;margin:4px 0;">Protocol: ${protocol} | Interface: ${r._can_interface || "can0"}</p>
  </div>
  <span class="badge">${r._bus_connected ? "LIVE" : "OFFLINE"}</span>
</div>

${r.vin ? `<p><strong>VIN:</strong> <span style="font-family:monospace">${r.vin}</span></p>` : ""}

<h2>Current Readings (Live Snapshot)</h2>

<h3 style="font-size:14px;color:#374151;margin-top:16px;">Engine</h3>
<div class="grid">
  ${[["RPM", r.engine_rpm, ""], ["Load", r.engine_load_pct, "%"], ["Throttle", r.throttle_position_pct, "%"], ["Timing Advance", r.timing_advance_deg, "\u00B0"], ["MAF Flow", r.maf_flow_gps, " g/s"], ["Air/Fuel Ratio", r.commanded_equiv_ratio, ""]].map(([l, v, u]) => v !== undefined ? `<div class="field"><span class="label">${l}</span><span class="value">${typeof v === "number" ? (v as number).toFixed(1) : v}${u}</span></div>` : "").join("")}
</div>

<h3 style="font-size:14px;color:#374151;margin-top:16px;">Temperatures</h3>
<div class="grid">
  ${[["Coolant", r.coolant_temp_f, "\u00B0F"], ["Oil", r.oil_temp_f, "\u00B0F"], ["Intake Air", r.intake_air_temp_f, "\u00B0F"], ["Ambient", r.ambient_temp_f, "\u00B0F"], ["Catalyst", r.catalyst_temp_b1s1_f, "\u00B0F"]].map(([l, v, u]) => v !== undefined ? `<div class="field"><span class="label">${l}</span><span class="value">${typeof v === "number" ? (v as number).toFixed(1) : v}${u}</span></div>` : "").join("")}
</div>

<h3 style="font-size:14px;color:#374151;margin-top:16px;">Pressures</h3>
<div class="grid">
  ${[["Manifold", r.boost_pressure_psi, " PSI"], ["Fuel Rail", r.fuel_pressure_psi, " PSI"], ["Barometric", r.barometric_pressure_psi, " PSI"]].map(([l, v, u]) => v !== undefined ? `<div class="field"><span class="label">${l}</span><span class="value">${typeof v === "number" ? (v as number).toFixed(1) : v}${u}</span></div>` : "").join("")}
</div>

<h3 style="font-size:14px;color:#374151;margin-top:16px;">Vehicle</h3>
<div class="grid">
  ${[["Speed", r.vehicle_speed_mph, " mph"], ["Fuel Level", r.fuel_level_pct, "%"], ["Battery", r.battery_voltage_v, "V"], ["Runtime", r.runtime_seconds, "s"]].map(([l, v, u]) => v !== undefined ? `<div class="field"><span class="label">${l}</span><span class="value">${typeof v === "number" ? (v as number).toFixed(1) : v}${u}</span></div>` : "").join("")}
</div>

<h3 style="font-size:14px;color:#374151;margin-top:16px;">Fuel System</h3>
<div class="grid">
  ${[["Short Fuel Trim B1", r.short_fuel_trim_b1_pct, "%"], ["Long Fuel Trim B1", r.long_fuel_trim_b1_pct, "%"], ["Distance w/ MIL", r.distance_with_mil_mi, " mi"], ["Distance Since Clear", r.distance_since_clear_mi, " mi"], ["Time Since Clear", r.time_since_clear_min, " min"], ["Warmups Since Clear", r.warmup_cycles_since_clear, ""]].map(([l, v, u]) => v !== undefined ? `<div class="field"><span class="label">${l}</span><span class="value">${typeof v === "number" ? (v as number).toFixed(1) : v}${u}</span></div>` : "").join("")}
</div>

<h2>Trouble Codes</h2>
${(r.active_dtc_count as number) > 0 ? Array.from({ length: Math.min(r.active_dtc_count as number, 5) }).map((_, i) => {
  const code = r[("obd2_dtc_" + i) as string] as string;
  return code ? `<div class="dtc"><span class="dtc-code">${code}</span></div>` : "";
}).join("") : "<p style='color:#16a34a'>No active trouble codes</p>"}

${historySection}

${aiSummary ? `<h2>AI Vehicle Health Summary</h2><div style="white-space:pre-wrap;font-size:13px;line-height:1.6;background:#f0f9ff;padding:16px;border-radius:8px;border:1px solid #bae6fd;">${aiSummary}</div>` : ""}

<div class="footer">
  <p>IronSight Fleet Diagnostics Platform | Data stored and queried from Viam Cloud</p>
  <p>Pi Zero 2W + MCP2515 CAN HAT | ${protocol} at ${r._can_interface || "can0"}</p>
</div>
</body></html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 500);
    }
  };

  const runDiagCommand = async (cmd: string) => {
    setDiagLoading(cmd);
    try {
      if (simMode) {
        await new Promise(r => setTimeout(r, 800));
        if (cmd === "get_freeze_frame") setFreezeFrame({ dtc_that_triggered: "P0420", engine_rpm: 2100, vehicle_speed_mph: 45, coolant_temp_f: 198, engine_load_pct: 67, throttle_pct: 35, timing_advance_deg: 14.5, intake_air_temp_f: 100, short_fuel_trim_pct: 2.3, long_fuel_trim_pct: -1.5 });
        if (cmd === "get_readiness") setReadiness({ ready_for_inspection: false, complete: ["Misfire", "Fuel System", "Components", "Catalyst"], incomplete: ["EVAP System", "O2 Sensor"], total_supported: 8, total_complete: 6, total_incomplete: 2 });
        if (cmd === "get_pending_dtcs") setPendingDTCs([{ code: "P0442", status: "pending" }]);
        if (cmd === "get_vin") setVin("1N4AL3AP8DC123456");
      } else {
        const { sendTruckCommand } = await import("../lib/truck-viam");
        const result = await sendTruckCommand("truck-engine", { command: cmd });
        if (cmd === "get_freeze_frame") setFreezeFrame(result.freeze_frame || {});
        if (cmd === "get_readiness") setReadiness(result.readiness || {});
        if (cmd === "get_pending_dtcs") setPendingDTCs(result.pending_dtcs || []);
        if (cmd === "get_vin") setVin(result.vin || "Not available");
      }
    } catch (err) {
      console.error(`Diag command ${cmd} failed:`, err);
    } finally {
      setDiagLoading(null);
    }
  };

  const runAiDiagnosis = async () => {
    if (!readings) return;
    setAiLoading(true);
    setAiDiagnosis(null);
    try {
      const resp = await fetch("/api/ai-diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readings }),
      });
      const data = await resp.json();
      if (data.success) {
        setAiDiagnosis(data.diagnosis);
      } else {
        setAiDiagnosis(`Error: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      setAiDiagnosis(`Failed: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setAiLoading(false);
    }
  };

  const sendChat = async (message?: string) => {
    const text = message || chatInput.trim();
    if (!text || !readings) return;
    setChatInput("");
    const userMsg = { role: "user", content: text };
    const updated = [...chatMessages, userMsg];
    setChatMessages(updated);
    setChatLoading(true);
    try {
      const resp = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated, readings }),
      });
      const data = await resp.json();
      if (data.success) {
        setChatMessages([...updated, { role: "assistant", content: data.reply }]);
      } else {
        setChatMessages([...updated, { role: "assistant", content: `Error: ${data.error}` }]);
      }
    } catch (err) {
      setChatMessages([...updated, { role: "assistant", content: `Failed: ${err instanceof Error ? err.message : "Unknown"}` }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
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

      {/* DTC Details — J1939 format (truck) */}
      {dtcCount > 0 && vehicleMode === "truck" && (
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

      {/* DTC Details — OBD-II P-codes (car) */}
      {dtcCount > 0 && vehicleMode === "car" && (
        <div className="bg-gray-900/50 rounded-2xl border border-red-800/30 p-4 sm:p-5 mb-3">
          <h4 className="text-sm sm:text-base font-black text-red-300 uppercase tracking-wider mb-3">
            OBD-II Trouble Codes
          </h4>
          <div className="space-y-3">
            {Array.from({ length: Math.min(dtcCount, 5) }).map((_, i) => {
              const code = readings?.[`obd2_dtc_${i}`] as string;
              if (!code) return null;
              const info = lookupPCode(code);
              return (
                <div
                  key={i}
                  className="bg-red-950/40 border border-red-800/30 rounded-xl p-3 sm:p-4"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm sm:text-base font-bold text-red-300">
                      {info.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-red-200 bg-red-900/50 px-2 py-0.5 rounded">
                        {code}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        info.severity === "critical" ? "bg-red-700 text-white" :
                        info.severity === "warning" ? "bg-yellow-700 text-white" :
                        "bg-blue-700 text-white"
                      }`}>
                        {info.severity.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mb-2">
                    {info.description}
                  </div>
                  <div className="text-xs sm:text-sm text-green-400 bg-green-950/30 rounded-lg px-3 py-2 border border-green-800/30">
                    <span className="font-bold">Fix: </span>{info.fix}
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
        {vehicleMode === "car" && renderFields(CAR_FUEL_FIELDS, "Diagnostics", "\u{1F527}")}
      </div>

      {/* Report Button */}
      {busConnected && (
        <div className="flex justify-end mt-3">
          <button
            onClick={generateReport}
            disabled={reportLoading}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-blue-900/50 hover:bg-blue-800 text-blue-300 border border-blue-700/50 transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {reportLoading ? "Loading history..." : "\u{1F4C4} Generate Report"}
          </button>
        </div>
      )}

      {/* Trend Charts */}
      {busConnected && Object.keys(trendHistory).length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            {"\u{1F4C8}"} Live Trends
          </h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <TrendChart label="RPM" data={trendHistory.engine_rpm || []} color="#818cf8" />
            <TrendChart label="Coolant" data={trendHistory.coolant_temp_f || []} unit="°F" color="#f87171" warnThreshold={203} critThreshold={221} />
            <TrendChart label="Speed" data={trendHistory.vehicle_speed_mph || []} unit=" mph" color="#34d399" />
            <TrendChart label="Throttle" data={trendHistory.throttle_position_pct || []} unit="%" color="#fbbf24" />
            <TrendChart label="Battery" data={trendHistory.battery_voltage_v || []} unit="V" color="#60a5fa" warnThreshold={12} critThreshold={11.5} inverted />
            <TrendChart label="Oil Temp" data={trendHistory.oil_temp_f || []} unit="°F" color="#fb923c" warnThreshold={230} critThreshold={266} />
            <TrendChart label="Manifold" data={trendHistory.boost_pressure_psi || []} unit=" PSI" color="#a78bfa" />
            <TrendChart label="Fuel Level" data={trendHistory.fuel_level_pct || []} unit="%" color="#2dd4bf" warnThreshold={20} critThreshold={10} inverted />
          </div>
        </div>
      )}

      {/* On-Demand Diagnostic Tools — Car mode only */}
      {vehicleMode === "car" && busConnected && (
        <div className="bg-gray-900/50 rounded-2xl border border-blue-800/30 p-4 sm:p-5 mt-3">
          <h4 className="text-sm sm:text-base font-black text-blue-300 uppercase tracking-wider mb-3">
            On-Demand Diagnostics
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {[
              { cmd: "get_freeze_frame", label: "Freeze Frame", icon: "\u{1F4F7}" },
              { cmd: "get_readiness", label: "Readiness", icon: "\u2705" },
              { cmd: "get_pending_dtcs", label: "Pending DTCs", icon: "\u26A0\uFE0F" },
              { cmd: "get_vin", label: "Pull VIN", icon: "\u{1F50D}" },
            ].map(({ cmd, label, icon }) => (
              <button
                key={cmd}
                onClick={() => runDiagCommand(cmd)}
                disabled={diagLoading !== null}
                className={`px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                  diagLoading === cmd
                    ? "bg-blue-800 text-blue-200 animate-pulse"
                    : "bg-blue-900/50 hover:bg-blue-800 text-blue-300 border border-blue-700/50"
                }`}
              >
                {icon} {diagLoading === cmd ? "Querying..." : label}
              </button>
            ))}
          </div>

          {/* VIN Result */}
          {vin && (
            <div className="bg-gray-800/50 rounded-lg px-3 py-2 mb-2">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">Vehicle ID</span>
              <p className="text-sm font-mono font-bold text-gray-100">{vin}</p>
            </div>
          )}

          {/* Readiness Monitors Result */}
          {readiness && (
            <div className="bg-gray-800/50 rounded-lg px-3 py-3 mb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-400 uppercase">Emission Readiness Monitors</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  readiness.ready_for_inspection
                    ? "bg-green-700 text-white"
                    : "bg-yellow-700 text-white"
                }`}>
                  {readiness.ready_for_inspection ? "READY FOR INSPECTION" : "NOT READY"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(readiness.complete || []).map((m: string) => (
                  <div key={m} className="flex items-center gap-1.5 text-xs">
                    <span className="text-green-400">{"\u2705"}</span>
                    <span className="text-gray-300">{m}</span>
                  </div>
                ))}
                {(readiness.incomplete || []).map((m: string) => (
                  <div key={m} className="flex items-center gap-1.5 text-xs">
                    <span className="text-yellow-400">{"\u23F3"}</span>
                    <span className="text-yellow-300">{m}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-600 mt-2">
                {readiness.total_complete}/{readiness.total_supported} monitors complete
              </p>
            </div>
          )}

          {/* Freeze Frame Result */}
          {freezeFrame && Object.keys(freezeFrame).length > 0 && (
            <div className="bg-gray-800/50 rounded-lg px-3 py-3 mb-2">
              <span className="text-xs font-bold text-gray-400 uppercase">
                Freeze Frame — Snapshot when {freezeFrame.dtc_that_triggered || "DTC"} was set
              </span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                {Object.entries(freezeFrame).map(([key, val]) => {
                  if (key === "dtc_that_triggered") return null;
                  return (
                    <div key={key} className="flex justify-between text-xs py-0.5">
                      <span className="text-gray-500">{key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                      <span className="font-mono font-bold text-gray-200">{formatValue(key, val as number)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pending DTCs Result */}
          {pendingDTCs && (
            <div className="bg-gray-800/50 rounded-lg px-3 py-2 mb-2">
              <span className="text-xs font-bold text-gray-400 uppercase">Pending Trouble Codes</span>
              {pendingDTCs.length === 0 ? (
                <p className="text-xs text-green-400 mt-1">No pending codes — all clear</p>
              ) : (
                <div className="mt-1 space-y-1">
                  {pendingDTCs.map((dtc: { code: string }, i: number) => {
                    const info = lookupPCode(dtc.code);
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-yellow-300">{dtc.code}</span>
                        <span className="text-gray-400">{info.name}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* AI Mechanic — Chat Interface */}
      {busConnected && (
        <div className="bg-gray-900/50 rounded-2xl border border-purple-800/30 p-4 sm:p-5 mt-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">{"\u{1F9E0}"}</span>
              <div>
                <h4 className="text-sm sm:text-base font-black text-purple-300 uppercase tracking-wider">
                  AI Mechanic
                </h4>
                <p className="text-[10px] text-gray-600">
                  Ask anything — Claude sees live vehicle data in real-time
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {!chatOpen && (
                <button
                  onClick={runAiDiagnosis}
                  disabled={aiLoading}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors ${
                    aiLoading
                      ? "bg-purple-900 text-purple-400 animate-pulse"
                      : "bg-purple-700 hover:bg-purple-600 text-white"
                  }`}
                >
                  {aiLoading ? "Analyzing..." : "Full Diagnosis"}
                </button>
              )}
              <button
                onClick={() => setChatOpen(!chatOpen)}
                className={`px-3 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors ${
                  chatOpen
                    ? "bg-purple-600 text-white"
                    : "bg-purple-900/50 text-purple-300 border border-purple-700/50 hover:bg-purple-800"
                }`}
              >
                {chatOpen ? "Close Chat" : "Ask AI"}
              </button>
            </div>
          </div>

          {/* Full diagnosis result */}
          {aiDiagnosis && !chatOpen && (
            <div className="bg-gray-800/70 rounded-xl p-4 sm:p-5 border border-purple-800/20">
              <div className="text-xs sm:text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                {aiDiagnosis}
              </div>
            </div>
          )}

          {/* Chat interface */}
          {chatOpen && (
            <div className="flex flex-col">
              {/* Quick question buttons */}
              {chatMessages.length === 0 && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {[
                    "What could be causing these trouble codes?",
                    "Walk me through what the data is showing right now",
                    "What should I check first based on these readings?",
                    "Are there any readings trending in a bad direction?",
                    "Explain the fuel trim readings",
                    "What questions should I be asking about this vehicle's history?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => sendChat(q)}
                      className="px-3 py-2 rounded-lg text-[10px] sm:text-xs text-left text-purple-300 bg-purple-950/30 border border-purple-800/30 hover:bg-purple-900/50 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}

              {/* Chat messages */}
              <div className="max-h-96 overflow-y-auto space-y-3 mb-3">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`rounded-xl p-3 ${
                      msg.role === "user"
                        ? "bg-purple-900/30 border border-purple-800/30 ml-8"
                        : "bg-gray-800/70 border border-gray-700/30 mr-4"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        {msg.role === "user" ? "You" : "\u{1F9E0} AI Mechanic"}
                      </span>
                    </div>
                    <div className="text-xs sm:text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="bg-gray-800/70 rounded-xl p-3 mr-4 border border-gray-700/30">
                    <span className="text-xs text-purple-400 animate-pulse">AI Mechanic is thinking...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !chatLoading && sendChat()}
                  placeholder="Ask about this vehicle's health, repairs, costs..."
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs sm:text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-600"
                  disabled={chatLoading}
                />
                <button
                  onClick={() => sendChat()}
                  disabled={chatLoading || !chatInput.trim()}
                  className={`px-4 py-2 rounded-lg text-xs font-bold uppercase transition-colors ${
                    chatLoading || !chatInput.trim()
                      ? "bg-gray-700 text-gray-500"
                      : "bg-purple-700 hover:bg-purple-600 text-white"
                  }`}
                >
                  Send
                </button>
              </div>

              {/* Clear chat */}
              {chatMessages.length > 0 && (
                <button
                  onClick={() => setChatMessages([])}
                  className="text-[10px] text-gray-600 hover:text-gray-400 mt-2 self-end"
                >
                  Clear conversation
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
