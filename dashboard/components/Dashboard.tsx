"use client";

// PRIVACY CONSTRAINT: This dashboard displays machine and component state only.
// No fields identifying operators, shift times, or personnel may be displayed.
// See docs/architecture.md section 6 for the full architectural enforcement.

import StatusCard from "./StatusCard";
import AlertBanner from "./AlertBanner";
import FaultHistory from "./FaultHistory";
import PlcDetailPanel from "./PlcDetailPanel";
import DiagnosticsPanel from "./DiagnosticsPanel";
import HistoryPanel from "./HistoryPanel";
import TruckPanel from "./TruckPanel";
import PiHealthCard from "./PiHealthCard";
import ConnectionDot from "./ConnectionDot";
import { useAlarm, FlashOverlay } from "./DashboardAudio";
import { useSensorPolling } from "../hooks/useSensorPolling";

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const playAlarm = useAlarm();

  const {
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
    setSimMode,
    pollIntervalMs,
  } = useSensorPolling(playAlarm);

  return (
    <>
      <FlashOverlay flashKey={flashKey} />

      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        {/* ---------------------------------------------------------------- */}
        {/* Header                                                           */}
        {/* ---------------------------------------------------------------- */}
        <header className="border-b border-gray-800 px-2 sm:px-5 py-2 sm:py-4 flex items-center justify-between gap-2 sm:gap-4 shrink-0">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-black tracking-widest uppercase text-gray-100 leading-none">
              TPS Monitor
            </h1>
            <p className="text-[10px] sm:text-xs text-gray-600 mt-0.5 tracking-wide truncate">
              IronSight — Live Production & Fleet Data
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
            <a
              href="/shift-report"
              className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm2 10a1 1 0 10-2 0v3a1 1 0 102 0v-3zm2-3a1 1 0 011 1v5a1 1 0 11-2 0v-5a1 1 0 011-1zm4 2a1 1 0 10-2 0v3a1 1 0 102 0v-3z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">Shift Report</span>
            </a>
            <a
              href="/ironsight-overview.html"
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
              </svg>
              <span className="hidden sm:inline">Overview</span>
            </a>
            <button
              onClick={() => setSimMode((prev) => !prev)}
              className={`text-[10px] sm:text-xs min-h-[44px] px-3 sm:px-3 py-2 rounded-lg font-bold transition-colors ${
                simMode
                  ? "bg-purple-700 text-white"
                  : "border border-gray-700 text-gray-500 hover:text-gray-300"
              }`}
            >
              {simMode ? "SIM ON" : "SIM"}
            </button>
            <ConnectionDot
              status={simMode ? "connected" : connectionStatus}
              dataAge={simMode ? null : connectionDataAge}
              error={simMode ? null : connectionError}
            />
          </div>
        </header>
        {simMode && (
          <div className="bg-purple-900/30 border-b border-purple-700/50 px-3 sm:px-5 py-1.5 text-[10px] sm:text-xs text-purple-300">
            Simulation mode — showing simulated production data. <button onClick={() => setSimMode(false)} className="underline hover:text-white ml-1">Stop</button>
          </div>
        )}

        {/* Alert Banner */}
        {activeFaultLabels.length > 0 && (
          <AlertBanner faultNames={activeFaultLabels} isEstop={false} />
        )}

        {/* Status Grid */}
        <main className="flex-1 px-2 sm:px-5 py-2 sm:py-8 flex flex-col gap-2 sm:gap-6">
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-6">
            {components.map((comp) => (
              <StatusCard key={comp.id} component={comp} />
            ))}
          </div>

          {/* Pi Health Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
            <PiHealthCard label="TPS Monitoring" icon="&#x1F4BB;" host="tps" simMode={simMode} />
            <PiHealthCard label="Truck Monitoring" icon="&#x1F69B;" host="truck" simMode={simMode} />
          </div>

          {/* Location & Weather bar */}
          {(() => {
            const plcComp = components.find((c) => c.id === "plc");
            const r = plcComp?.readings;
            if (!r) return null;
            const city = r.location_city as string || "";
            const region = r.location_region as string || "";
            const weather = r.weather as string || "";
            const localTime = r.local_time as string || "";
            if (!city && !weather) return null;
            return (
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-500 bg-gray-900/50 rounded-xl px-4 py-2">
                {localTime && <span className="text-gray-300 font-mono">{localTime}</span>}
                {city && <span>{city}{region ? `, ${region}` : ""}</span>}
                {weather && <span className="text-gray-300">{weather}</span>}
              </div>
            );
          })()}

          {/* PLC Sensor Data Detail Panel */}
          {(() => {
            const plcComp = components.find((c) => c.id === "plc");
            if (plcComp && plcComp.readings && plcComp.status !== "pending") {
              return <PlcDetailPanel readings={plcComp.readings} />;
            }
            return null;
          })()}

          {/* System Diagnostics */}
          {(() => {
            const plcComp = components.find((c) => c.id === "plc");
            if (plcComp && plcComp.readings) {
              return <DiagnosticsPanel readings={plcComp.readings} />;
            }
            return null;
          })()}

          {/* Production History */}
          <HistoryPanel
            summary={historySummary}
            loading={historyLoading}
            error={historyError}
            onRefresh={fetchHistory}
          />

          {/* Truck Diagnostics */}
          <TruckPanel simMode={simMode} />

          {/* Fault History */}
          <FaultHistory events={faultHistory} />
        </main>

        {/* Footer */}
        <footer className="border-t border-gray-800 px-3 sm:px-5 py-2 sm:py-3 text-[10px] sm:text-xs text-gray-700 flex items-center justify-between shrink-0">
          <span>Polling every {pollIntervalMs / 1000}s</span>
          <span>
            Live — Viam Cloud ·{" "}
            {new Date().getFullYear()}
          </span>
        </footer>
      </div>
    </>
  );
}
