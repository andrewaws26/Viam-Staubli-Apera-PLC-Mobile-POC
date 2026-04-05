"use client";

/**
 * TruckPanel — Orchestrator for truck/vehicle diagnostics dashboard.
 *
 * This component handles data fetching, polling, trend accumulation,
 * driver behavior scoring, and layout. Display logic is delegated to:
 *   - GaugeGrid: Sensor reading cards with threshold coloring
 *   - DTCPanel: Diagnostic Trouble Code display, clearing, on-demand diagnostics
 *   - AIChatPanel: AI mechanic chat + full diagnosis
 *   - TrendChart: Historical trend sparklines
 *   - TruckMap: GPS position on Leaflet map
 *
 * Future panels (Staubli robot, Apera vision, dash cam) should follow
 * the same pattern: self-contained component with props from TruckPanel.
 */

import TrendChart from "./TrendChart";
import AIChatPanel from "./AIChatPanel";
import DTCPanel from "./DTCPanel";
import GaugeGrid from "./GaugeGrid";
import dynamic from "next/dynamic";

const TruckMap = dynamic(() => import("./TruckMap"), { ssr: false });

import React, { useState, useEffect, useCallback } from "react";

interface TruckReadings {
  [key: string]: unknown;
}

const TRUCK_POLL_MS = 3000;

type VehicleMode = "truck" | "car";

export default function TruckPanel({ simMode = false }: { simMode?: boolean }) {
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
        const resp = await fetch(`/api/truck-history?hours=168${vinParam}`);
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
  }, [simMode, selectedHistoryVin]);

  // Advanced diagnostics state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any

  const MAX_TREND_POINTS = 100;
  const [trendHistory, setTrendHistory] = useState<Record<string, { time: number; value: number }[]>>({});

  // Driver behavior scoring
  const [driverScore, setDriverScore] = useState(100);

  // DTC alert flash state
  const [prevDtcCount, setPrevDtcCount] = useState(0);
  const [dtcFlash, setDtcFlash] = useState(false);
  const driverEventsRef = React.useRef<{ type: string; time: number }[]>([]);
  const prevReadingsRef = React.useRef<TruckReadings | null>(null);

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
      const resp = await fetch("/api/truck-readings?component=truck-engine");
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
  }, [simMode]);

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
  }, [readings, prevDtcCount]);

  // Generate PDF report with historical data
  const [reportLoading, setReportLoading] = useState(false);
  const generateReport = async () => {
    setReportLoading(true);
    const r = readings || {} as Record<string, unknown>;
    const now = new Date().toLocaleString();
    const protocol = (r._protocol === "obd2" ? "OBD-II" : r._protocol === "j1939" ? "J1939" : "OBD-II");

    // Fetch historical data — try client SDK, then cloud, then cache
    let history: { totalPoints: number; totalMinutes: number; periodStart: string; periodEnd: string; source?: string; summary: Record<string, Record<string, number>>; dtcEvents: { timestamp: string; code: string }[] } | null = null;

    // Fetch from Viam Cloud Data API
    if (!history) {
      try {
        const resp = await fetch("/api/truck-history?hours=168");
        if (resp.ok) {
          const data = await resp.json();
          if (data.totalPoints > 0) history = data;
        }
      } catch { /* cloud unavailable */ }
    }

    // Final fallback: cached historical data from localStorage
    if (!history && cachedHistory && (cachedHistory as Record<string, unknown>).totalPoints) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      history = cachedHistory as any;
      if (history) (history as Record<string, unknown>).source = "cached";
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
<p style="color:#6b7280;font-size:12px;">Source: ${history.source === "cached" ? "Cached (last successful fetch" + ((history as Record<string, unknown>)._cachedAt ? " at " + fmtTime(String((history as Record<string, unknown>)._cachedAt)) : "") + ")" : history.source === "offline-buffer" ? "Pi Local Buffer" : "Viam Cloud"} | Period: ${fmtTime(history.periodStart)} to ${fmtTime(history.periodEnd)}</p>

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

${(r.vehicle_vin || r.vin) ? `<p><strong>VIN:</strong> <span style="font-family:monospace">${r.vehicle_vin || r.vin}</span></p>` : ""}

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
  const gpsHeading = readings?.compass_bearing_deg as number ?? null;
  const gpsSpeed = readings?.nav_speed_mph as number ?? null;
  const gpsAlt = readings?.altitude_ft as number ?? null;

  // Render a section of fields

  return (
    <div className="bg-gray-900/30 rounded-2xl border border-gray-800 p-3 sm:p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 sm:mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg sm:text-xl">{vehicleMode === "truck" ? "\u{1F69B}" : "\u{1F697}"}</span>
          <div className="min-w-0">
            <h3 className="text-sm sm:text-lg font-black tracking-widest uppercase text-gray-100 truncate">
              {vehicleMode === "truck" ? "Truck Diagnostics" : "Vehicle Diagnostics"}
            </h3>
            <p className="text-[10px] sm:text-xs text-gray-600 truncate">
              {vehicleMode === "truck" ? "J1939 CAN Bus — Heavy Duty" : "OBD-II CAN Bus — Live Data"}
            </p>
            {readings?.vehicle_vin && String(readings.vehicle_vin) !== "UNKNOWN" && String(readings.vehicle_vin) !== "0" ? (
              <p className="text-[10px] sm:text-xs text-blue-400 font-mono tracking-wider truncate">
                VIN: {String(readings.vehicle_vin)}
              </p>
            ) : readings?.vehicle_vin === "UNKNOWN" ? (
              <p className="text-[10px] sm:text-xs text-gray-600 italic">VIN: Unknown</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Vehicle history VIN selector */}
          {historyVins.length > 1 && (
            <select
              value={selectedHistoryVin}
              onChange={(e) => setSelectedHistoryVin(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-300 text-[10px] sm:text-xs rounded px-1.5 py-2 min-h-[44px] focus:outline-none focus:border-blue-500"
              title="Filter history by vehicle"
            >
              <option value="">All Vehicles</option>
              {historyVins.map((v) => (
                <option key={v} value={v}>
                  {v.length === 17 ? `...${v.slice(-6)}` : v}
                </option>
              ))}
            </select>
          )}
          {/* Vehicle mode toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            <button
              onClick={() => setVehicleMode("truck")}
              className={`px-2 sm:px-3 py-2 min-h-[44px] text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors ${
                vehicleMode === "truck"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-500 hover:text-gray-300"
              }`}
            >
              <span className="hidden sm:inline">Semi-</span>Truck
            </button>
            <button
              onClick={() => setVehicleMode("car")}
              className={`px-2 sm:px-3 py-2 min-h-[44px] text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-colors ${
                vehicleMode === "car"
                  ? "bg-green-600 text-white"
                  : "bg-gray-800 text-gray-500 hover:text-gray-300"
              }`}
            >
              <span className="hidden sm:inline">Passenger</span><span className="sm:hidden">Car</span>
            </button>
          </div>
          {/* Connection status */}
          <div className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${
                busConnected
                  ? "bg-green-500"
                  : connected
                  ? "bg-yellow-500"
                  : "bg-red-500"
              }`}
            />
            <span className="text-[10px] text-gray-500 whitespace-nowrap">
              {busConnected
                ? `CAN OK (${frameCount} frames)`
                : connected
                ? "CAN bus down"
                : error || "Disconnected"}
            </span>
          </div>
        </div>
      </div>

      {/* Vehicle State + Alerts Bar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* State Badge */}
        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
          vehicleState === "Engine On" ? "bg-green-600 text-white" :
          vehicleState === "Ignition On" ? "bg-yellow-600 text-white" :
          vehicleState === "Truck Off" ? "bg-gray-700 text-gray-300" :
          "bg-red-800 text-white"
        }`}>
          {vehicleState}
        </span>

        {/* Idle Waste Alert */}
        {idleWaste && (
          <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-orange-600/30 text-orange-300 border border-orange-600/50">
            IDLE WASTE
          </span>
        )}

        {/* Harsh Behavior Alert */}
        {harshBehavior && (
          <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-red-600/30 text-red-300 border border-red-600/50 animate-pulse">
            HARSH EVENT
          </span>
        )}

        {/* Lamp Indicator Badges — always visible when active */}
        {(readings?.malfunction_lamp as number) > 0 && (
          <span className="px-2 py-1 rounded-full text-xs font-bold bg-yellow-600 text-white animate-pulse shadow-lg shadow-yellow-600/30">
            CHECK ENGINE
          </span>
        )}
        {(readings?.amber_warning_lamp as number) > 0 && (
          <span className="px-2 py-1 rounded-full text-xs font-bold bg-amber-500 text-white animate-pulse shadow-lg shadow-amber-500/30">
            WARNING
          </span>
        )}
        {(readings?.red_stop_lamp as number) > 0 && (
          <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-600 text-white animate-pulse shadow-lg shadow-red-600/30">
            STOP
          </span>
        )}
        {(readings?.protect_lamp as number) > 0 && (
          <span className="px-2 py-1 rounded-full text-xs font-bold bg-orange-500 text-white animate-pulse shadow-lg shadow-orange-500/30">
            PROTECT
          </span>
        )}

        {/* DTC flash alert — appears briefly when DTCs first appear */}
        {dtcFlash && (
          <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-500 text-white animate-bounce shadow-lg shadow-red-500/50">
            NEW DTC DETECTED
          </span>
        )}
      </div>

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


      {/* ── DTC Display & Management (extracted to DTCPanel) ── */}
      <DTCPanel
        readings={readings}
        vehicleMode={vehicleMode}
        busConnected={busConnected}
        dtcCount={dtcCount}
        simMode={simMode}
        setReadings={setReadings}
      />

      {/* ── Sensor Gauges by category (extracted to GaugeGrid) ── */}
      <GaugeGrid readings={readings} vehicleMode={vehicleMode} hasData={!!hasData} />

      {/* Report Button — always visible, historical data works without live CAN */}
      {(
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
            <TrendChart label="SCR Efficiency" data={trendHistory.scr_efficiency_pct || []} unit="%" color="#10b981" warnThreshold={80} critThreshold={50} inverted />
            <TrendChart label="DEF Level" data={trendHistory.def_level_pct || []} unit="%" color="#06b6d4" warnThreshold={15} critThreshold={5} inverted />
          </div>
        </div>
      )}


      {/* ── AI Mechanic Chat (extracted to AIChatPanel) ── */}
      {busConnected && readings && (
        <AIChatPanel readings={readings} vehicleMode={vehicleMode} />
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
