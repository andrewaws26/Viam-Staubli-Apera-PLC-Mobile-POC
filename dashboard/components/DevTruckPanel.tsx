"use client";

import { useState, useEffect, useRef } from "react";
import BusStatsPanel from "./DevTruck/BusStatsPanel";
import CommandPanel from "./DevTruck/CommandPanel";
import DebugControls from "./DevTruck/DebugControls";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Readings = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const POLL_MS = 2000;

// Meta / internal fields excluded from the readings table
const META_KEYS = new Set([
  "_data_age_seconds",
  "_offline",
  "_reason",
  "_protocol",
  "_frames_total",
]);

// DTC-related keys shown in their own section
const DTC_KEYS = new Set([
  "active_dtcs",
  "pending_dtcs",
  "permanent_dtcs",
  "active_dtc_count",
  "dtc_count",
  "dtc_mil_status",
  "freeze_frame",
  "readiness_monitors",
]);

const CONNECTION_KEYS = new Set([
  "vin",
  "vehicle_make",
  "vehicle_model",
  "vehicle_year",
  "can_bitrate",
  "frames_per_second",
  "bus_load_pct",
]);

const HEALTH_KEYS = new Set([
  "cpu_temp_c",
  "cpu_usage_pct",
  "load_1m",
  "load_5m",
  "memory_total_mb",
  "memory_used_mb",
  "memory_used_pct",
  "disk_used_pct",
  "disk_free_gb",
  "wifi_ssid",
  "wifi_signal_pct",
  "wifi_signal_dbm",
  "tailscale_ip",
  "tailscale_online",
  "internet",
  "uptime_seconds",
  "sync_pending_files",
  "sync_pending_mb",
  "sync_oldest_age_min",
  "sync_failed_files",
  "sync_ok",
]);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DevTruckPanel() {
  const [expanded, setExpanded] = useState(true);
  const [data, setData] = useState<Readings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  // Freshness tracking
  const lastChangeRef = useRef<Record<string, number>>({});
  const prevDataRef = useRef<Readings | null>(null);

  // -----------------------------------------------------------------------
  // Polling
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/truck-readings?component=truck-engine");
        const json: Readings = await res.json();
        if (cancelled) return;

        const now = Date.now();
        const prev = prevDataRef.current;
        if (prev) {
          for (const key of Object.keys(json)) {
            if (JSON.stringify(json[key]) !== JSON.stringify(prev[key])) {
              lastChangeRef.current[key] = now;
            }
          }
        } else {
          for (const key of Object.keys(json)) {
            lastChangeRef.current[key] = now;
          }
        }
        prevDataRef.current = { ...json };

        setData(json);
        setError(null);
        setPollCount((c) => c + 1);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [expanded]);

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------
  const isOffline = data?._offline === true;
  const protocol = data?._protocol as string | undefined;

  const readingKeys = data
    ? Object.keys(data)
        .filter(
          (k) =>
            !META_KEYS.has(k) &&
            !DTC_KEYS.has(k) &&
            !CONNECTION_KEYS.has(k) &&
            !HEALTH_KEYS.has(k) &&
            !k.startsWith("_")
        )
        .sort((a, b) => {
          const aT = lastChangeRef.current[a] || 0;
          const bT = lastChangeRef.current[b] || 0;
          return bT - aT;
        })
    : [];

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <section className="border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full min-h-[44px] p-4 sm:p-5 flex items-center justify-between gap-3 text-left hover:bg-gray-900/30 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              data && !isOffline && !error
                ? "bg-green-500"
                : error
                  ? "bg-red-500"
                  : "bg-gray-600"
            }`}
          />
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
            Pi Zero &mdash; Truck Diagnostics
          </h2>
          {protocol && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 uppercase font-bold tracking-wider">
              {protocol}
            </span>
          )}
        </div>
        <span className="text-gray-600 text-xs shrink-0">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {expanded && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-5">
          {/* Error banner */}
          {error && (
            <div className="p-3 bg-red-950/30 border border-red-900/50 rounded-lg text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Offline banner */}
          {isOffline && (
            <div className="p-3 bg-yellow-950/30 border border-yellow-900/50 rounded-lg text-xs text-yellow-400">
              Pi Zero offline &mdash;{" "}
              {(data?._reason as string) || "no recent data"}
            </div>
          )}

          <BusStatsPanel
            data={data}
            isOffline={isOffline}
            protocol={protocol}
            pollCount={pollCount}
          />

          <DebugControls
            data={data}
            readingKeys={readingKeys}
            lastChangeTimestamps={lastChangeRef.current}
          />

          <CommandPanel data={data} />
        </div>
      )}
    </section>
  );
}
