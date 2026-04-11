"use client";

// PRIVACY CONSTRAINT: This dashboard displays machine and component state only.
// No fields identifying operators, shift times, or personnel may be displayed.
// See docs/architecture.md section 6 for the full architectural enforcement.

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StatusCard from "./StatusCard";
import AlertBanner from "./AlertBanner";
import FaultHistory from "./FaultHistory";
import PlcDetailPanel from "./PlcDetailPanel";
import DiagnosticsPanel from "./DiagnosticsPanel";
import HistoryPanel from "./HistoryPanel";
import TruckPanel from "./TruckPanel";
import { CellSection } from "./Cell";
import ConnectionDot from "./ConnectionDot";
import DevDiagnostics from "./DevDiagnostics";
import ElectricalPanel from "./ElectricalPanel";
import { UserButton, useUser } from "@clerk/nextjs";
import { useAlarm, FlashOverlay } from "./DashboardAudio";
import { useSensorPolling } from "../hooks/useSensorPolling";
import { useToast } from "@/components/Toast";

interface TruckListItem {
  id: string;
  name: string;
  hasTPSMonitor: boolean;
  hasTruckDiagnostics: boolean;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export default function Dashboard({ truckId }: { truckId?: string }) {
  const playAlarm = useAlarm();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useUser();
  const userRole = (user?.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  const isAdmin = userRole === "developer" || userRole === "manager";
  const isDeveloper = userRole === "developer";
  const [devMode, setDevMode] = useState(false);

  // Track truck readings for dev diagnostics
  const [truckReadings, setTruckReadings] = useState<Record<string, unknown> | null>(null);

  const [trucks, setTrucks] = useState<TruckListItem[]>([]);

  useEffect(() => {
    fetch("/api/fleet/trucks")
      .then((r) => r.json())
      .then((data) => setTrucks(Array.isArray(data) ? data : []))
      .catch(() => toast("Failed to load fleet data"));
  }, []);

  const currentTruck = trucks.find((t) => t.id === truckId) ?? trucks[0];
  const showSelector = trucks.length > 1;

  function switchTruck(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("truck_id", id);
    router.push(`/?${params.toString()}`);
  }

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
    pollIntervalMs,
  } = useSensorPolling(playAlarm, truckId);

  return (
    <>
      <FlashOverlay flashKey={flashKey} />

      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        {/* ---------------------------------------------------------------- */}
        {/* Header                                                           */}
        {/* ---------------------------------------------------------------- */}
        <header className="border-b border-gray-800 px-3 sm:px-5 py-2 sm:py-3 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <a href="/" className="flex items-center gap-2 shrink-0 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center shadow-lg shadow-violet-900/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                  <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                </svg>
              </div>
            </a>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-black tracking-widest uppercase text-gray-100 leading-none">
                {currentTruck?.name || "TPS Monitor"}
              </h1>
              <p className="text-xs text-gray-500 mt-0.5 tracking-wide truncate">
                IronSight — Live Production & Fleet Data
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {showSelector && (
              <select
                value={truckId ?? currentTruck?.id ?? ""}
                onChange={(e) => switchTruck(e.target.value)}
                className="min-h-[44px] px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs sm:text-sm font-bold uppercase tracking-wider cursor-pointer hover:border-purple-500 transition-colors focus:outline-none focus:border-purple-500"
              >
                {trucks.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            <a
              href="/shift-report"
              className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm2 10a1 1 0 10-2 0v3a1 1 0 102 0v-3zm2-3a1 1 0 011 1v5a1 1 0 11-2 0v-5a1 1 0 011-1zm4 2a1 1 0 10-2 0v3a1 1 0 102 0v-3z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">Shift Report</span>
            </a>
            {isDeveloper && (
              <button
                onClick={() => setDevMode((prev) => !prev)}
                className={`text-xs sm:text-xs min-h-[44px] px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition-colors ${
                  devMode
                    ? "bg-amber-700 text-white"
                    : "border border-gray-700 text-gray-500 hover:text-amber-400 hover:border-amber-700"
                }`}
              >
                {devMode ? "DEV ON" : "DEV"}
              </button>
            )}
            <ConnectionDot
              status={connectionStatus}
              dataAge={connectionDataAge}
              error={connectionError}
            />
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "w-9 h-9",
                },
              }}
            />
          </div>
        </header>
        {simMode && (
          <div className="bg-purple-900/30 border-b border-purple-700/50 px-3 sm:px-5 py-1.5 text-xs sm:text-xs text-purple-300">
            Demo Truck — showing simulated data. Select a production truck from the dropdown for live data.
          </div>
        )}

        {/* Alert Banner */}
        {!simMode && activeFaultLabels.length > 0 && (
          <AlertBanner faultNames={activeFaultLabels} isEstop={false} />
        )}

        {/* Truck-off banner — clean messaging when no data flowing */}
        {!simMode && connectionStatus === "truck-off" && (
          <div className="bg-gray-800/50 border-b border-gray-800/60 px-3 sm:px-5 py-2 text-xs sm:text-xs text-gray-400 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gray-600" />
            Truck is off — waiting for data. Readings will appear when the truck powers on.
          </div>
        )}

        {/* Status Grid */}
        <main className="flex-1 px-2 sm:px-5 py-2 sm:py-8 flex flex-col gap-2 sm:gap-6">
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-6">
            {components.map((comp) => (
              <StatusCard key={comp.id} component={comp} />
            ))}
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
          <TruckPanel simMode={simMode} truckId={truckId} onReadingsChange={devMode ? setTruckReadings : undefined} />

          {/* Robot Cell Monitoring — Staubli + Apera + Watchdog */}
          <div id="cell-section">
            <CellSection simMode={simMode} truckId={truckId} />
          </div>

          {/* Electrical Systems — Future Hardware Integration */}
          <div id="electrical-section">
            <ElectricalPanel />
          </div>

          {/* Dev Diagnostics — developer role only */}
          {devMode && isDeveloper && (
            <DevDiagnostics
              components={components}
              truckReadings={truckReadings}
              connectionStatus={connectionStatus}
              connectionError={connectionError}
            />
          )}

          {/* Fault History */}
          <FaultHistory events={faultHistory} />
        </main>

        {/* Footer */}
        <footer className="border-t border-gray-800 px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-xs text-gray-700 flex items-center justify-between shrink-0">
          <span>Polling every {pollIntervalMs / 1000}s{simMode ? " (demo)" : ""}</span>
          <span>
            Live — Viam Cloud ·{" "}
            {new Date().getFullYear()}
          </span>
        </footer>
      </div>
    </>
  );
}
