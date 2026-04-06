// TPSRemoteControl.tsx — Remote PLC command controls including eject,
// operating mode selection, tie spacing, toggles, and utility commands.
"use client";

import { useState } from "react";
import type { SensorReadings } from "./TPSFields";

interface TPSRemoteControlProps {
  readings: SensorReadings | null;
}

export default function TPSRemoteControl({ readings }: TPSRemoteControlProps) {
  const [cmdResult, setCmdResult] = useState<{ status: string; message: string } | null>(null);
  const [cmdLoading, setCmdLoading] = useState(false);

  const sendCommand = async (command: Record<string, unknown>) => {
    setCmdLoading(true);
    setCmdResult(null);
    try {
      const res = await fetch("/api/plc-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const data = await res.json();
      setCmdResult({
        status: data.status || "error",
        message: data.message || data.error || "Unknown response",
      });
    } catch (err) {
      setCmdResult({
        status: "error",
        message: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setCmdLoading(false);
    }
  };

  return (
    <details className="border border-blue-800/30 rounded-xl">
      <summary className="p-3 cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-blue-500 hover:text-blue-400">
        Remote Control (PLC do_command)
      </summary>
      <div className="px-3 pb-3 space-y-3">
        {/* TPS power status */}
        <div className={`p-2 rounded-lg text-[10px] ${
          readings?.tps_power_loop
            ? "bg-green-950/30 border border-green-800/50 text-green-400"
            : "bg-yellow-950/30 border border-yellow-800/50 text-yellow-400"
        }`}>
          {readings?.tps_power_loop ? "TPS Power ON" : "TPS Power OFF \u2014 eject commands require physical switch"}
        </div>

        {/* Command result */}
        {cmdResult && (
          <div className={`p-2 rounded-lg text-[10px] ${
            cmdResult.status === "ok"
              ? "bg-green-950/30 border border-green-800/50 text-green-300"
              : "bg-red-950/30 border border-red-800/50 text-red-300"
          }`}>
            {cmdResult.status === "ok" ? "\u2713" : "\u2715"} {cmdResult.message}
          </div>
        )}

        {/* Eject */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold mb-1">Eject Plate</p>
          <button
            disabled={cmdLoading}
            onClick={() => sendCommand({ action: "software_eject" })}
            className="bg-red-800 hover:bg-red-700 disabled:bg-gray-800 text-white text-[10px] px-4 py-1.5 rounded-lg font-bold transition-colors"
          >
            {cmdLoading ? "Sending\u2026" : "Eject"}
          </button>
        </div>

        {/* Modes */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold mb-1">Operating Mode</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { mode: "single", label: "TPS-1 Single" },
              { mode: "double", label: "TPS-1 Double" },
              { mode: "both", label: "TPS-2 Both" },
              { mode: "left", label: "Left" },
              { mode: "right", label: "Right" },
              { mode: "tie_team", label: "Tie Team" },
              { mode: "2nd_pass", label: "2nd Pass" },
            ].map(({ mode, label }) => (
              <button
                key={mode}
                disabled={cmdLoading}
                onClick={() => sendCommand({ action: "set_mode", mode })}
                className="bg-cyan-800 hover:bg-cyan-700 disabled:bg-gray-800 text-white text-[10px] px-2 py-1.5 rounded-lg transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Spacing */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold mb-1">
            Tie Spacing (current: {readings?.ds2 ? `${Number(readings.ds2) * 0.5}"` : "\u2014"})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: "18\"", value: 36 },
              { label: "19\"", value: 38 },
              { label: "19.5\"", value: 39 },
              { label: "20\"", value: 40 },
              { label: "21\"", value: 42 },
            ].map(({ label, value }) => (
              <button
                key={value}
                disabled={cmdLoading}
                onClick={() => sendCommand({ action: "set_spacing", value })}
                className={`text-[10px] px-2 py-1 rounded-lg font-bold transition-colors ${
                  readings?.ds2 === value
                    ? "bg-green-700 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Toggles */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold mb-1">Toggles</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {[
              { action: "toggle_drop_enable", label: "Drop Enable", key: "drop_enable", color: "bg-green-800" },
              { action: "toggle_encoder", label: "Encoder", key: "encoder_enabled", color: "bg-blue-800" },
              { action: "toggle_lay_ties", label: "Lay Ties", key: "lay_ties_set", color: "bg-cyan-800" },
              { action: "toggle_drop_ties", label: "Drop Ties", key: "drop_ties", color: "bg-cyan-800" },
            ].map(({ action, label, key, color }) => {
              const isOn = readings?.[key] === true;
              return (
                <button
                  key={action}
                  disabled={cmdLoading}
                  onClick={() => sendCommand({ action })}
                  className={`text-[10px] px-2 py-1.5 rounded-lg font-bold transition-colors ${
                    isOn ? `${color} text-white` : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {label}: {isOn ? "ON" : "OFF"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Utilities */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold mb-1">Utilities</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              disabled={cmdLoading}
              onClick={() => sendCommand({ action: "reset_counters" })}
              className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white text-[10px] px-3 py-1.5 rounded-lg font-bold transition-colors"
            >
              Reset Pi Counters
            </button>
            <button
              disabled={cmdLoading}
              onClick={() => sendCommand({ action: "clear_data_counts" })}
              className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white text-[10px] px-3 py-1.5 rounded-lg font-bold transition-colors"
            >
              Clear PLC Counts
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}
