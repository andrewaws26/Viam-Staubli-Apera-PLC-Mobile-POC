"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";

import { ShiftReport } from "./types";
import { fmtTime, fmtDateLong, fmtDateTime, fmtHM, todayStr } from "./utils/timezone";
import { PRESETS, matchPreset, parseTimeInput, toTimeInput } from "./utils/time-presets";
import { Sparkline } from "./components/Sparkline";
import { PrintDataTable, PrintTripTable } from "./components/PrintTables";
import { TripTimeline } from "./components/TripTimeline";
import { SummaryCard, PeakCard, MiniStat } from "./components/SummaryCards";
import { LoadingSkeleton } from "./components/LoadingSkeleton";
import type { TimePreset } from "./types";

const ShiftRouteMap = dynamic(() => import("../../components/ShiftRouteMap"), { ssr: false });

// ---------------------------------------------------------------------------
// Print styles
// ---------------------------------------------------------------------------

const PRINT_STYLES = `
  @media print {
    @page { size: letter portrait; margin: 0.6in 0.75in; }

    /* White paper reset */
    *, *::before, *::after {
      color: #1f2937 !important;
      background: white !important;
      border-color: #d1d5db !important;
      box-shadow: none !important;
      text-shadow: none !important;
    }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }

    /* Hide ALL screen content — only .print-report shows */
    .no-print { display: none !important; }
    main > *:not(.print-report) { display: none !important; }
    .print-report { display: block !important; padding: 0 4px; }

    /* Container resets */
    main { gap: 0 !important; padding: 0 !important; }
    .min-h-screen { min-height: 0 !important; }

    /* ---- Header ---- */
    .pr-header { display: flex; justify-content: space-between; align-items: flex-end; margin: 0 0 6px 0; }
    .pr-header h1 { font-size: 15pt; font-weight: 900; letter-spacing: 0.1em; margin: 0; line-height: 1; color: #111827 !important; }
    .pr-header-right { font-size: 9pt; color: #4b5563 !important; text-align: right; line-height: 1.4; }
    .pr-rule { border: none; border-top: 2.5pt solid #111827 !important; margin: 0 0 14px 0; }

    /* ---- KPI row ---- */
    .pr-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); border: 2px solid #374151 !important; border-radius: 4px; margin-bottom: 14px; overflow: hidden; }
    .pr-kpi { border-right: 1px solid #d1d5db !important; padding: 10px 12px; text-align: center; }
    .pr-kpi:last-child { border-right: none !important; }
    .pr-kpi-val { font-size: 22pt; font-weight: 900; line-height: 1.1; color: #111827 !important; }
    .pr-kpi-val span { font-size: 9pt; font-weight: 400; margin-left: 2px; color: #6b7280 !important; }
    .pr-kpi-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280 !important; margin-top: 3px; }

    /* ---- Location ---- */
    .pr-location { font-size: 9.5pt; margin: 0 0 12px 0; color: #374151 !important; }
    .pr-location strong { color: #111827 !important; }

    /* ---- Sections ---- */
    .pr-section { margin-bottom: 12px; }
    .pr-section-head { font-size: 9pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1.5px solid #9ca3af !important; padding-bottom: 2px; margin-bottom: 5px; color: #374151 !important; }

    /* ---- Alerts ---- */
    .pr-alert { font-size: 8.5pt; padding: 2px 0; line-height: 1.4; }
    .pr-critical { color: #dc2626 !important; }
    .pr-warning { color: #92400e !important; }
    .pr-more { font-size: 7.5pt; color: #6b7280 !important; font-style: italic; margin-top: 2px; }

    /* ---- Tables ---- */
    .pr-table { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 4px; }
    .pr-table th { background: #f3f4f6 !important; font-weight: 700; text-align: left; padding: 3px 8px; border: 1px solid #d1d5db !important; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.03em; }
    .pr-table td { padding: 3px 8px; border: 1px solid #e5e7eb !important; }
    .pr-table tr:nth-child(even) td { background: #f9fafb !important; }

    /* ---- Peaks + DTCs ---- */
    .pr-inline-data { font-size: 9.5pt; line-height: 1.6; color: #374151 !important; }

    /* ---- Footer ---- */
    .pr-footer { font-size: 7.5pt; color: #9ca3af !important; text-align: center; border-top: 1px solid #d1d5db !important; padding-top: 6px; margin-top: 20px; }
  }

  /* Hide print elements on screen */
  @media screen {
    .print-only { display: none !important; }
    .print-report { display: none !important; }
    .print-data-table { display: none !important; }
  }
`;

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
      <style>{PRINT_STYLES}</style>

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
              <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">Start Time</label>
              <input
                type="time"
                value={toTimeInput(startH, startM)}
                onChange={(e) => onStartChange(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white min-h-[44px] focus:outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">End Time</label>
              <input
                type="time"
                value={toTimeInput(endH, endM)}
                onChange={(e) => onEndChange(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white min-h-[44px] focus:outline-none focus:border-gray-500"
              />
            </div>
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
                className={`px-3 py-2 min-h-[44px] rounded-full text-xs font-semibold transition-colors flex items-center ${
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

          <p className="text-xs text-gray-500 mt-2">{rangeLabel}</p>
        </div>

        {/* Content */}
        <main className="flex-1 px-3 sm:px-6 py-4 sm:py-6 flex flex-col gap-4 sm:gap-6">
          {loading && <LoadingSkeleton rangeLabel={rangeLabel} />}

          {!loading && error && (
            <div className="bg-red-900/30 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && noData && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <p className="text-lg font-semibold">No data for this period</p>
              <p className="text-sm mt-1">
                No TPS or truck readings were recorded for {rangeLabel}.
              </p>
            </div>
          )}

          {!loading && !error && report && !noData && (
            <ReportContent
              report={report}
              startH={startH}
              startM={startM}
              endH={endH}
              endM={endM}
            />
          )}
        </main>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Report content (extracted to keep the main function shorter)
// ---------------------------------------------------------------------------

function ReportContent({
  report,
  startH,
  startM,
  endH,
  endM,
}: {
  report: ShiftReport;
  startH: number;
  startM: number;
  endH: number;
  endM: number;
}) {
  return (
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
        <SummaryCard label="Engine Hours" value={report.engineHours.toFixed(1)} unit="hrs" color={report.engineHours > 0 ? "green" : "gray"} />
        <SummaryCard label="Idle Time" value={report.idlePercent.toFixed(0)} unit="%" color={report.idlePercent > 40 ? "red" : report.idlePercent > 25 ? "yellow" : "green"} />
        <SummaryCard label="Plates Placed" value={String(report.totalPlates)} unit="plates" color={report.totalPlates > 0 ? "green" : "gray"} />
        <SummaryCard label="Plates / Hour" value={report.platesPerHour.toFixed(0)} unit="/hr" color={report.platesPerHour === 0 ? "gray" : report.platesPerHour < 500 ? "yellow" : "green"} />
      </div>

      {/* Alerts */}
      {report.alerts.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2 print-section-head">Alerts</h2>
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
                <span className="font-bold mr-2">{alert.level === "critical" ? "CRITICAL" : "WARNING"}</span>
                {alert.message}
                <span className="text-xs ml-2 opacity-60">{fmtTime(alert.timestamp)}</span>
              </div>
            ))}
          </div>
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
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2 print-section-head">Diagnostic Trouble Codes</h2>
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
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2 print-section-head">Engine Activity</h2>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
          <TripTimeline trips={report.trips} periodStart={report.periodStart} periodEnd={report.periodEnd} />
          {report.trips.length > 0 && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-gray-400 screen-trip-cards">
              {report.trips.map((trip, i) => (
                <div key={i} className="bg-gray-800/50 rounded-lg px-3 py-2">
                  <span className="text-gray-300 font-medium">Trip {i + 1}</span>
                  <span className="block">{fmtTime(trip.startTime)} — {fmtTime(trip.endTime)}</span>
                  <span className="text-green-400">{trip.durationMin} min</span>
                </div>
              ))}
            </div>
          )}
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
                    <span className="text-gray-400">{stop.durationMin} min at {fmtTime(stop.t)}</span>
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
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2 print-section-head">Peak Readings</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
          <PeakCard
            label="Peak Coolant"
            value={report.peakCoolantTemp ? `${report.peakCoolantTemp.value}\u00B0F` : "\u2014"}
            time={report.peakCoolantTemp?.timestamp}
            color={!report.peakCoolantTemp ? "gray" : report.peakCoolantTemp.value > 220 ? "red" : report.peakCoolantTemp.value > 200 ? "yellow" : "green"}
          />
          <PeakCard
            label="Peak Oil Temp"
            value={report.peakOilTemp ? `${report.peakOilTemp.value}\u00B0F` : "\u2014"}
            time={report.peakOilTemp?.timestamp}
            color={!report.peakOilTemp ? "gray" : report.peakOilTemp.value > 250 ? "red" : report.peakOilTemp.value > 230 ? "yellow" : "green"}
          />
          <PeakCard
            label="Min Battery"
            value={report.minBatteryVoltage ? `${report.minBatteryVoltage.value}V` : "\u2014"}
            time={report.minBatteryVoltage?.timestamp}
            color={!report.minBatteryVoltage ? "gray" : report.minBatteryVoltage.value < 12 ? "red" : report.minBatteryVoltage.value < 12.5 ? "yellow" : "green"}
          />
        </div>
      </section>

      {/* Charts */}
      {report.timeSeries.length >= 2 && (
        <section className="print-break-before">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2 print-section-head">Engine Vitals</h2>
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 grid gap-6">
            <Sparkline data={report.timeSeries.map((p) => ({ t: p.t, v: p.coolant_f }))} color="#f59e0b" label="Coolant Temp" unit="\u00B0F" />
            <Sparkline data={report.timeSeries.map((p) => ({ t: p.t, v: p.rpm }))} color="#22c55e" label="Engine RPM" unit="" />
            <Sparkline data={report.timeSeries.map((p) => ({ t: p.t, v: p.speed_mph }))} color="#3b82f6" label="Vehicle Speed" unit=" mph" />
            <Sparkline data={report.timeSeries.map((p) => ({ t: p.t, v: p.battery_v }))} color="#a78bfa" label="Battery Voltage" unit="V" />
          </div>
          <PrintDataTable timeSeries={report.timeSeries} />
        </section>
      )}

      {/* ========== SINGLE-PAGE PRINT REPORT ========== */}
      <div className="print-report">
        <div className="pr-header">
          <h1>IRONSIGHT SHIFT REPORT</h1>
          <div className="pr-header-right">
            {fmtDateLong(report.periodStart)} &middot; {fmtHM(startH, startM)}–{fmtHM(endH, endM)} ET &middot; {report.truckId}
          </div>
        </div>
        <hr className="pr-rule" />

        <div className="pr-kpi-row">
          <div className="pr-kpi"><div className="pr-kpi-val">{report.engineHours.toFixed(1)}<span>hrs</span></div><div className="pr-kpi-label">Engine Hours</div></div>
          <div className="pr-kpi"><div className="pr-kpi-val">{report.idlePercent.toFixed(0)}<span>%</span></div><div className="pr-kpi-label">Idle Time</div></div>
          <div className="pr-kpi"><div className="pr-kpi-val">{report.totalPlates}<span>plates</span></div><div className="pr-kpi-label">Plates Placed</div></div>
          <div className="pr-kpi"><div className="pr-kpi-val">{report.platesPerHour.toFixed(0)}<span>/hr</span></div><div className="pr-kpi-label">Plates / Hour</div></div>
        </div>

        <p className="pr-location">
          <strong>Location:</strong> Louisville, KY
          {report.route.distanceMiles > 0 && ` \u2014 ${report.route.distanceMiles} mi${report.route.distanceSource === "speed_estimate" ? " (est.)" : ""}`}
          {report.route.movingMinutes > 0 && ` \u2014 ${report.route.movingMinutes} min moving, ${report.route.stoppedMinutes} min stopped`}
        </p>

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

        {report.trips.length > 0 && (
          <div className="pr-section">
            <div className="pr-section-head">Engine Activity ({report.trips.length} trip{report.trips.length > 1 ? "s" : ""})</div>
            <table className="pr-table">
              <thead><tr><th>Trip</th><th>Start</th><th>End</th><th>Duration</th></tr></thead>
              <tbody>
                {report.trips.slice(0, 8).map((trip, i) => (
                  <tr key={i}><td>{i + 1}</td><td>{fmtTime(trip.startTime)}</td><td>{fmtTime(trip.endTime)}</td><td>{trip.durationMin} min</td></tr>
                ))}
              </tbody>
            </table>
            {report.trips.length > 8 && (
              <div className="pr-more">{report.trips.length - 8} additional short trips</div>
            )}
          </div>
        )}

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

        <div className="pr-footer">
          IronSight Fleet Monitoring \u2014 Generated {fmtDateTime(new Date().toISOString())} \u2014 {report.dataPointCount.tps + report.dataPointCount.truck} readings \u2014 All times Eastern (Louisville, KY)
        </div>
      </div>

      {/* Footer (screen) */}
      <footer className="text-[10px] sm:text-xs text-gray-600 text-center py-4 border-t border-gray-800 no-print">
        Report generated {fmtDateTime(new Date().toISOString())} | Data points: {report.dataPointCount.tps} TPS, {report.dataPointCount.truck} truck | All times Eastern (Louisville, KY) | IronSight Fleet Monitoring
      </footer>
    </>
  );
}
