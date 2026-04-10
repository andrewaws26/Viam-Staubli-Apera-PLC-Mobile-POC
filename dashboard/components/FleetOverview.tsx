"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";

interface TruckStatus {
  id: string;
  name: string;
  lastSeen: string | null;
  dataAgeSec: number | null;
  connected: boolean;
  tpsOnline: boolean;
  plateCount: number | null;
  platesPerMin: number | null;
  speedFtpm: number | null;
  tpsPowerOn: boolean | null;
  truckOnline: boolean;
  engineRpm: number | null;
  engineRunning: boolean | null;
  dtcCount: number;
  coolantTempF: number | null;
  locationCity: string | null;
  locationRegion: string | null;
  weather: string | null;
  assignedPersonnel: { name: string; role: string }[];
  maintenanceOverdue: number;
  maintenanceDueSoon: number;
  hasTPSMonitor: boolean;
  hasTruckDiagnostics: boolean;
  error: string | null;
}

function timeAgo(isoStr: string): string {
  const sec = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StatusDot({ connected, hasData }: { connected: boolean; hasData: boolean }) {
  if (!hasData) return <span className="w-2.5 h-2.5 rounded-full bg-gray-600" title="No data" />;
  return (
    <span
      className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" : "bg-red-500"}`}
      title={connected ? "Connected" : "Offline"}
    />
  );
}

export default function FleetOverview() {
  const router = useRouter();
  const { user } = useUser();
  const userRole = (user?.publicMetadata as Record<string, unknown>)?.role as string || "operator";
  const isAdmin = userRole === "developer" || userRole === "manager";

  const [trucks, setTrucks] = useState<TruckStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTrucks(Array.isArray(data.trucks) ? data.trucks : []);
      setError(null);
      setLastRefresh(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load fleet status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Summary stats
  const totalTrucks = trucks.length;
  const onlineCount = trucks.filter((t) => t.connected).length;
  const offlineCount = totalTrucks - onlineCount;
  const totalDtcs = trucks.reduce((sum, t) => sum + t.dtcCount, 0);
  const enginesRunning = trucks.filter((t) => t.engineRunning).length;
  const tpsActive = trucks.filter((t) => t.tpsOnline && t.tpsPowerOn).length;
  const maintOverdue = trucks.reduce((sum, t) => sum + t.maintenanceOverdue, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-black tracking-widest uppercase text-gray-100 leading-none">
            Fleet Overview
          </h1>
          <p className="text-xs sm:text-xs text-gray-600 mt-0.5 tracking-wide">
            IronSight — All Trucks at a Glance
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
          <a
            href="/work"
            className="min-h-[44px] px-3 sm:px-4 py-2 rounded-lg border border-amber-600 hover:border-amber-400 text-amber-300 hover:text-white text-xs sm:text-sm font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
            </svg>
            <span className="hidden sm:inline">Work Board</span>
          </a>
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
          <UserButton
            appearance={{
              elements: { avatarBox: "w-9 h-9" },
            }}
          />
        </div>
      </header>

      <main className="flex-1 px-3 sm:px-6 py-4 sm:py-6 max-w-7xl mx-auto w-full">
        {/* Summary bar */}
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3 mb-4 sm:mb-6">
          <SummaryCard label="Total" value={totalTrucks} color="text-gray-100" />
          <SummaryCard label="Online" value={onlineCount} color="text-green-400" />
          <SummaryCard label="Offline" value={offlineCount} color={offlineCount > 0 ? "text-red-400" : "text-gray-500"} />
          <SummaryCard label="Engines On" value={enginesRunning} color="text-blue-400" />
          <SummaryCard label="TPS Active" value={tpsActive} color="text-purple-400" />
          <SummaryCard label="Active DTCs" value={totalDtcs} color={totalDtcs > 0 ? "text-amber-400" : "text-gray-500"} />
          <SummaryCard label="Maint Due" value={maintOverdue} color={maintOverdue > 0 ? "text-red-400" : "text-gray-500"} />
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        )}
        {error && !loading && (
          <div className="text-sm text-red-400 bg-red-900/20 rounded-xl px-4 py-3 mb-4">
            {error}
            <button onClick={fetchStatus} className="ml-2 underline hover:text-red-300">Retry</button>
          </div>
        )}

        {/* Truck grid */}
        {!loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {trucks.map((truck) => (
              <TruckCard
                key={truck.id}
                truck={truck}
                onClick={() => router.push(`/?truck_id=${truck.id}`)}
              />
            ))}
            {trucks.length === 0 && !error && (
              <div className="col-span-full text-center py-16 text-gray-600">
                <p className="text-lg font-bold">No trucks configured</p>
                <p className="text-sm mt-1">Add trucks to config/fleet.json or the FLEET_TRUCKS env var</p>
              </div>
            )}
          </div>
        )}

        {/* Refresh indicator */}
        {!loading && trucks.length > 0 && (
          <div className="flex items-center justify-center gap-2 mt-6 text-xs text-gray-600">
            <span>Auto-refresh every 10s</span>
            <span>·</span>
            <span>Last: {timeAgo(new Date(lastRefresh).toISOString())}</span>
            <button onClick={fetchStatus} className="underline hover:text-gray-400 ml-1">Refresh now</button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-3 sm:px-5 py-2 sm:py-3 text-xs sm:text-xs text-gray-700 flex items-center justify-between shrink-0">
        <span>{totalTrucks} truck{totalTrucks !== 1 ? "s" : ""} in fleet</span>
        <span>IronSight Fleet Monitor · {new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary stat card
// ---------------------------------------------------------------------------
function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-gray-900/60 rounded-xl border border-gray-800 px-3 py-2.5 text-center">
      <div className={`text-xl sm:text-2xl font-black ${color}`}>{value}</div>
      <div className="text-xs sm:text-xs text-gray-500 font-medium uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual truck card
// ---------------------------------------------------------------------------
function TruckCard({ truck, onClick }: { truck: TruckStatus; onClick: () => void }) {
  const hasData = truck.lastSeen !== null;

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-gray-900/50 hover:bg-gray-800/60 rounded-2xl border border-gray-800 hover:border-gray-600 transition-all p-4 sm:p-5 group"
    >
      {/* Top row: name + status */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot connected={truck.connected} hasData={hasData} />
          <h3 className="text-sm sm:text-base font-bold text-gray-100 truncate group-hover:text-white transition-colors">
            {truck.name}
          </h3>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {truck.maintenanceOverdue > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-600/30 text-red-300 text-xs font-bold">
              {truck.maintenanceOverdue} overdue
            </span>
          )}
          {truck.maintenanceDueSoon > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-600/20 text-amber-300 text-xs font-bold">
              {truck.maintenanceDueSoon} due
            </span>
          )}
          {truck.dtcCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-600/30 text-amber-300 text-xs font-bold">
              {truck.dtcCount} DTC{truck.dtcCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Location */}
      {(truck.locationCity || truck.weather) && (
        <div className="flex items-center gap-1.5 mb-3 text-xs text-gray-500">
          <svg className="w-3.5 h-3.5 shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="truncate">
            {truck.locationCity}{truck.locationRegion ? `, ${truck.locationRegion}` : ""}
            {truck.weather ? ` · ${truck.weather}` : ""}
          </span>
        </div>
      )}

      {/* Assigned personnel */}
      <div className="flex items-start gap-1.5 mb-3 text-xs">
        <svg className="w-3.5 h-3.5 shrink-0 text-gray-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {truck.assignedPersonnel.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {truck.assignedPersonnel.map((p, i) => (
              <span
                key={i}
                className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                  p.role === "mechanic" ? "bg-green-600/20 text-green-400" :
                  p.role === "operator" ? "bg-gray-600/30 text-gray-400" :
                  p.role === "manager" ? "bg-blue-600/20 text-blue-400" :
                  "bg-purple-600/20 text-purple-400"
                }`}
              >
                {p.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-gray-600 italic">No one assigned</span>
        )}
      </div>

      {/* Status rows */}
      <div className="space-y-2">
        {/* TPS row */}
        {truck.hasTPSMonitor && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">TPS</span>
            {truck.tpsOnline ? (
              <div className="flex items-center gap-3">
                <span className="text-gray-300">
                  <span className="text-purple-400 font-bold">{truck.plateCount ?? "—"}</span> plates
                </span>
                <span className="text-gray-400">
                  {truck.platesPerMin != null ? `${truck.platesPerMin.toFixed(1)}/min` : "—"}
                </span>
                {truck.speedFtpm != null && (
                  <span className="text-gray-500">{truck.speedFtpm.toFixed(0)} ft/m</span>
                )}
              </div>
            ) : (
              <span className="text-gray-600">Offline</span>
            )}
          </div>
        )}

        {/* Engine row */}
        {truck.hasTruckDiagnostics && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Engine</span>
            {truck.truckOnline ? (
              <div className="flex items-center gap-3">
                <span className={truck.engineRunning ? "text-green-400 font-bold" : "text-gray-500"}>
                  {truck.engineRunning ? "Running" : "Off"}
                </span>
                {truck.engineRpm != null && (
                  <span className="text-gray-400">{Math.round(truck.engineRpm)} RPM</span>
                )}
                {truck.coolantTempF != null && (
                  <span className="text-gray-500">{Math.round(truck.coolantTempF)}°F</span>
                )}
              </div>
            ) : (
              <span className="text-gray-600">Offline</span>
            )}
          </div>
        )}

        {/* Last seen */}
        <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-800/50">
          <span className="text-gray-600">Last seen</span>
          <span className={`${truck.connected ? "text-gray-400" : "text-gray-600"}`}>
            {truck.lastSeen ? timeAgo(truck.lastSeen) : "Never"}
          </span>
        </div>
      </div>

      {/* Error */}
      {truck.error && (
        <div className="mt-2 text-xs text-red-400/70 truncate" title={truck.error}>
          {truck.error}
        </div>
      )}

      {/* Hover arrow */}
      <div className="flex justify-end mt-2">
        <svg
          className="w-4 h-4 text-gray-700 group-hover:text-purple-400 transition-colors"
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}
