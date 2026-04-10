"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DebugControlsProps {
  data: Record<string, unknown> | null;
  readingKeys: string[];
  lastChangeTimestamps: Record<string, number>;
}

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DebugControls({ data, readingKeys, lastChangeTimestamps }: DebugControlsProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <>
      {/* Live Readings Table */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
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
                  <th className="py-1 pr-3 font-normal hidden sm:table-cell">Unit</th>
                  <th className="py-1 font-normal hidden sm:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody>
                {readingKeys.map((key) => {
                  const val = data![key];
                  const lastTs = lastChangeTimestamps[key];
                  return (
                    <tr key={key} className="border-t border-gray-900/50">
                      <td className="py-1 pr-2">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${freshnessDot(lastTs)}`} />
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

      {/* Raw JSON */}
      <div>
        <button
          onClick={() => setShowRaw((r) => !r)}
          className="min-h-[44px] text-xs font-bold uppercase tracking-widest text-gray-600 hover:text-gray-400 transition-colors"
        >
          {showRaw ? "\u25BC" : "\u25B6"} Raw JSON
        </button>
        {showRaw && data && (
          <div className="mt-2 relative">
            <button
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(data, null, 2));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="absolute top-2 right-2 min-h-[44px] px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <pre className="bg-gray-900/50 border border-gray-800 rounded-lg p-3 text-xs sm:text-xs text-gray-400 font-mono overflow-x-auto max-h-96 overflow-y-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </>
  );
}
