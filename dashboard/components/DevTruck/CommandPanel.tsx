"use client";

import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandPanelProps {
  data: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDtcs(
  data: Record<string, unknown> | null,
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

export default function CommandPanel({ data }: CommandPanelProps) {
  const [clearingDtc, setClearingDtc] = useState(false);
  const [dtcResult, setDtcResult] = useState<{ ok: boolean; msg: string } | null>(null);

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

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
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
        <p className="text-xs text-gray-700 mb-3">No active DTCs</p>
      )}

      {/* Pending DTCs */}
      {pendingDtcs.length > 0 && (
        <div className="mb-3">
          <p className="text-xs uppercase tracking-wider text-yellow-600 font-bold mb-1">
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
          <p className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">
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
          className="min-h-[44px] px-4 py-2 bg-red-800 hover:bg-red-700 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors"
        >
          {clearingDtc ? "Clearing\u2026" : "Clear DTCs"}
        </button>
        {dtcResult && (
          <span className={`text-xs ${dtcResult.ok ? "text-green-400" : "text-red-400"}`}>
            {dtcResult.ok ? "\u2713" : "\u2715"} {dtcResult.msg}
          </span>
        )}
      </div>
    </div>
  );
}
