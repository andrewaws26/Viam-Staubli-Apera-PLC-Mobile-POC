"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";

const ShiftRouteMap = dynamic(() => import("../../components/ShiftRouteMap"), { ssr: false });

// ---------------------------------------------------------------------------
// Timezone constant — all times displayed in Louisville, KY
// ---------------------------------------------------------------------------
const TZ = "America/New_York";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShiftAlert {
  level: "warning" | "critical";
  message: string;
  timestamp: string;
  value?: number;
}

interface Trip {
  startTime: string;
  endTime: string;
  durationMin: number;
}

interface DtcEvent {
  code: string;
  firstSeen: string;
}

interface TimeSeriesPoint {
  t: string;
  rpm: number;
  coolant_f: number;
  speed_mph: number;
  battery_v: number;
  oil_f: number;
}

interface RoutePoint {
  lat: number;
  lon: number;
  t: string;
}

interface Stop {
  lat: number;
  lon: number;
  t: string;
  durationMin: number;
}

interface RouteData {
  hasGps: boolean;
  points: RoutePoint[];
  startLocation: { lat: number; lon: number } | null;
  endLocation: { lat: number; lon: number } | null;
  distanceMiles: number;
  distanceSource: "gps" | "speed_estimate";
  stops: Stop[];
  movingMinutes: number;
  stoppedMinutes: number;
}

interface ShiftReport {
  date: string;
  periodStart: string;
  periodEnd: string;
  truckId: string;
  timezone: string;
  engineHours: number;
  idleHours: number;
  idlePercent: number;
  totalPlates: number;
  platesPerHour: number;
  ejectFailures: number;
  peakCoolantTemp: { value: number; timestamp: string } | null;
  peakOilTemp: { value: number; timestamp: string } | null;
  minBatteryVoltage: { value: number; timestamp: string } | null;
  dtcEvents: DtcEvent[];
  trips: Trip[];
  alerts: ShiftAlert[];
  route: RouteData;
  timeSeries: TimeSeriesPoint[];
  dataPointCount: { tps: number; truck: number };
  hasTpsData: boolean;
  hasTruckData: boolean;
}

// ---------------------------------------------------------------------------
// Presets for quick-select pills
// ---------------------------------------------------------------------------

interface TimePreset {
  id: string;
  label: string;
  sub: string;
  sh: number;
  sm: number;
  eh: number;
  em: number;
}

const PRESETS: TimePreset[] = [
  { id: "day",   label: "Day Shift",  sub: "6A – 6P", sh: 6,  sm: 0, eh: 18, em: 0 },
  { id: "night", label: "Night Shift", sub: "6P – 6A", sh: 18, sm: 0, eh: 6,  em: 0 },
  { id: "full",  label: "Full Day",   sub: "12A – 12A", sh: 0,  sm: 0, eh: 0,  em: 0 },
];

function matchPreset(sh: number, sm: number, eh: number, em: number): string {
  for (const p of PRESETS) {
    if (p.sh === sh && p.sm === sm && p.eh === eh && p.em === em) return p.id;
  }
  return "custom";
}

/** Convert HH:MM string to { h, m } */
function parseTimeInput(val: string): { h: number; m: number } {
  const [h, m] = val.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

/** Convert hours+minutes to HH:MM for input value */
function toTimeInput(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Format hours+minutes as readable time */
function fmtHM(h: number, m: number): string {
  const date = new Date(2000, 0, 1, h, m);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

// ---------------------------------------------------------------------------
// SVG Sparkline Chart (lightweight, no dependencies)
// ---------------------------------------------------------------------------

function Sparkline({
  data,
  color,
  label,
  unit,
  width = 600,
  height = 200,
}: {
  data: { t: string; v: number }[];
  color: string;
  label: string;
  unit: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;

  const values = data.map((d) => d.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const padL = 4;
  const padR = 16;
  const padY = 4;
  const labelH = 24;
  const plotW = width - padL - padR;
  const plotH = height - padY * 2 - labelH;

  const points = data
    .map((d, i) => {
      const x = padL + (i / (data.length - 1)) * plotW;
      const y = padY + plotH - ((d.v - min) / range) * plotH;
      return `${x},${y}`;
    })
    .join(" ");

  const firstTime = fmtTime(data[0].t);
  const lastTime = fmtTime(data[data.length - 1].t);

  return (
    <div className="print-chart">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs text-gray-400 font-medium">{label}</span>
        <span className="text-xs text-gray-500">
          {Math.round(min)}{unit} — {Math.round(max)}{unit}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full print-hide-svg"
        preserveAspectRatio="xMidYMid meet"
        style={{ height: height, maxHeight: height }}
      >
        {/* Horizontal grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => {
          const y = padY + plotH - frac * plotH;
          return <line key={frac} x1={padL} y1={y} x2={padL + plotW} y2={y} stroke="#374151" strokeWidth="0.5" />;
        })}
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
        {/* Time labels */}
        <text x={padL} y={height - 4} fontSize="11" fill="#6b7280">{firstTime}</text>
        <text x={padL + plotW} y={height - 4} fontSize="11" fill="#6b7280" textAnchor="end">{lastTime}</text>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Print-only data table (replaces SVG charts in print)
// ---------------------------------------------------------------------------

function PrintDataTable({ timeSeries }: { timeSeries: TimeSeriesPoint[] }) {
  if (timeSeries.length === 0) return null;

  // Sample ~20 rows evenly for a clean table
  const step = Math.max(1, Math.floor(timeSeries.length / 20));
  const sampled = timeSeries.filter((_, i) => i % step === 0);
  // Always include last point
  if (sampled[sampled.length - 1] !== timeSeries[timeSeries.length - 1]) {
    sampled.push(timeSeries[timeSeries.length - 1]);
  }

  return (
    <table className="print-data-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>RPM</th>
          <th>Coolant °F</th>
          <th>Oil °F</th>
          <th>Speed mph</th>
          <th>Battery V</th>
        </tr>
      </thead>
      <tbody>
        {sampled.map((p, i) => (
          <tr key={i}>
            <td>{fmtTime(p.t)}</td>
            <td>{Math.round(p.rpm)}</td>
            <td>{Math.round(p.coolant_f)}</td>
            <td>{Math.round(p.oil_f)}</td>
            <td>{Math.round(p.speed_mph)}</td>
            <td>{p.battery_v.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Print-only trip table (replaces visual timeline in print)
// ---------------------------------------------------------------------------

function PrintTripTable({ trips }: { trips: Trip[] }) {
  if (trips.length === 0) return null;

  return (
    <table className="print-data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Start</th>
          <th>End</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        {trips.map((trip, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td>{fmtTime(trip.startTime)}</td>
            <td>{fmtTime(trip.endTime)}</td>
            <td>{trip.durationMin} min</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Trip Timeline (screen only)
// ---------------------------------------------------------------------------

function TripTimeline({
  trips,
  periodStart,
  periodEnd,
}: {
  trips: Trip[];
  periodStart: string;
  periodEnd: string;
}) {
  if (trips.length === 0) {
    return <p className="text-gray-500 text-sm">No engine activity recorded</p>;
  }

  const startMs = new Date(periodStart).getTime();
  const endMs = new Date(periodEnd).getTime();
  const totalMs = endMs - startMs || 1;

  return (
    <div>
      <div className="relative h-8 bg-gray-800 rounded-lg overflow-hidden print-hide-visual">
        {trips.map((trip, i) => {
          const tripStartMs = new Date(trip.startTime).getTime();
          const tripEndMs = new Date(trip.endTime).getTime();
          const left = ((tripStartMs - startMs) / totalMs) * 100;
          const w = ((tripEndMs - tripStartMs) / totalMs) * 100;
          return (
            <div
              key={i}
              className="absolute top-0 h-full bg-green-600/70 border-x border-green-500/50"
              style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(0.5, w)}%` }}
              title={`${fmtTime(trip.startTime)} — ${fmtTime(trip.endTime)} (${trip.durationMin} min)`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-gray-500 mt-1 print-hide-visual">
        <span>{fmtTime(periodStart)}</span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-2 bg-green-600/70 rounded-sm" /> Engine On
          <span className="inline-block w-3 h-2 bg-gray-800 rounded-sm border border-gray-700" /> Off
        </span>
        <span>{fmtTime(periodEnd)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers — all times in Eastern (America/New_York)
// ---------------------------------------------------------------------------

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ,
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: TZ,
  });
}

function fmtDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: TZ,
  });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ,
  });
}

function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton({ rangeLabel }: { rangeLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="w-10 h-10 rounded-full border-2 border-gray-700 border-t-green-500 animate-spin" />
      <div className="text-center">
        <p className="text-gray-300 font-semibold">Generating Shift Report</p>
        <p className="text-gray-500 text-sm mt-1">Querying Viam Cloud for TPS + truck data...</p>
        <p className="text-gray-600 text-xs mt-1">{rangeLabel}</p>
      </div>
      <div className="w-full max-w-3xl grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mt-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 p-4 animate-pulse">
            <div className="h-3 w-20 bg-gray-800 rounded mb-3" />
            <div className="h-8 w-16 bg-gray-800 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ShiftReportPage() {
  const [date, setDate] = useState(todayStr);
  const [startH, setStartH] = useState(6);
  const [startM, setStartM] = useState(0);
  const [endH, setEndH] = useState(18);
  const [endM, setEndM] = useState(0);
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activePreset = matchPreset(startH, startM, endH, endM);
  const rangeLabel = `${fmtDateLong(date + "T12:00:00Z")} — ${fmtHM(startH, startM)} to ${fmtHM(endH, endM)} Eastern`;

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        date,
        startHour: String(startH),
        startMin: String(startM),
        endHour: String(endH),
        endMin: String(endM),
      });
      const res = await fetch(`/api/shift-report?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data: ShiftReport = await res.json();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [date, startH, startM, endH, endM]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  function applyPreset(p: TimePreset) {
    setStartH(p.sh);
    setStartM(p.sm);
    setEndH(p.eh);
    setEndM(p.em);
  }

  function onStartChange(val: string) {
    const { h, m } = parseTimeInput(val);
    setStartH(h);
    setStartM(m);
  }

  function onEndChange(val: string) {
    const { h, m } = parseTimeInput(val);
    setEndH(h);
    setEndM(m);
  }

  const noData = report && !report.hasTpsData && !report.hasTruckData;

  return (
    <>
      {/* ================================================================ */}
      {/* Print styles — professional paper-ready report                   */}
      {/* ================================================================ */}
      <style>{`
        @media print {
          @page { size: letter portrait; margin: 0.5in; }

          /* White paper reset */
          *, *::before, *::after {
            color: #111827 !important;
            background: white !important;
            border-color: #d1d5db !important;
            box-shadow: none !important;
            text-shadow: none !important;
          }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }

          /* Hide ALL screen content — only .print-report shows */
          .no-print { display: none !important; }
          main > *:not(.print-report) { display: none !important; }
          .print-report { display: block !important; }

          /* Header */
          .pr-header { display: flex; justify-content: space-between; align-items: baseline; margin: 0; }
          .pr-header h1 { font-size: 14pt; font-weight: 900; letter-spacing: 0.08em; margin: 0; line-height: 1.2; }
          .pr-header-right { font-size: 9pt; color: #374151 !important; text-align: right; }
          .pr-rule { border: none; border-top: 2pt solid #111827 !important; margin: 4px 0 10px 0; }

          /* KPI row */
          .pr-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #374151 !important; margin-bottom: 10px; }
          .pr-kpi { border: 1px solid #d1d5db !important; padding: 6px 8px; text-align: center; }
          .pr-kpi-val { font-size: 20pt; font-weight: 900; line-height: 1.1; }
          .pr-kpi-val span { font-size: 8pt; font-weight: 400; margin-left: 2px; }
          .pr-kpi-label { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280 !important; margin-top: 2px; }

          /* Location */
          .pr-location { font-size: 9pt; margin: 0 0 8px 0; }

          /* Sections */
          .pr-section { margin-bottom: 8px; }
          .pr-section-head { font-size: 9pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #9ca3af !important; padding-bottom: 1px; margin-bottom: 3px; }

          /* Alerts */
          .pr-alert { font-size: 8pt; padding: 1px 0; }
          .pr-critical { color: #dc2626 !important; }
          .pr-warning { color: #92400e !important; }
          .pr-more { font-size: 7pt; color: #6b7280 !important; font-style: italic; margin-top: 1px; }

          /* Tables */
          .pr-table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 2px; }
          .pr-table th { background: #f3f4f6 !important; font-weight: 700; text-align: left; padding: 2px 6px; border: 1px solid #d1d5db !important; font-size: 7pt; text-transform: uppercase; }
          .pr-table td { padding: 2px 6px; border: 1px solid #e5e7eb !important; }

          /* Peaks + DTCs */
          .pr-inline-data { font-size: 9pt; line-height: 1.5; }

          /* Footer */
          .pr-footer { font-size: 7pt; color: #9ca3af !important; text-align: center; border-top: 1px solid #d1d5db !important; padding-top: 4px; margin-top: 16px; }

          /* Tighten main */
          main { gap: 0 !important; padding: 0 !important; }
        }

        /* Hide print elements on screen */
        @media screen {
          .print-only { display: none !important; }
          .print-report { display: none !important; }
          .print-data-table { display: none !important; }
        }
      `}</style>

      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        {/* Header */}
        <header className="border-b border-gray-800 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2 shrink-0 no-print">
          <div className="min-w-0">
            <a href="/" className="text-gray-500 hover:text-gray-300 text-xs uppercase tracking-widest">
              &larr; Dashboard
            </a>
            <h1 className="text-lg sm:text-2xl font-black tracking-widest uppercase text-gray-100 leading-none mt-1">
              Shift Report
            </h1>
            <p className="text-[10px] sm:text-xs text-gray-600 mt-0.5 tracking-wide">
              IronSight Fleet Monitoring
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="min-h-[44px] px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm font-semibold transition-colors"
          >
            Print
          </button>
        </header>

        {/* Controls: date + time range + preset pills */}
        <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-800 no-print">
          <div className="flex flex-wrap items-end gap-3">
            {/* Date */}
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white min-h-[44px] focus:outline-none focus:border-gray-500"
              />
            </div>

            {/* Start time */}
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">Start Time</label>
              <input
                type="time"
                value={toTimeInput(startH, startM)}
                onChange={(e) => onStartChange(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white min-h-[44px] focus:outline-none focus:border-gray-500"
              />
            </div>

            {/* End time */}
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">End Time</label>
              <input
                type="time"
                value={toTimeInput(endH, endM)}
                onChange={(e) => onEndChange(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white min-h-[44px] focus:outline-none focus:border-gray-500"
              />
            </div>

            {/* Generate */}
            <button
              onClick={fetchReport}
              disabled={loading}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-semibold transition-colors"
            >
              {loading ? "Loading..." : "Generate"}
            </button>
          </div>

          {/* Preset pills */}
          <div className="flex flex-wrap gap-2 mt-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  activePreset === p.id
                    ? "bg-white text-gray-900"
                    : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
                }`}
              >
                {p.label}
                <span className={`ml-1.5 ${activePreset === p.id ? "text-gray-500" : "text-gray-600"}`}>
                  {p.sub}
                </span>
              </button>
            ))}
            {activePreset === "custom" && (
              <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-600 text-white">
                Custom
              </span>
            )}
          </div>

          {/* Range label */}
          <p className="text-xs text-gray-500 mt-2">{rangeLabel}</p>
        </div>

        {/* Content */}
        <main className="flex-1 px-3 sm:px-6 py-4 sm:py-6 flex flex-col gap-4 sm:gap-6">
          {/* Loading skeleton */}
          {loading && <LoadingSkeleton rangeLabel={rangeLabel} />}

          {/* Error state */}
          {!loading && error && (
            <div className="bg-red-900/30 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* No data */}
          {!loading && !error && noData && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <p className="text-lg font-semibold">No data for this period</p>
              <p className="text-sm mt-1">
                No TPS or truck readings were recorded for {rangeLabel}.
              </p>
            </div>
          )}

          {/* Report content */}
          {!loading && !error && report && !noData && (
            <>
              {/* ========== PRINT HEADER (hidden on screen) ========== */}
              <div className="print-only print-header">
                <div>
                  <h1>Shift Report</h1>
                  <p>
                    {fmtDateLong(report.periodStart)} &middot; {fmtHM(startH, startM)} – {fmtHM(endH, endM)} Eastern &middot; {report.truckId}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontWeight: 700, fontSize: "13px" }}>IronSight</p>
                  <p>Fleet Monitoring</p>
                </div>
              </div>

              {/* Big summary numbers */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 print-kpi-grid">
                <SummaryCard
                  label="Engine Hours"
                  value={report.engineHours.toFixed(1)}
                  unit="hrs"
                  color={report.engineHours > 0 ? "green" : "gray"}
                />
                <SummaryCard
                  label="Idle Time"
                  value={report.idlePercent.toFixed(0)}
                  unit="%"
                  color={report.idlePercent > 40 ? "red" : report.idlePercent > 25 ? "yellow" : "green"}
                />
                <SummaryCard
                  label="Plates Placed"
                  value={String(report.totalPlates)}
                  unit="plates"
                  color={report.totalPlates > 0 ? "green" : "gray"}
                />
                <SummaryCard
                  label="Plates / Hour"
                  value={report.platesPerHour.toFixed(0)}
                  unit="/hr"
                  color={report.platesPerHour === 0 ? "gray" : report.platesPerHour < 500 ? "yellow" : "green"}
                />
              </div>

              {/* Alerts */}
              {report.alerts.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2 print-section-head">Alerts</h2>
                  {/* Screen version */}
                  <div className="grid gap-2 no-print">
                    {report.alerts.map((alert, i) => (
                      <div
                        key={i}
                        className={`rounded-xl px-4 py-3 text-sm font-medium ${
                          alert.level === "critical"
                            ? "bg-red-900/30 border border-red-800 text-red-300"
                            : "bg-yellow-900/30 border border-yellow-800 text-yellow-300"
                        }`}
                      >
                        <span className="font-bold mr-2">
                          {alert.level === "critical" ? "CRITICAL" : "WARNING"}
                        </span>
                        {alert.message}
                        <span className="text-xs ml-2 opacity-60">
                          {fmtTime(alert.timestamp)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {/* Print version — text list with symbols */}
                  <div className="print-only print-alert-list">
                    {report.alerts.map((alert, i) => (
                      <div key={i} className="print-alert-item">
                        {alert.level === "critical" ? "[!]" : "[*]"}{" "}
                        <strong>{alert.level === "critical" ? "CRITICAL" : "WARNING"}:</strong>{" "}
                        {alert.message} — {fmtTime(alert.timestamp)}
                        {alert.value !== undefined && ` (${alert.value})`}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* DTCs */}
              {report.dtcEvents.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2 print-section-head">
                    Diagnostic Trouble Codes
                  </h2>
                  <div className="bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800">
                    {report.dtcEvents.map((dtc, i) => (
                      <div key={i} className="px-4 py-2 flex justify-between items-center text-sm">
                        <span className="font-mono text-red-400">{dtc.code}</span>
                        <span className="text-gray-500 text-xs">First seen {fmtTime(dtc.firstSeen)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Trip timeline */}
              <section>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2 print-section-head">
                  Engine Activity
                </h2>
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                  <TripTimeline
                    trips={report.trips}
                    periodStart={report.periodStart}
                    periodEnd={report.periodEnd}
                  />
                  {report.trips.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-gray-400 screen-trip-cards">
                      {report.trips.map((trip, i) => (
                        <div key={i} className="bg-gray-800/50 rounded-lg px-3 py-2">
                          <span className="text-gray-300 font-medium">Trip {i + 1}</span>
                          <span className="block">
                            {fmtTime(trip.startTime)} — {fmtTime(trip.endTime)}
                          </span>
                          <span className="text-green-400">{trip.durationMin} min</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Print: trip table */}
                  <PrintTripTable trips={report.trips} />
                </div>
              </section>

              {/* Location / Distance section */}
              <section>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2 print-section-head">
                  {report.route.hasGps ? "Route" : "Distance"}
                </h2>

                {report.route.hasGps ? (
                  <>
                    <ShiftRouteMap
                      points={report.route.points}
                      stops={report.route.stops}
                      startLocation={report.route.startLocation}
                      endLocation={report.route.endLocation}
                    />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                      <MiniStat label="Distance" value={`${report.route.distanceMiles} mi`} />
                      <MiniStat label="Moving" value={`${report.route.movingMinutes} min`} />
                      <MiniStat label="Stopped" value={`${report.route.stoppedMinutes} min`} />
                      <MiniStat label="Stops" value={`${report.route.stops.length}`} />
                    </div>
                    {report.route.stops.length > 0 && (
                      <div className="mt-2 bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800">
                        {report.route.stops.map((stop, i) => (
                          <div key={i} className="px-4 py-2 flex justify-between items-center text-sm">
                            <span className="text-yellow-400">Stop {i + 1}</span>
                            <span className="text-gray-400">
                              {stop.durationMin} min at {fmtTime(stop.t)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <MiniStat label="Est. Distance" value={`${report.route.distanceMiles} mi`} sub="from speed data" />
                      <MiniStat label="Moving" value={`${report.route.movingMinutes} min`} />
                      <MiniStat label="Stopped" value={`${report.route.stoppedMinutes} min`} />
                    </div>
                    <p className="text-gray-600 text-xs mt-3 border-t border-gray-800 pt-3">
                      GPS data not available — install GPS module for route tracking.
                    </p>
                  </div>
                )}
              </section>

              {/* Engine peak readings */}
              <section>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2 print-section-head">
                  Peak Readings
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
                  <PeakCard
                    label="Peak Coolant"
                    value={report.peakCoolantTemp ? `${report.peakCoolantTemp.value}°F` : "—"}
                    time={report.peakCoolantTemp?.timestamp}
                    color={
                      !report.peakCoolantTemp ? "gray" :
                      report.peakCoolantTemp.value > 220 ? "red" :
                      report.peakCoolantTemp.value > 200 ? "yellow" : "green"
                    }
                  />
                  <PeakCard
                    label="Peak Oil Temp"
                    value={report.peakOilTemp ? `${report.peakOilTemp.value}°F` : "—"}
                    time={report.peakOilTemp?.timestamp}
                    color={
                      !report.peakOilTemp ? "gray" :
                      report.peakOilTemp.value > 250 ? "red" :
                      report.peakOilTemp.value > 230 ? "yellow" : "green"
                    }
                  />
                  <PeakCard
                    label="Min Battery"
                    value={report.minBatteryVoltage ? `${report.minBatteryVoltage.value}V` : "—"}
                    time={report.minBatteryVoltage?.timestamp}
                    color={
                      !report.minBatteryVoltage ? "gray" :
                      report.minBatteryVoltage.value < 12 ? "red" :
                      report.minBatteryVoltage.value < 12.5 ? "yellow" : "green"
                    }
                  />
                </div>
              </section>

              {/* Charts — page break before in print */}
              {report.timeSeries.length >= 2 && (
                <section className="print-break-before">
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2 print-section-head">
                    Engine Vitals
                  </h2>
                  <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 grid gap-6">
                    <Sparkline
                      data={report.timeSeries.map((p) => ({ t: p.t, v: p.coolant_f }))}
                      color="#f59e0b"
                      label="Coolant Temp"
                      unit="°F"
                    />
                    <Sparkline
                      data={report.timeSeries.map((p) => ({ t: p.t, v: p.rpm }))}
                      color="#22c55e"
                      label="Engine RPM"
                      unit=""
                    />
                    <Sparkline
                      data={report.timeSeries.map((p) => ({ t: p.t, v: p.speed_mph }))}
                      color="#3b82f6"
                      label="Vehicle Speed"
                      unit=" mph"
                    />
                    <Sparkline
                      data={report.timeSeries.map((p) => ({ t: p.t, v: p.battery_v }))}
                      color="#a78bfa"
                      label="Battery Voltage"
                      unit="V"
                    />
                  </div>
                  {/* Print fallback: data table */}
                  <PrintDataTable timeSeries={report.timeSeries} />
                </section>
              )}

              {/* ========== SINGLE-PAGE PRINT REPORT ========== */}
              <div className="print-report">
                {/* Header */}
                <div className="pr-header">
                  <h1>IRONSIGHT SHIFT REPORT</h1>
                  <div className="pr-header-right">
                    {fmtDateLong(report.periodStart)} &middot; {fmtHM(startH, startM)}–{fmtHM(endH, endM)} ET &middot; {report.truckId}
                  </div>
                </div>
                <hr className="pr-rule" />

                {/* KPI Row */}
                <div className="pr-kpi-row">
                  <div className="pr-kpi">
                    <div className="pr-kpi-val">{report.engineHours.toFixed(1)}<span>hrs</span></div>
                    <div className="pr-kpi-label">Engine Hours</div>
                  </div>
                  <div className="pr-kpi">
                    <div className="pr-kpi-val">{report.idlePercent.toFixed(0)}<span>%</span></div>
                    <div className="pr-kpi-label">Idle Time</div>
                  </div>
                  <div className="pr-kpi">
                    <div className="pr-kpi-val">{report.totalPlates}<span>plates</span></div>
                    <div className="pr-kpi-label">Plates Placed</div>
                  </div>
                  <div className="pr-kpi">
                    <div className="pr-kpi-val">{report.platesPerHour.toFixed(0)}<span>/hr</span></div>
                    <div className="pr-kpi-label">Plates / Hour</div>
                  </div>
                </div>

                {/* Location */}
                <p className="pr-location">
                  <strong>Location:</strong> Louisville, KY
                  {report.route.distanceMiles > 0 && ` \u2014 ${report.route.distanceMiles} mi${report.route.distanceSource === "speed_estimate" ? " (est.)" : ""}`}
                  {report.route.movingMinutes > 0 && ` \u2014 ${report.route.movingMinutes} min moving, ${report.route.stoppedMinutes} min stopped`}
                </p>

                {/* Alerts */}
                {report.alerts.length > 0 && (
                  <div className="pr-section">
                    <div className="pr-section-head">Alerts</div>
                    {report.alerts.slice(0, 5).map((alert, i) => (
                      <div key={i} className={`pr-alert ${alert.level === "critical" ? "pr-critical" : "pr-warning"}`}>
                        {alert.level === "critical" ? "[!] CRITICAL" : "[*] WARNING"}: {alert.message} \u2014 {fmtTime(alert.timestamp)}
                      </div>
                    ))}
                    {report.alerts.length > 5 && (
                      <div className="pr-more">and {report.alerts.length - 5} more alert{report.alerts.length - 5 > 1 ? "s" : ""}</div>
                    )}
                  </div>
                )}

                {/* Trips */}
                {report.trips.length > 0 && (
                  <div className="pr-section">
                    <div className="pr-section-head">Engine Activity ({report.trips.length} trip{report.trips.length > 1 ? "s" : ""})</div>
                    <table className="pr-table">
                      <thead>
                        <tr><th>Trip</th><th>Start</th><th>End</th><th>Duration</th></tr>
                      </thead>
                      <tbody>
                        {report.trips.slice(0, 8).map((trip, i) => (
                          <tr key={i}>
                            <td>{i + 1}</td>
                            <td>{fmtTime(trip.startTime)}</td>
                            <td>{fmtTime(trip.endTime)}</td>
                            <td>{trip.durationMin} min</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {report.trips.length > 8 && (
                      <div className="pr-more">{report.trips.length - 8} additional short trips</div>
                    )}
                  </div>
                )}

                {/* Peak Readings */}
                <div className="pr-section">
                  <div className="pr-section-head">Peak Readings</div>
                  <div className="pr-inline-data">
                    Peak Coolant: {report.peakCoolantTemp ? `${report.peakCoolantTemp.value}\u00B0F at ${fmtTime(report.peakCoolantTemp.timestamp)}` : "\u2014"}
                    {" \u00A0|\u00A0 "}
                    Peak Oil: {report.peakOilTemp ? `${report.peakOilTemp.value}\u00B0F at ${fmtTime(report.peakOilTemp.timestamp)}` : "\u2014"}
                    {" \u00A0|\u00A0 "}
                    Min Battery: {report.minBatteryVoltage ? `${report.minBatteryVoltage.value}V at ${fmtTime(report.minBatteryVoltage.timestamp)}` : "\u2014"}
                  </div>
                </div>

                {/* DTCs */}
                {report.dtcEvents.length > 0 && (
                  <div className="pr-section">
                    <div className="pr-section-head">Diagnostic Trouble Codes</div>
                    <div className="pr-inline-data">
                      {report.dtcEvents.map((dtc, i) => (
                        <span key={i}>{i > 0 && " \u00A0|\u00A0 "}{dtc.code} (first seen {fmtTime(dtc.firstSeen)})</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div className="pr-footer">
                  IronSight Fleet Monitoring \u2014 Generated {fmtDateTime(new Date().toISOString())} \u2014 {report.dataPointCount.tps + report.dataPointCount.truck} readings \u2014 All times Eastern (Louisville, KY)
                </div>
              </div>

              {/* Footer (screen) */}
              <footer className="text-[10px] sm:text-xs text-gray-600 text-center py-4 border-t border-gray-800 no-print">
                Report generated {fmtDateTime(new Date().toISOString())} | Data points: {report.dataPointCount.tps} TPS, {report.dataPointCount.truck} truck | All times Eastern (Louisville, KY) | IronSight Fleet Monitoring
              </footer>
            </>
          )}
        </main>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color: "green" | "yellow" | "red" | "gray";
}) {
  const colorMap = {
    green: "text-green-400 border-green-800/50",
    yellow: "text-yellow-400 border-yellow-800/50",
    red: "text-red-400 border-red-800/50",
    gray: "text-gray-500 border-gray-800",
  };

  return (
    <div className={`bg-gray-900 rounded-xl border p-3 sm:p-4 print-kpi-cell ${colorMap[color]}`}>
      <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-widest">{label}</p>
      <p className={`text-2xl sm:text-4xl font-black mt-1 leading-none ${colorMap[color].split(" ")[0]}`}>
        {value}
        <span className="text-sm sm:text-lg font-normal ml-1 opacity-60">{unit}</span>
      </p>
    </div>
  );
}

function PeakCard({
  label,
  value,
  time,
  color,
}: {
  label: string;
  value: string;
  time?: string;
  color: "green" | "yellow" | "red" | "gray";
}) {
  const bgMap = {
    green: "bg-green-900/20 border-green-800/50",
    yellow: "bg-yellow-900/20 border-yellow-800/50",
    red: "bg-red-900/20 border-red-800/50",
    gray: "bg-gray-900 border-gray-800",
  };
  const textMap = {
    green: "text-green-400",
    yellow: "text-yellow-400",
    red: "text-red-400",
    gray: "text-gray-500",
  };

  return (
    <div className={`rounded-xl border p-3 sm:p-4 ${bgMap[color]}`}>
      <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-widest">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-1 ${textMap[color]}`}>{value}</p>
      {time && <p className="text-[10px] text-gray-600 mt-0.5">at {fmtTime(time)}</p>}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-800/50 rounded-lg px-3 py-2">
      <p className="text-[10px] text-gray-500 uppercase tracking-widest">{label}</p>
      <p className="text-lg font-bold text-gray-200 mt-0.5">{value}</p>
      {sub && <p className="text-[9px] text-gray-600">{sub}</p>}
    </div>
  );
}
