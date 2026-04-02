"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferUnit(key: string): string {
  if (/_f$/.test(key) || /temp_f/.test(key)) return "\u00B0F";
  if (/_c$/.test(key)) return "\u00B0C";
  if (/_psi$/.test(key) || /pressure_psi/.test(key)) return "PSI";
  if (/_mph$/.test(key) || /speed_mph/.test(key)) return "mph";
  if (/_rpm$/.test(key) || /engine_rpm/.test(key)) return "RPM";
  if (/voltage/.test(key)) return "V";
  if (/_gph$/.test(key)) return "gal/hr";
  if (/_pct$/.test(key) || /percent/.test(key)) return "%";
  if (/_deg$/.test(key)) return "\u00B0";
  if (/_gps$/.test(key)) return "g/s";
  return "";
}

function fmtVal(v: unknown): string {
  if (v === undefined || v === null) return "\u2014";
  if (typeof v === "boolean") return v ? "ON" : "OFF";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(2);
  }
  return String(v);
}

function freshnessDot(ts: number | undefined): string {
  if (!ts) return "bg-gray-600";
  const age = Date.now() - ts;
  if (age < 5000) return "bg-green-500";
  if (age < 10000) return "bg-green-700";
  if (age < 30000) return "bg-yellow-500";
  return "bg-red-500";
}

function freshnessAge(ts: number | undefined): string {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 1) return "now";
  return `${s}s`;
}

function extractDtcs(
  data: Readings | null,
  key: string
): { code: string; desc: string }[] {
  if (!data || !data[key]) return [];
  let raw = data[key];
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(
        raw
          .replace(/'/g, '"')
          .replace(/True/g, "true")
          .replace(/False/g, "false")
          .replace(/None/g, "null")
      );
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((item: unknown) => {
    if (typeof item === "string") return { code: item, desc: "" };
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      return {
        code: String(obj.code || obj.dtc || obj.spn || ""),
        desc: String(obj.description || obj.desc || obj.message || ""),
      };
    }
    return { code: String(item), desc: "" };
  });
}

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

  // DTC clear
  const [clearingDtc, setClearingDtc] = useState(false);
  const [dtcResult, setDtcResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  // Raw JSON
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  // -----------------------------------------------------------------------
  // Polling
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          "/api/truck-readings?component=truck-engine"
        );
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
  // Clear DTCs
  // -----------------------------------------------------------------------
  const clearDtcs = useCallback(async () => {
    setClearingDtc(true);
    setDtcResult(null);
    try {
      const res = await fetch("/api/truck-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "clear_dtcs" }),
      });
      const json = await res.json();
      setDtcResult({
        ok: !json.error,
        msg: json.error || json.message || "DTCs cleared successfully",
      });
    } catch (err) {
      setDtcResult({
        ok: false,
        msg: err instanceof Error ? err.message : "Failed",
      });
    } finally {
      setClearingDtc(false);
    }
  }, []);

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------
  const isOffline = data?._offline === true;
  const protocol = data?._protocol as string | undefined;
  const dataAge = data?._data_age_seconds as number | undefined;
  const vin = data?.vin as string | undefined;
  const vehicleMake = data?.vehicle_make as string | undefined;
  const vehicleModel = data?.vehicle_model as string | undefined;
  const vehicleYear = data?.vehicle_year as number | undefined;
  const canBitrate = data?.can_bitrate as number | undefined;
  const framesPerSec = data?.frames_per_second as number | undefined;
  const busLoad = data?.bus_load_pct as number | undefined;

  const activeDtcs = extractDtcs(data, "active_dtcs");
  const pendingDtcs = extractDtcs(data, "pending_dtcs");
  const permanentDtcs = extractDtcs(data, "permanent_dtcs");
  const dtcCount =
    typeof data?.active_dtc_count === "number"
      ? data.active_dtc_count
      : typeof data?.dtc_count === "number"
        ? data.dtc_count
        : activeDtcs.length;
  const milOn = data?.dtc_mil_status === true;

  // Reading keys: exclude meta, DTC, and known connection fields
  const connectionKeys = new Set([
    "vin",
    "vehicle_make",
    "vehicle_model",
    "vehicle_year",
    "can_bitrate",
    "frames_per_second",
    "bus_load_pct",
  ]);
  const readingKeys = data
    ? Object.keys(data)
        .filter(
          (k) =>
            !META_KEYS.has(k) &&
            !DTC_KEYS.has(k) &&
            !connectionKeys.has(k) &&
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
        className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left hover:bg-gray-900/30 transition-colors"
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

          {/* ============================================================= */}
          {/* Connection & Protocol                                          */}
          {/* ============================================================= */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
              Connection &amp; Protocol
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
              <KV
                label="Protocol"
                value={
                  protocol
                    ? protocol.toUpperCase()
                    : isOffline
                      ? "Offline"
                      : "Detecting\u2026"
                }
              />
              <KV
                label="CAN Bitrate"
                value={
                  canBitrate
                    ? `${canBitrate / 1000}k`
                    : "\u2014"
                }
              />
              <KV label="VIN" value={vin || "\u2014"} mono />
              {vehicleMake && (
                <KV
                  label="Vehicle"
                  value={`${vehicleYear || ""} ${vehicleMake} ${vehicleModel || ""}`.trim()}
                />
              )}
              <KV
                label="Frames/sec"
                value={
                  framesPerSec !== undefined
                    ? framesPerSec.toLocaleString()
                    : "\u2014"
                }
              />
              <KV
                label="Bus Load"
                value={
                  busLoad !== undefined ? `${busLoad.toFixed(1)}%` : "\u2014"
                }
              />
              <KV
                label="Data Age"
                value={
                  dataAge !== undefined
                    ? dataAge < 5
                      ? "live"
                      : `${Math.round(dataAge)}s`
                    : "\u2014"
                }
              />
              <KV label="Poll #" value={String(pollCount)} />
            </div>
          </div>

          {/* ============================================================= */}
          {/* Live Readings Table                                            */}
          {/* ============================================================= */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
              Live Readings ({readingKeys.length} fields)
            </h3>
            {readingKeys.length === 0 ? (
              <p className="text-xs text-gray-700 animate-pulse">
                {data ? "No reading fields available" : "Waiting for first reading\u2026"}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-700 text-left">
                      <th className="py-1 pr-2 font-normal w-4"></th>
                      <th className="py-1 pr-3 font-normal">Field</th>
                      <th className="py-1 pr-3 font-normal">Value</th>
                      <th className="py-1 pr-3 font-normal hidden sm:table-cell">
                        Unit
                      </th>
                      <th className="py-1 font-normal hidden sm:table-cell">
                        Updated
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {readingKeys.map((key) => {
                      const val = data![key];
                      const lastTs = lastChangeRef.current[key];
                      return (
                        <tr
                          key={key}
                          className="border-t border-gray-900/50"
                        >
                          <td className="py-1 pr-2">
                            <span
                              className={`inline-block w-1.5 h-1.5 rounded-full ${freshnessDot(lastTs)}`}
                            />
                          </td>
                          <td className="py-1 pr-3 font-mono text-gray-500 whitespace-nowrap">
                            {key}
                          </td>
                          <td className="py-1 pr-3 font-mono font-bold text-gray-200 whitespace-nowrap">
                            {fmtVal(val)}
                          </td>
                          <td className="py-1 pr-3 text-gray-600 hidden sm:table-cell">
                            {inferUnit(key)}
                          </td>
                          <td className="py-1 text-gray-600 font-mono hidden sm:table-cell">
                            {freshnessAge(lastTs)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ============================================================= */}
          {/* DTC Panel                                                      */}
          {/* ============================================================= */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
              Diagnostic Trouble Codes
              {(dtcCount as number) > 0 && (
                <span className="ml-2 text-red-400 normal-case tracking-normal font-normal">
                  &mdash; {dtcCount} active
                </span>
              )}
              {milOn && (
                <span className="ml-2 text-yellow-400 normal-case tracking-normal font-normal">
                  (MIL ON)
                </span>
              )}
            </h3>

            {/* Active DTCs */}
            {activeDtcs.length > 0 ? (
              <div className="space-y-1 mb-3">
                {activeDtcs.map((dtc, i) => (
                  <div
                    key={`a-${i}`}
                    className="flex items-start gap-2 py-1.5 px-2 rounded bg-red-950/20 text-xs"
                  >
                    <span className="font-mono font-bold text-red-400 shrink-0">
                      [{dtc.code}]
                    </span>
                    <span className="text-gray-400">
                      {dtc.desc || "No description"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-700 mb-3">
                No active DTCs
              </p>
            )}

            {/* Pending DTCs */}
            {pendingDtcs.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] uppercase tracking-wider text-yellow-600 font-bold mb-1">
                  Pending
                </p>
                <div className="space-y-1">
                  {pendingDtcs.map((dtc, i) => (
                    <div
                      key={`p-${i}`}
                      className="flex items-start gap-2 py-1 px-2 rounded bg-yellow-950/20 text-xs"
                    >
                      <span className="font-mono font-bold text-yellow-400 shrink-0">
                        [{dtc.code}]
                      </span>
                      <span className="text-gray-400">{dtc.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Permanent DTCs */}
            {permanentDtcs.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                  Permanent
                </p>
                <div className="space-y-1">
                  {permanentDtcs.map((dtc, i) => (
                    <div
                      key={`pm-${i}`}
                      className="flex items-start gap-2 py-1 px-2 rounded bg-gray-900/30 text-xs"
                    >
                      <span className="font-mono font-bold text-gray-400 shrink-0">
                        [{dtc.code}]
                      </span>
                      <span className="text-gray-500">{dtc.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clear DTCs */}
            <div className="flex items-center gap-3">
              <button
                onClick={clearDtcs}
                disabled={clearingDtc}
                className="px-4 py-2 bg-red-800 hover:bg-red-700 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors"
              >
                {clearingDtc ? "Clearing\u2026" : "Clear DTCs"}
              </button>
              {dtcResult && (
                <span
                  className={`text-xs ${dtcResult.ok ? "text-green-400" : "text-red-400"}`}
                >
                  {dtcResult.ok ? "\u2713" : "\u2715"} {dtcResult.msg}
                </span>
              )}
            </div>
          </div>

          {/* ============================================================= */}
          {/* Raw JSON                                                       */}
          {/* ============================================================= */}
          <div>
            <button
              onClick={() => setShowRaw((r) => !r)}
              className="text-[10px] font-bold uppercase tracking-widest text-gray-600 hover:text-gray-400 transition-colors"
            >
              {showRaw ? "\u25BC" : "\u25B6"} Raw JSON
            </button>
            {showRaw && data && (
              <div className="mt-2 relative">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      JSON.stringify(data, null, 2)
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="absolute top-2 right-2 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 text-[10px] rounded transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <pre className="bg-gray-900/50 border border-gray-800 rounded-lg p-3 text-[10px] sm:text-xs text-gray-400 font-mono overflow-x-auto max-h-96 overflow-y-auto">
                  {JSON.stringify(data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] text-gray-600 uppercase tracking-wide truncate">
        {label}
      </span>
      <span
        className={`text-xs sm:text-sm text-gray-300 truncate ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
