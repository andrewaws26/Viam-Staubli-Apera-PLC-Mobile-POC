"use client";

import { useState, useEffect, useCallback } from "react";

interface DTCRecord {
  id: string;
  truck_id: string;
  spn: number;
  fmi: number;
  source_address: number | null;
  description: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  cleared_at: string | null;
  active: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function durationStr(from: string, to: string): string {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return `${Math.floor(ms / 60000)}m`;
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export default function DTCHistory({ truckId }: { truckId?: string }) {
  const [records, setRecords] = useState<DTCRecord[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(false);

  const effectiveTruckId = truckId ?? "default";

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ truck_id: effectiveTruckId, limit: "100" });
      if (!showAll) params.set("active", "true");
      const res = await fetch(`/api/dtc-history?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [effectiveTruckId, showAll]);

  useEffect(() => {
    if (expanded) fetchHistory();
  }, [expanded, fetchHistory]);

  const activeCount = records.filter((r) => r.active).length;
  const clearedCount = records.filter((r) => !r.active).length;

  return (
    <div className="bg-gray-900/30 rounded-2xl border border-gray-800 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full min-h-[44px] px-3 sm:px-5 py-3 flex items-center justify-between gap-2 hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm sm:text-base font-bold text-gray-200">DTC History</span>
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-600/30 text-red-300 text-xs font-bold">
              {activeCount} active
            </span>
          )}
          {clearedCount > 0 && expanded && (
            <span className="px-1.5 py-0.5 rounded-full bg-gray-600/30 text-gray-400 text-xs font-bold">
              {clearedCount} cleared
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 sm:px-5 pb-4 space-y-3">
          {/* Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setShowAll(false)}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                !showAll ? "bg-red-600/30 text-red-300" : "bg-gray-800 text-gray-500 hover:text-gray-300"
              }`}
            >
              Active Only
            </button>
            <button
              onClick={() => setShowAll(true)}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                showAll ? "bg-gray-600/30 text-gray-300" : "bg-gray-800 text-gray-500 hover:text-gray-300"
              }`}
            >
              All History
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
            </div>
          ) : records.length === 0 ? (
            <p className="text-xs text-gray-600 py-4 text-center">
              {showAll ? "No DTC history recorded yet." : "No active DTCs."}
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {records.map((rec) => (
                <div
                  key={rec.id}
                  className={`bg-gray-800/50 rounded-lg px-3 py-2.5 border ${
                    rec.active ? "border-red-600/20" : "border-transparent"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${rec.active ? "bg-red-500" : "bg-gray-600"}`} />
                      <span className="text-xs font-bold text-gray-200">
                        SPN {rec.spn} / FMI {rec.fmi}
                      </span>
                      {rec.source_address != null && (
                        <span className="text-xs text-gray-600">SA 0x{rec.source_address.toString(16).padStart(2, "0")}</span>
                      )}
                    </div>
                    <span className={`text-xs font-bold ${rec.active ? "text-red-400" : "text-gray-600"}`}>
                      {rec.active ? "ACTIVE" : "CLEARED"}
                    </span>
                  </div>
                  {rec.description && (
                    <p className="text-xs text-gray-400 mt-1">{rec.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                    <span>First: {formatDate(rec.first_seen_at)}</span>
                    <span>Last: {formatDate(rec.last_seen_at)}</span>
                    <span>Duration: {durationStr(rec.first_seen_at, rec.cleared_at || rec.last_seen_at)}</span>
                    {rec.occurrence_count > 1 && (
                      <span className="text-amber-400">{rec.occurrence_count}x</span>
                    )}
                    {rec.cleared_at && (
                      <span className="text-green-400">Cleared {formatDate(rec.cleared_at)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
