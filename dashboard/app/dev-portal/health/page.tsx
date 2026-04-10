"use client";

import { useState, useEffect, useCallback } from "react";

interface HealthLog {
  id: string;
  source: string;
  status: string;
  response_ms: number | null;
  checked_at: string;
}

interface ServiceStatus {
  source: string;
  status: string;
  responseMs: number | null;
  checkedAt: string;
}

const STATUS_COLORS: Record<string, { dot: string; text: string; bg: string }> = {
  healthy:  { dot: "bg-green-400", text: "text-green-400", bg: "bg-green-500/10" },
  degraded: { dot: "bg-amber-400", text: "text-amber-400", bg: "bg-amber-500/10" },
  down:     { dot: "bg-red-400", text: "text-red-400", bg: "bg-red-500/10" },
  unknown:  { dot: "bg-gray-500", text: "text-gray-500", bg: "bg-gray-500/10" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function HealthPage() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [history, setHistory] = useState<HealthLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setChecking(true);
    const res = await fetch("/api/dev-portal/health");
    if (res.ok) {
      const data = await res.json();
      setServices(data.services || []);
    }
    setChecking(false);
    setLoading(false);
  }, []);

  const fetchHistory = useCallback(async () => {
    // Read from the health logs table via the same endpoint
    // For now, accumulate from repeated checks
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchHistory();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth, fetchHistory]);

  // Accumulate history from service checks
  useEffect(() => {
    if (services.length > 0) {
      setHistory((prev) => {
        const newEntries = services.map((s) => ({
          id: `${s.source}-${s.checkedAt}`,
          source: s.source,
          status: s.status,
          response_ms: s.responseMs,
          checked_at: s.checkedAt,
        }));
        const combined = [...newEntries, ...prev];
        // Keep last 100 entries
        return combined.slice(0, 100);
      });
    }
  }, [services]);

  const filteredHistory = selectedSource
    ? history.filter((h) => h.source === selectedSource)
    : history;

  const sources = [...new Set(history.map((h) => h.source))];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">System Health</h1>
          <p className="text-sm text-gray-500 mt-1">Live service monitoring and response times</p>
        </div>
        <button onClick={fetchHealth} disabled={checking}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors disabled:opacity-50">
          {checking ? "Checking..." : "Check Now"}
        </button>
      </div>

      {/* Service Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {(loading ? Array.from({ length: 6 }, (_, i) => ({
          source: ["Vercel", "Supabase", "Clerk", "Viam", "GitHub", "Pi 5"][i],
          status: "unknown",
          responseMs: null,
          checkedAt: new Date().toISOString(),
        })) : services).map((s) => {
          const c = STATUS_COLORS[s.status] || STATUS_COLORS.unknown;
          return (
            <button key={s.source} onClick={() => setSelectedSource(selectedSource === s.source ? null : s.source)}
              className={`rounded-xl border bg-gray-900/40 p-4 text-left transition-all ${
                selectedSource === s.source ? "border-cyan-600/50" : "border-gray-800 hover:border-gray-700"
              }`}>
              <div className="flex items-center gap-2 mb-3">
                <span className="relative flex h-3 w-3">
                  {s.status === "unknown" || checking ? null : (
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c.dot} opacity-30`} />
                  )}
                  <span className={`relative inline-flex rounded-full h-3 w-3 ${c.dot}`} />
                </span>
                <span className="text-sm font-semibold text-gray-200">{s.source}</span>
              </div>
              <div className={`text-2xl font-black ${c.text}`}>
                {s.responseMs !== null ? `${s.responseMs}ms` : "--"}
              </div>
              <div className={`text-xs capitalize mt-1 ${c.text}`}>{s.status}</div>
            </button>
          );
        })}
      </div>

      {/* Uptime bar visualization */}
      {sources.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">
            Recent Check History
          </h2>
          {sources.map((source) => {
            const sourceHistory = history.filter((h) => h.source === source).slice(0, 20);
            return (
              <div key={source} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-20 shrink-0">{source}</span>
                <div className="flex gap-0.5 flex-1">
                  {sourceHistory.map((h) => {
                    const c = STATUS_COLORS[h.status] || STATUS_COLORS.unknown;
                    return (
                      <div key={h.id} className={`h-6 flex-1 rounded-sm ${c.dot} opacity-80`} title={`${h.status} - ${h.response_ms}ms - ${new Date(h.checked_at).toLocaleTimeString()}`} />
                    );
                  })}
                  {sourceHistory.length < 20 && Array.from({ length: 20 - sourceHistory.length }).map((_, i) => (
                    <div key={`empty-${i}`} className="h-6 flex-1 rounded-sm bg-gray-800/50" />
                  ))}
                </div>
                <span className="text-xs text-gray-600 w-14 text-right shrink-0">
                  {sourceHistory.length > 0 ? `${sourceHistory[0].response_ms || "--"}ms` : "--"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* History Log */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">
            {selectedSource ? `${selectedSource} History` : "All Check History"}
          </h2>
          {selectedSource && (
            <button onClick={() => setSelectedSource(null)} className="text-xs text-cyan-500 hover:text-cyan-400">
              Show All
            </button>
          )}
        </div>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {filteredHistory.length === 0 ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 text-center">
              <p className="text-sm text-gray-600">No health checks recorded yet</p>
            </div>
          ) : filteredHistory.map((h) => {
            const c = STATUS_COLORS[h.status] || STATUS_COLORS.unknown;
            return (
              <div key={h.id} className="flex items-center gap-3 p-2 rounded-lg border border-gray-800/50 bg-gray-900/30">
                <span className={`h-2 w-2 rounded-full ${c.dot} shrink-0`} />
                <span className="text-xs text-gray-400 w-20">{h.source}</span>
                <span className={`text-xs capitalize ${c.text} w-16`}>{h.status}</span>
                <span className="text-xs text-gray-600 w-14 text-right">{h.response_ms ? `${h.response_ms}ms` : "--"}</span>
                <span className="text-xs text-gray-700 ml-auto">{timeAgo(h.checked_at)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
