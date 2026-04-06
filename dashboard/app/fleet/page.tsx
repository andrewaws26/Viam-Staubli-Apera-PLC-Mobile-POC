"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  hasTPSMonitor: boolean;
  hasTruckDiagnostics: boolean;
  error: string | null;
}

interface FleetResponse {
  trucks: TruckStatus[];
  cached: boolean;
  timestamp: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(isoString: string | null): string {
  if (!isoString) return "Never";
  const sec = Math.round((Date.now() - new Date(isoString).getTime()) / 1000);
  if (sec < 10) return "Just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

/** Returns a freshness color class based on data age in seconds. */
function freshnessColor(ageSec: number | null): string {
  if (ageSec === null) return "text-gray-500";
  if (ageSec < 30) return "text-green-400";
  if (ageSec < 300) return "text-yellow-400";
  return "text-red-400";
}

function freshnessDot(ageSec: number | null): string {
  if (ageSec === null) return "bg-gray-600";
  if (ageSec < 30) return "bg-green-400";
  if (ageSec < 300) return "bg-yellow-400";
  return "bg-red-400";
}

function engineLabel(truck: TruckStatus): string {
  if (!truck.hasTruckDiagnostics) return "N/A";
  if (!truck.truckOnline) return "Offline";
  if (truck.engineRunning === null) return "Unknown";
  if (truck.engineRunning) {
    if (truck.engineRpm !== null && truck.engineRpm < 900) return "Idle";
    return "Running";
  }
  return "Off";
}

function engineColor(truck: TruckStatus): string {
  if (!truck.hasTruckDiagnostics || !truck.truckOnline) return "text-gray-500";
  if (truck.engineRunning === null) return "text-gray-400";
  if (truck.engineRunning) return "text-green-400";
  return "text-gray-400";
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function SummaryBar({ trucks }: { trucks: TruckStatus[] }) {
  const online = trucks.filter((t) => t.connected).length;
  const totalDtcs = trucks.reduce((sum, t) => sum + t.dtcCount, 0);
  const alerts = trucks.filter((t) => t.error || (!t.connected && (t.hasTPSMonitor || t.hasTruckDiagnostics))).length;

  return (
    <div className="flex flex-wrap gap-4 mb-6">
      <div className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-4 py-2">
        <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        <span className="text-sm text-gray-300">
          <span className="font-semibold text-white">{online}</span>
          {" / "}{trucks.length} online
        </span>
      </div>
      <div className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-4 py-2">
        <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm text-gray-300">
          <span className="font-semibold text-white">{alerts}</span> alert{alerts !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-4 py-2">
        <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M4.93 4.93l14.14 14.14" />
        </svg>
        <span className="text-sm text-gray-300">
          <span className="font-semibold text-white">{totalDtcs}</span> DTC{totalDtcs !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

function TruckCard({ truck }: { truck: TruckStatus }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 hover:border-purple-500/40 transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-2.5 h-2.5 rounded-full ${freshnessDot(truck.dataAgeSec)} shrink-0`} />
          <h3 className="font-semibold text-white text-base truncate">{truck.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          {truck.dtcCount > 0 && (
            <span className="bg-red-500/20 text-red-400 text-xs font-bold px-2 py-0.5 rounded-full">
              {truck.dtcCount} DTC{truck.dtcCount !== 1 ? "s" : ""}
            </span>
          )}
          <span className={`text-xs ${freshnessColor(truck.dataAgeSec)}`}>
            {timeAgo(truck.lastSeen)}
          </span>
        </div>
      </div>

      {/* Status Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
        {/* Connection */}
        <div className="flex justify-between">
          <span className="text-gray-500">Status</span>
          <span className={truck.connected ? "text-green-400" : "text-red-400"}>
            {truck.connected ? "Live" : "Offline"}
          </span>
        </div>

        {/* Engine */}
        <div className="flex justify-between">
          <span className="text-gray-500">Engine</span>
          <span className={engineColor(truck)}>
            {engineLabel(truck)}
          </span>
        </div>

        {/* TPS Power */}
        {truck.hasTPSMonitor && (
          <div className="flex justify-between">
            <span className="text-gray-500">TPS</span>
            <span className={
              truck.tpsPowerOn === null ? "text-gray-500"
              : truck.tpsPowerOn ? "text-green-400"
              : "text-gray-400"
            }>
              {truck.tpsPowerOn === null ? (truck.tpsOnline ? "Unknown" : "Offline")
               : truck.tpsPowerOn ? "Power ON" : "Power OFF"}
            </span>
          </div>
        )}

        {/* Speed */}
        {truck.hasTPSMonitor && truck.speedFtpm !== null && (
          <div className="flex justify-between">
            <span className="text-gray-500">Speed</span>
            <span className="text-gray-200">
              {truck.speedFtpm.toFixed(1)} ft/min
            </span>
          </div>
        )}

        {/* Plate Rate */}
        {truck.hasTPSMonitor && truck.platesPerMin !== null && (
          <div className="flex justify-between">
            <span className="text-gray-500">Plates/min</span>
            <span className="text-gray-200">
              {truck.platesPerMin.toFixed(1)}
            </span>
          </div>
        )}

        {/* Coolant */}
        {truck.hasTruckDiagnostics && truck.coolantTempF !== null && (
          <div className="flex justify-between">
            <span className="text-gray-500">Coolant</span>
            <span className={truck.coolantTempF > 230 ? "text-red-400" : "text-gray-200"}>
              {Math.round(truck.coolantTempF)}&deg;F
            </span>
          </div>
        )}

        {/* RPM */}
        {truck.hasTruckDiagnostics && truck.engineRpm !== null && (
          <div className="flex justify-between">
            <span className="text-gray-500">RPM</span>
            <span className="text-gray-200">
              {Math.round(truck.engineRpm)}
            </span>
          </div>
        )}
      </div>

      {/* Error banner */}
      {truck.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5 mb-3">
          <p className="text-red-400 text-xs truncate" title={truck.error}>
            {truck.error}
          </p>
        </div>
      )}

      {/* Footer link */}
      <div className="flex justify-end pt-1 border-t border-gray-700/40">
        <Link
          href={`/?truck_id=${truck.id}`}
          className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
        >
          View Details &rarr;
        </Link>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <svg className="w-16 h-16 text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h17.25M3.375 14.25V6.75A2.25 2.25 0 015.625 4.5h12.75a2.25 2.25 0 012.25 2.25v7.5" />
      </svg>
      <h2 className="text-xl font-semibold text-gray-300 mb-2">No trucks configured</h2>
      <p className="text-gray-500 max-w-md mb-4">
        Set the <code className="text-purple-400 bg-gray-800 px-1.5 py-0.5 rounded text-sm">FLEET_TRUCKS</code> environment
        variable with a JSON array of truck configs, or configure single-truck env vars
        (<code className="text-purple-400 bg-gray-800 px-1.5 py-0.5 rounded text-sm">VIAM_PART_ID</code>, etc).
      </p>
      <p className="text-gray-600 text-sm">
        See <code className="text-gray-500">lib/machines.ts</code> for the TruckConfig schema.
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 animate-pulse">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-2.5 h-2.5 rounded-full bg-gray-700" />
            <div className="h-5 w-32 bg-gray-700 rounded" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-full bg-gray-700/50 rounded" />
            <div className="h-4 w-3/4 bg-gray-700/50 rounded" />
            <div className="h-4 w-1/2 bg-gray-700/50 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function FleetPage() {
  const [trucks, setTrucks] = useState<TruckStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet/status");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      const data: FleetResponse = await res.json();
      setTrucks(data.trucks || []);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-lg font-semibold">
              <span className="text-purple-400">IronSight</span>{" "}
              <span className="text-gray-300">Fleet Overview</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {lastRefresh && (
              <span className="text-xs text-gray-500 hidden sm:inline">
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => { setLoading(true); fetchStatus(); }}
              className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-gray-800"
              title="Refresh now"
            >
              <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Error banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-6">
            <p className="text-red-400 text-sm">
              <span className="font-semibold">Fleet query failed:</span> {error}
            </p>
          </div>
        )}

        {loading && trucks.length === 0 ? (
          <LoadingSkeleton />
        ) : trucks.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <SummaryBar trucks={trucks} />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {trucks.map((truck) => (
                <TruckCard key={truck.id} truck={truck} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
