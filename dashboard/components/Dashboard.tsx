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
import { UserButton, useUser } from "@clerk/nextjs";
import { useAlarm, FlashOverlay } from "./DashboardAudio";
import { useSensorPolling } from "../hooks/useSensorPolling";

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
      .catch(() => {});
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
            <a
              href="/work"
              className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-amber-600 hover:border-amber-400 text-amber-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">Work</span>
            </a>
            <a
              href="#cell-section"
              className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-emerald-600 hover:border-emerald-400 text-emerald-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">Cell</span>
            </a>
            <a
              href="/chat"
              className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-cyan-600 hover:border-cyan-400 text-cyan-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">Chat</span>
            </a>
            <a
              href="/timesheets"
              className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-indigo-600 hover:border-indigo-400 text-indigo-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.828a1 1 0 101.415-1.414L11 9.586V6z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">Time</span>
            </a>
            <a
              href="/pto"
              className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-rose-600 hover:border-rose-400 text-rose-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">PTO</span>
            </a>
            <a
              href="/accounting"
              className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-amber-600 hover:border-amber-400 text-amber-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">Acctg</span>
            </a>
            <a
              href="/profile"
              className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-violet-600 hover:border-violet-400 text-violet-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">Profile</span>
            </a>
            {userRole !== "operator" && (
              <a
                href="/fleet"
                className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-gray-600 hover:border-purple-500 text-gray-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
                </svg>
                <span className="hidden sm:inline">Fleet</span>
              </a>
            )}
            <a
              href="/training"
              className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-teal-600 hover:border-teal-400 text-teal-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0z" />
              </svg>
              <span className="hidden sm:inline">Training</span>
            </a>
            {isAdmin && (
              <a
                href="/accounting"
                className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-lime-600 hover:border-lime-400 text-lime-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
                </svg>
                <span className="hidden sm:inline">Accounting</span>
              </a>
            )}
            {isAdmin && (
              <a
                href="/payroll"
                className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-lime-600 hover:border-lime-400 text-lime-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                  <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
                </svg>
                <span className="hidden sm:inline">Payroll</span>
              </a>
            )}
            {isAdmin && (
              <a
                href="/admin"
                className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-gray-600 hover:border-purple-500 text-gray-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
                <span className="hidden sm:inline">Admin</span>
              </a>
            )}
            {isDeveloper && (
              <a
                href="/vision"
                className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-pink-600 hover:border-pink-400 text-pink-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                  <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                </svg>
                <span className="hidden sm:inline">Vision</span>
              </a>
            )}
            {isDeveloper && (
              <a
                href="/dev"
                className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-orange-600 hover:border-orange-400 text-orange-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                <span className="hidden sm:inline">Dev</span>
              </a>
            )}
            {isDeveloper && (
              <button
                onClick={() => setDevMode((prev) => !prev)}
                className={`text-[10px] sm:text-xs min-h-[44px] px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition-colors ${
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
          <div className="bg-purple-900/30 border-b border-purple-700/50 px-3 sm:px-5 py-1.5 text-[10px] sm:text-xs text-purple-300">
            Demo Truck — showing simulated data. Select a production truck from the dropdown for live data.
          </div>
        )}

        {/* Alert Banner */}
        {!simMode && activeFaultLabels.length > 0 && (
          <AlertBanner faultNames={activeFaultLabels} isEstop={false} />
        )}

        {/* Truck-off banner — clean messaging when no data flowing */}
        {!simMode && connectionStatus === "truck-off" && (
          <div className="bg-gray-800/50 border-b border-gray-700/50 px-3 sm:px-5 py-2 text-[10px] sm:text-xs text-gray-400 flex items-center gap-2">
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
            <CellSection simMode={simMode} />
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
        <footer className="border-t border-gray-800 px-3 sm:px-5 py-2 sm:py-3 text-[10px] sm:text-xs text-gray-700 flex items-center justify-between shrink-0">
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
