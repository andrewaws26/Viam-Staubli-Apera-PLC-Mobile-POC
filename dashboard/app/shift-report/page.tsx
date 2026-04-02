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
  shift: string;
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
  const padR = 16; // extra right padding for time labels
  const padY = 4;
  const labelH = 24; // room for bottom time labels
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
        className="w-full"
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
// Trip Timeline
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
      <div className="relative h-8 bg-gray-800 rounded-lg overflow-hidden print-timeline">
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
      <div className="flex justify-between text-[10px] text-gray-500 mt-1">
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

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ,
  });
}

function todayStr(): string {
  // Today in Eastern time
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts; // YYYY-MM-DD
}

const SHIFT_LABELS: Record<string, { label: string; range: string }> = {
  day:   { label: "Day",   range: "6:00 AM – 6:00 PM ET" },
  night: { label: "Night", range: "6:00 PM – 6:00 AM ET" },
  full:  { label: "Full",  range: "12:00 AM – 12:00 AM ET" },
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton({ shift }: { shift: string }) {
  const shiftInfo = SHIFT_LABELS[shift] || SHIFT_LABELS.full;
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="w-10 h-10 rounded-full border-2 border-gray-700 border-t-green-500 animate-spin" />
      <div className="text-center">
        <p className="text-gray-300 font-semibold">Generating {shiftInfo.label} Shift Report</p>
        <p className="text-gray-500 text-sm mt-1">Querying Viam Cloud for TPS + truck data...</p>
      </div>
      {/* Skeleton summary cards */}
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
  const [shift, setShift] = useState<"day" | "night" | "full">("full");
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shift-report?date=${date}&shift=${shift}`);
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
  }, [date, shift]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const noData = report && !report.hasTpsData && !report.hasTruckData;
  const shiftInfo = SHIFT_LABELS[shift] || SHIFT_LABELS.full;
  const shiftLabel = `${shiftInfo.label} Shift (${shiftInfo.range})`;

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .print-break { page-break-before: always; }
          .print-card { border: 1px solid #d1d5db !important; background: white !important; color: #111827 !important; }
          .print-card p, .print-card span { color: #374151 !important; }
          .print-card .text-green-400, .print-card .text-yellow-400, .print-card .text-red-400 { color: #111827 !important; }
          .print-chart svg polyline { stroke: #1f2937 !important; }
          .print-chart svg line { stroke: #d1d5db !important; }
          .print-chart svg text { fill: #374151 !important; }
          .print-chart .text-gray-400, .print-chart .text-gray-500 { color: #374151 !important; }
          .print-timeline { background: #e5e7eb !important; }
          .print-timeline > div { background: #16a34a !important; }
          .leaflet-container { display: none !important; }
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

        {/* Controls */}
        <div className="px-3 sm:px-6 py-3 sm:py-4 flex flex-wrap items-end gap-3 border-b border-gray-800 no-print">
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white min-h-[44px] focus:outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">Shift</label>
            <div className="flex rounded-lg overflow-hidden border border-gray-700">
              {(["day", "night", "full"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setShift(s)}
                  title={SHIFT_LABELS[s].range}
                  className={`px-3 sm:px-4 py-1.5 text-sm font-semibold min-h-[44px] transition-colors flex flex-col items-center justify-center ${
                    shift === s
                      ? "bg-gray-100 text-gray-900"
                      : "bg-gray-900 text-gray-400 hover:text-white"
                  }`}
                >
                  <span>{SHIFT_LABELS[s].label}</span>
                  <span className={`text-[9px] font-normal ${shift === s ? "text-gray-500" : "text-gray-600"}`}>
                    {SHIFT_LABELS[s].range}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={fetchReport}
            disabled={loading}
            className="min-h-[44px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-semibold transition-colors"
          >
            {loading ? "Loading..." : "Generate"}
          </button>
        </div>

        {/* Content */}
        <main className="flex-1 px-3 sm:px-6 py-4 sm:py-6 flex flex-col gap-4 sm:gap-6">
          {/* Loading skeleton */}
          {loading && <LoadingSkeleton shift={shift} />}

          {/* Error state */}
          {!loading && error && (
            <div className="bg-red-900/30 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* No data */}
          {!loading && !error && noData && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <p className="text-lg font-semibold">No data for this date</p>
              <p className="text-sm mt-1">
                No TPS or truck readings were recorded for {fmtDate(date + "T12:00:00Z")} ({shiftLabel}).
              </p>
            </div>
          )}

          {/* Report content */}
          {!loading && !error && report && !noData && (
            <>
              {/* Print header */}
              <div className="hidden print:block mb-4">
                <h1 className="text-2xl font-black tracking-widest uppercase">Shift Report</h1>
                <p className="text-sm text-gray-600 mt-1">
                  {fmtDate(report.periodStart)} &middot; {shiftLabel} &middot; {report.truckId}
                </p>
              </div>

              {/* Big summary numbers */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
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
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2">Alerts</h2>
                  <div className="grid gap-2">
                    {report.alerts.map((alert, i) => (
                      <div
                        key={i}
                        className={`rounded-xl px-4 py-3 text-sm font-medium print-card ${
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
                </section>
              )}

              {/* DTCs */}
              {report.dtcEvents.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2">
                    Diagnostic Trouble Codes
                  </h2>
                  <div className="bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800 print-card">
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
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2">
                  Engine Activity
                </h2>
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 print-card">
                  <TripTimeline
                    trips={report.trips}
                    periodStart={report.periodStart}
                    periodEnd={report.periodEnd}
                  />
                  {report.trips.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-gray-400">
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
                </div>
              </section>

              {/* Location / Distance section */}
              <section>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2">
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
                      <div className="mt-2 bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800 print-card">
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
                  <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 print-card">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <MiniStat label="Est. Distance" value={`${report.route.distanceMiles} mi`} sub="from speed data" />
                      <MiniStat label="Moving" value={`${report.route.movingMinutes} min`} />
                      <MiniStat label="Stopped" value={`${report.route.stoppedMinutes} min`} />
                    </div>
                    {/* GPS not available notice */}
                    <p className="text-gray-600 text-xs mt-3 border-t border-gray-800 pt-3">
                      GPS data not available — install GPS module for route tracking.
                      {/* SIM7600G-H cellular HAT on Pi 5 has built-in GNSS/GPS
                         that can feed location data via AT commands once enabled. */}
                    </p>
                  </div>
                )}
              </section>

              {/* Engine peak readings */}
              <section>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2">
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

              {/* Charts */}
              {report.timeSeries.length >= 2 && (
                <section>
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2">
                    Engine Vitals
                  </h2>
                  <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 grid gap-6 print-card">
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
                </section>
              )}

              {/* Footer */}
              <footer className="text-[10px] sm:text-xs text-gray-600 text-center py-4 border-t border-gray-800">
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
    <div className={`bg-gray-900 rounded-xl border p-3 sm:p-4 print-card ${colorMap[color]}`}>
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
    <div className={`rounded-xl border p-3 sm:p-4 print-card ${bgMap[color]}`}>
      <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-widest">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-1 ${textMap[color]}`}>{value}</p>
      {time && <p className="text-[10px] text-gray-600 mt-0.5">at {fmtTime(time)}</p>}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-800/50 rounded-lg px-3 py-2 print-card">
      <p className="text-[10px] text-gray-500 uppercase tracking-widest">{label}</p>
      <p className="text-lg font-bold text-gray-200 mt-0.5">{value}</p>
      {sub && <p className="text-[9px] text-gray-600">{sub}</p>}
    </div>
  );
}
