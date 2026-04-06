"use client";

import React, { useState } from "react";
import { lookupSPN, lookupFMI } from "../lib/spn-lookup";
import { lookupPCode } from "../lib/pcode-lookup";
import { ECU_SOURCES, type DTCHistoryEvent } from "../lib/dtc-history";
import DTCTimeline from "./DTCTimeline";
import { formatValue } from "./GaugeGrid";

interface TruckReadings {
  [key: string]: unknown;
}

const LAMP_NAMES: Record<string, string> = {
  malfunction_lamp: "MIL",
  red_stop_lamp: "STOP",
  amber_warning_lamp: "WARN",
  protect_lamp: "PROT",
};

type VehicleMode = "truck" | "car";

interface DTCPanelProps {
  readings: TruckReadings | null;
  vehicleMode: VehicleMode;
  busConnected: boolean;
  dtcCount: number;
  simMode: boolean;
  setReadings: React.Dispatch<React.SetStateAction<TruckReadings | null>>;
  onDiagnoseCode?: (spn: number, fmi: number, ecuLabel: string) => void;
  dtcHistory?: DTCHistoryEvent[];
  onClearDTCHistory?: () => void;
}

export default function DTCPanel({
  readings,
  vehicleMode,
  busConnected,
  dtcCount,
  simMode,
  setReadings,
  onDiagnoseCode,
  dtcHistory = [],
  onClearDTCHistory,
}: DTCPanelProps) {
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  // Advanced diagnostics state (car mode, self-contained)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [freezeFrame, setFreezeFrame] = useState<Record<string, any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [readiness, setReadiness] = useState<Record<string, any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pendingDTCs, setPendingDTCs] = useState<any[] | null>(null);
  const [vin, setVin] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState<string | null>(null);

  const handleClearDTCs = async () => {
    setClearing(true);
    setClearResult(null);
    try {
      let data: Record<string, unknown>;
      if (simMode) {
        // In sim mode, just clear the local readings
        await new Promise(r => setTimeout(r, 500));
        data = { success: true };
        setReadings(prev => {
          if (!prev) return prev;
          const cleaned = { ...prev };
          Object.keys(cleaned).forEach(k => {
            if (k.startsWith("dtc_") || k === "active_dtc_count" || k.endsWith("_lamp")) delete cleaned[k];
          });
          cleaned.active_dtc_count = 0;
          return cleaned;
        });
      } else {
        const resp = await fetch("/api/truck-command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "clear_dtcs" }),
        });
        data = await resp.json();
      }
      if (data.success) {
        setClearResult("DTCs cleared successfully");
      } else {
        setClearResult(`Failed: ${data.error || data.message || "Unknown error"}`);
      }
    } catch (err) {
      setClearResult(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setClearing(false);
      setTimeout(() => setClearResult(null), 5000);
    }
  };

  const runDiagCommand = async (cmd: string) => {
    setDiagLoading(cmd);
    try {
      if (simMode) {
        await new Promise(r => setTimeout(r, 800));
        if (cmd === "get_freeze_frame") setFreezeFrame({ dtc_that_triggered: "P0420", engine_rpm: 2100, vehicle_speed_mph: 45, coolant_temp_f: 198, engine_load_pct: 67, throttle_pct: 35, timing_advance_deg: 14.5, intake_air_temp_f: 100, short_fuel_trim_pct: 2.3, long_fuel_trim_pct: -1.5 });
        if (cmd === "get_readiness") setReadiness({ ready_for_inspection: false, complete: ["Misfire", "Fuel System", "Components", "Catalyst"], incomplete: ["EVAP System", "O2 Sensor"], total_supported: 8, total_complete: 6, total_incomplete: 2 });
        if (cmd === "get_pending_dtcs") setPendingDTCs([{ code: "P0442", status: "pending" }]);
        if (cmd === "get_vin") setVin("1N4AL3AP8DC123456");
      } else {
        const resp = await fetch("/api/truck-command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: cmd }),
        });
        const result = await resp.json();
        if (cmd === "get_freeze_frame") setFreezeFrame(result.freeze_frame || {});
        if (cmd === "get_readiness") setReadiness(result.readiness || {});
        if (cmd === "get_pending_dtcs") setPendingDTCs(result.pending_dtcs || []);
        if (cmd === "get_vin") setVin(result.vin || "Not available");
      }
    } catch (err) {
      console.error(`Diag command ${cmd} failed:`, err);
    } finally {
      setDiagLoading(null);
    }
  };

  return (
    <>
      {/* DTC Alert Bar */}
      {dtcCount > 0 && (
        <div className="bg-red-950/50 border border-red-700/50 rounded-lg px-3 py-2 mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-xs sm:text-sm font-bold text-red-300">
              {dtcCount} Active DTC{dtcCount > 1 ? "s" : ""}
            </span>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(LAMP_NAMES).map(([key, name]) => {
                const val = readings?.[key] as number;
                if (!val || val === 0) return null;
                // Find which ECUs have this lamp lit
                const ecuSources: string[] = [];
                for (const { suffix, label } of ECU_SOURCES) {
                  const perEcuKey = key === "malfunction_lamp" ? `mil_${suffix}`
                    : key === "amber_warning_lamp" ? `amber_lamp_${suffix}`
                    : `${key}_${suffix}`;
                  const ecuVal = readings?.[perEcuKey] as number;
                  if (ecuVal && ecuVal > 0) ecuSources.push(label);
                }
                return (
                  <span
                    key={key}
                    className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      key === "red_stop_lamp"
                        ? "bg-red-700 text-white"
                        : key === "amber_warning_lamp"
                        ? "bg-yellow-700 text-white"
                        : "bg-orange-700 text-white"
                    }`}
                    title={ecuSources.length > 0 ? `Source: ${ecuSources.join(", ")}` : undefined}
                  >
                    {name}{ecuSources.length > 0 ? ` (${ecuSources.join(", ")})` : ""}
                  </span>
                );
              })}
            </div>
          </div>
          <button
            onClick={handleClearDTCs}
            disabled={clearing}
            className={`min-h-[56px] px-6 py-3 rounded-xl text-sm sm:text-lg font-black uppercase tracking-wider transition-colors ${
              clearing
                ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                : "bg-red-700 hover:bg-red-600 text-white shadow-lg shadow-red-900/50"
            }`}
          >
            {clearing ? "CLEARING..." : "CLEAR DTCs"}
          </button>
        </div>
      )}

      {/* Clear result toast */}
      {clearResult && (
        <div
          className={`rounded-lg px-3 py-1.5 mb-3 text-xs ${
            clearResult.includes("success")
              ? "bg-green-900/30 border border-green-700/50 text-green-300"
              : "bg-red-900/30 border border-red-700/50 text-red-300"
          }`}
        >
          {clearResult}
        </div>
      )}

      {/* DTC Details — J1939 format (truck), per-ECU */}
      {dtcCount > 0 && vehicleMode === "truck" && (
        <div className="bg-gray-900/50 rounded-2xl border border-red-800/30 p-4 sm:p-5 mb-3">
          <h4 className="text-sm sm:text-base font-black text-red-300 uppercase tracking-wider mb-3">
            Diagnostic Trouble Codes
          </h4>
          <div className="space-y-3">
            {ECU_SOURCES.map(({ suffix, label }) => {
              const ecuCount = readings?.[`dtc_${suffix}_count`] as number ?? 0;
              if (ecuCount === 0) return null;
              return Array.from({ length: Math.min(ecuCount, 5) }).map((_, i) => {
                const spn = readings?.[`dtc_${suffix}_${i}_spn`] as number;
                const fmi = readings?.[`dtc_${suffix}_${i}_fmi`] as number;
                const occ = readings?.[`dtc_${suffix}_${i}_occurrence`] as number;
                if (spn === undefined) return null;
                const spnInfo = lookupSPN(spn);
                const fmiText = lookupFMI(fmi);
                return (
                  <div
                    key={`${suffix}-${i}`}
                    className="bg-red-950/40 border border-red-800/30 rounded-xl p-3 sm:p-4"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm sm:text-base font-bold text-red-300">
                        {spnInfo.name}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-gray-700 text-gray-200">
                          {label}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          spnInfo.severity === "critical" ? "bg-red-700 text-white" :
                          spnInfo.severity === "warning" ? "bg-yellow-700 text-white" :
                          "bg-blue-700 text-white"
                        }`}>
                          {spnInfo.severity.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 mb-1">
                      SPN {spn} / FMI {fmi} — {fmiText}
                    </div>
                    <div className="text-xs text-gray-500 mb-2">
                      {spnInfo.description} (x{occ} occurrences)
                    </div>
                    <div className="text-xs sm:text-sm text-green-400 bg-green-950/30 rounded-lg px-3 py-2 border border-green-800/30">
                      <span className="font-bold">Fix: </span>{spnInfo.fix}
                    </div>
                    {onDiagnoseCode && (
                      <button
                        onClick={() => onDiagnoseCode(spn, fmi, label)}
                        className="mt-2 w-full min-h-[44px] px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider bg-purple-900/50 hover:bg-purple-800 text-purple-300 border border-purple-700/50 transition-colors"
                      >
                        Diagnose This Code with AI
                      </button>
                    )}
                  </div>
                );
              });
            })}
          </div>
        </div>
      )}

      {/* DTC Details — OBD-II P-codes (car) */}
      {dtcCount > 0 && vehicleMode === "car" && (
        <div className="bg-gray-900/50 rounded-2xl border border-red-800/30 p-4 sm:p-5 mb-3">
          <h4 className="text-sm sm:text-base font-black text-red-300 uppercase tracking-wider mb-3">
            OBD-II Trouble Codes
          </h4>
          <div className="space-y-3">
            {Array.from({ length: Math.min(dtcCount, 5) }).map((_, i) => {
              const code = readings?.[`obd2_dtc_${i}`] as string;
              if (!code) return null;
              const info = lookupPCode(code);
              return (
                <div
                  key={i}
                  className="bg-red-950/40 border border-red-800/30 rounded-xl p-3 sm:p-4"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm sm:text-base font-bold text-red-300">
                      {info.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-red-200 bg-red-900/50 px-2 py-0.5 rounded">
                        {code}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        info.severity === "critical" ? "bg-red-700 text-white" :
                        info.severity === "warning" ? "bg-yellow-700 text-white" :
                        "bg-blue-700 text-white"
                      }`}>
                        {info.severity.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mb-2">
                    {info.description}
                  </div>
                  <div className="text-xs sm:text-sm text-green-400 bg-green-950/30 rounded-lg px-3 py-2 border border-green-800/30">
                    <span className="font-bold">Fix: </span>{info.fix}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No DTC — show clear button anyway for manual clearing */}
      {dtcCount === 0 && busConnected && (
        <div className="flex items-center justify-between bg-green-950/20 border border-green-800/30 rounded-lg px-3 py-2 mb-3">
          <span className="text-xs text-green-400">No active trouble codes</span>
          <button
            onClick={handleClearDTCs}
            disabled={clearing}
            className="text-xs px-4 py-2 rounded-lg border border-gray-700 text-gray-500 hover:text-gray-300 transition-colors min-h-[44px]"
          >
            {clearing ? "Clearing..." : "Clear DTCs"}
          </button>
        </div>
      )}

      {/* On-Demand Diagnostic Tools — Car mode only */}
      {vehicleMode === "car" && busConnected && (
        <div className="bg-gray-900/50 rounded-2xl border border-blue-800/30 p-4 sm:p-5 mt-3">
          <h4 className="text-sm sm:text-base font-black text-blue-300 uppercase tracking-wider mb-3">
            On-Demand Diagnostics
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {[
              { cmd: "get_freeze_frame", label: "Freeze Frame", icon: "\u{1F4F7}" },
              { cmd: "get_readiness", label: "Readiness", icon: "\u2705" },
              { cmd: "get_pending_dtcs", label: "Pending DTCs", icon: "\u26A0\uFE0F" },
              { cmd: "get_vin", label: "Pull VIN", icon: "\u{1F50D}" },
            ].map(({ cmd, label, icon }) => (
              <button
                key={cmd}
                onClick={() => runDiagCommand(cmd)}
                disabled={diagLoading !== null}
                className={`px-3 py-2 min-h-[44px] rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${
                  diagLoading === cmd
                    ? "bg-blue-800 text-blue-200 animate-pulse"
                    : "bg-blue-900/50 hover:bg-blue-800 text-blue-300 border border-blue-700/50"
                }`}
              >
                {icon} {diagLoading === cmd ? "Querying..." : label}
              </button>
            ))}
          </div>

          {/* VIN Result */}
          {vin && (
            <div className="bg-gray-800/50 rounded-lg px-3 py-2 mb-2">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">Vehicle ID</span>
              <p className="text-sm font-mono font-bold text-gray-100">{vin}</p>
            </div>
          )}

          {/* Readiness Monitors Result */}
          {readiness && (
            <div className="bg-gray-800/50 rounded-lg px-3 py-3 mb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-400 uppercase">Emission Readiness Monitors</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  readiness.ready_for_inspection
                    ? "bg-green-700 text-white"
                    : "bg-yellow-700 text-white"
                }`}>
                  {readiness.ready_for_inspection ? "READY FOR INSPECTION" : "NOT READY"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(readiness.complete || []).map((m: string) => (
                  <div key={m} className="flex items-center gap-1.5 text-xs">
                    <span className="text-green-400">{"\u2705"}</span>
                    <span className="text-gray-300">{m}</span>
                  </div>
                ))}
                {(readiness.incomplete || []).map((m: string) => (
                  <div key={m} className="flex items-center gap-1.5 text-xs">
                    <span className="text-yellow-400">{"\u23F3"}</span>
                    <span className="text-yellow-300">{m}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-600 mt-2">
                {readiness.total_complete}/{readiness.total_supported} monitors complete
              </p>
            </div>
          )}

          {/* Freeze Frame Result */}
          {freezeFrame && Object.keys(freezeFrame).length > 0 && (
            <div className="bg-gray-800/50 rounded-lg px-3 py-3 mb-2">
              <span className="text-xs font-bold text-gray-400 uppercase">
                Freeze Frame — Snapshot when {freezeFrame.dtc_that_triggered || "DTC"} was set
              </span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                {Object.entries(freezeFrame).map(([key, val]) => {
                  if (key === "dtc_that_triggered") return null;
                  return (
                    <div key={key} className="flex justify-between text-xs py-0.5">
                      <span className="text-gray-500">{key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                      <span className="font-mono font-bold text-gray-200">{formatValue(key, val as number)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pending DTCs Result */}
          {pendingDTCs && (
            <div className="bg-gray-800/50 rounded-lg px-3 py-2 mb-2">
              <span className="text-xs font-bold text-gray-400 uppercase">Pending Trouble Codes</span>
              {pendingDTCs.length === 0 ? (
                <p className="text-xs text-green-400 mt-1">No pending codes — all clear</p>
              ) : (
                <div className="mt-1 space-y-1">
                  {pendingDTCs.map((dtc: { code: string }, i: number) => {
                    const info = lookupPCode(dtc.code);
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-yellow-300">{dtc.code}</span>
                        <span className="text-gray-400">{info.name}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* DTC History Timeline — always visible when history exists */}
      {dtcHistory.length > 0 && onClearDTCHistory && (
        <DTCTimeline events={dtcHistory} onClear={onClearDTCHistory} />
      )}
    </>
  );
}
