// LogPanel.tsx — System event log from FTP log scraping of the Staubli CS9.
// Displays event counts, system stats, and detailed event cards for the last 24h.
// Data source: cell-sensor FTP scraper → Viam flat keys (staubli_log_*).
"use client";

import { useState } from "react";
import type { StaubliLogReadings } from "./CellTypes";

// ---------------------------------------------------------------------------
// Sub-components (matching StaubliPanel patterns)
// ---------------------------------------------------------------------------

function KV({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-xs text-gray-500 uppercase tracking-wide truncate">{label}</span>
      <span className={`text-xs sm:text-sm truncate ${mono ? "font-mono" : ""} ${color || "text-gray-300"}`}>{value}</span>
    </div>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event count badge — color by severity
// ---------------------------------------------------------------------------

type Severity = "critical" | "warning" | "info";

function countColor(count: number, severity: Severity): string {
  if (count === 0) return "text-gray-600";
  switch (severity) {
    case "critical": return "text-red-400";
    case "warning":  return "text-orange-400";
    case "info":     return "text-blue-400";
  }
}

function countBg(count: number, severity: Severity): string {
  if (count === 0) return "bg-gray-900/30 border-gray-800/30";
  switch (severity) {
    case "critical": return "bg-red-950/30 border-red-900/50";
    case "warning":  return "bg-orange-950/30 border-orange-900/50";
    case "info":     return "bg-blue-950/30 border-blue-900/50";
  }
}

function EventCount({ label, count, severity }: { label: string; count: number; severity: Severity }) {
  return (
    <div className={`flex flex-col items-center p-2 rounded-lg border ${countBg(count, severity)}`}>
      <span className={`font-mono text-lg font-bold ${countColor(count, severity)}`}>{count}</span>
      <span className="text-xs text-gray-500 uppercase tracking-wide text-center leading-tight">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CPU load bar
// ---------------------------------------------------------------------------

function CpuBar({ pct }: { pct: number }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const barColor = clamped >= 90 ? "bg-red-500" : clamped >= 70 ? "bg-orange-500" : "bg-emerald-500";
  const textColor = clamped >= 90 ? "text-red-400" : clamped >= 70 ? "text-orange-400" : "text-gray-300";
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-xs text-gray-500 uppercase tracking-wide">CPU Load</span>
      <div className="flex items-center gap-2 mt-0.5">
        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${clamped}%` }} />
        </div>
        <span className={`font-mono text-xs font-bold ${textColor}`}>{pct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event detail card — shown for non-zero event types
// ---------------------------------------------------------------------------

interface EventCardProps {
  title: string;
  count: number;
  severity: Severity;
  lastTime?: string;
  context?: string;
  contextLabel?: string;
}

function EventCard({ title, count, severity, lastTime, context, contextLabel }: EventCardProps) {
  if (count === 0) return null;
  return (
    <div className={`p-3 rounded-lg border ${countBg(count, severity)}`}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${
            severity === "critical" ? "bg-red-500" :
            severity === "warning" ? "bg-orange-500" : "bg-blue-500"
          }`} />
          <span className={`text-xs font-bold uppercase tracking-wider ${countColor(count, severity)}`}>
            {title}
          </span>
        </div>
        <span className={`font-mono text-sm font-bold shrink-0 ${countColor(count, severity)}`}>
          {count}
        </span>
      </div>
      {lastTime && (
        <div className="text-xs text-gray-500 mb-0.5">
          <span className="uppercase tracking-wide">Last: </span>
          <span className="text-gray-400">{lastTime}</span>
        </div>
      )}
      {context && (
        <div className="text-xs text-gray-500">
          <span className="uppercase tracking-wide">{contextLabel || "Detail"}: </span>
          <span className="font-mono text-gray-400">{context}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface Props {
  logs: StaubliLogReadings | null;
}

export default function LogPanel({ logs }: Props) {
  const [expanded, setExpanded] = useState(true);

  const isConnected = logs?.log_connected ?? false;

  // Derive servo toggle count (enables + disables)
  const servoToggles = (logs?.servo_enable_count_24h ?? 0) + (logs?.servo_disable_count_24h ?? 0);

  // Check if any events are active
  const hasEvents = logs && (
    logs.urps_events_24h > 0 ||
    logs.ethercat_events_24h > 0 ||
    logs.ethercat_frame_loss_24h > 0 ||
    logs.safety_stops_24h > 0 ||
    servoToggles > 0 ||
    logs.app_restarts_24h > 0
  );

  return (
    <section className="border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header — collapsible, matching StaubliPanel */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            isConnected ? "bg-green-500" : "bg-red-500"
          }`} />
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
            System Event Log &mdash; CS9 FTP
          </h2>
          {hasEvents && (
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-orange-900/30 text-orange-400 border border-orange-800/50">
              EVENTS
            </span>
          )}
        </div>
        <span className="text-gray-500 text-xs shrink-0">{expanded ? "\u25B2" : "\u25BC"}</span>
      </button>

      {expanded && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-5">
          {!logs ? (
            <p className="text-xs text-gray-700 animate-pulse">Waiting for log scraper connection&hellip;</p>
          ) : (
            <>
              {/* ---- Connection Status ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
                  Connection
                </h3>
                <StatusDot ok={isConnected} label={isConnected ? "FTP Scraper Connected" : "FTP Scraper Disconnected"} />
              </div>

              {/* ---- Event Summary Bar ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
                  24h Event Summary
                </h3>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  <EventCount label="URPS" count={logs.urps_events_24h} severity="critical" />
                  <EventCount label="EtherCAT" count={logs.ethercat_events_24h} severity="critical" />
                  <EventCount label="Frame Loss" count={logs.ethercat_frame_loss_24h} severity="warning" />
                  <EventCount label="Safety" count={logs.safety_stops_24h} severity="critical" />
                  <EventCount label="Servo" count={servoToggles} severity="warning" />
                  <EventCount label="Restarts" count={logs.app_restarts_24h} severity="warning" />
                </div>
              </div>

              {/* ---- System Stats ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
                  System Stats
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                  <KV label="Arm Total Cycles" value={logs.arm_total_cycles.toLocaleString()} mono />
                  <KV label="Power-on Hours" value={logs.arm_power_on_hours.toLocaleString(undefined, { maximumFractionDigits: 1 })} mono />
                  <div className="col-span-2 sm:col-span-2">
                    <CpuBar pct={logs.controller_cpu_load_pct} />
                  </div>
                </div>
              </div>

              {/* ---- Event Detail Cards ---- */}
              {hasEvents && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
                    Event Details
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <EventCard
                      title="URPS Events"
                      count={logs.urps_events_24h}
                      severity="critical"
                      lastTime={logs.urps_last_time || undefined}
                      context={logs.urps_last_code || undefined}
                      contextLabel="Code"
                    />
                    <EventCard
                      title="EtherCAT Errors"
                      count={logs.ethercat_events_24h}
                      severity="critical"
                    />
                    <EventCard
                      title="EtherCAT Frame Loss"
                      count={logs.ethercat_frame_loss_24h}
                      severity="warning"
                    />
                    <EventCard
                      title="Safety Stops"
                      count={logs.safety_stops_24h}
                      severity="critical"
                      context={logs.safety_last_cause || undefined}
                      contextLabel="Cause"
                    />
                    {logs.servo_disable_count_24h > 0 && (
                      <EventCard
                        title="Servo Disables"
                        count={logs.servo_disable_count_24h}
                        severity="warning"
                      />
                    )}
                    {logs.servo_enable_count_24h > 0 && (
                      <EventCard
                        title="Servo Enables"
                        count={logs.servo_enable_count_24h}
                        severity="info"
                      />
                    )}
                    <EventCard
                      title="App Restarts"
                      count={logs.app_restarts_24h}
                      severity="warning"
                    />
                  </div>
                </div>
              )}

              {/* ---- All Clear ---- */}
              {!hasEvents && (
                <div className="p-3 bg-emerald-950/20 border border-emerald-900/40 rounded-lg text-xs text-emerald-400 text-center">
                  No events in the last 24 hours &mdash; system nominal.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
