// TPSSimulator.tsx — Simulator controls for overriding live PLC readings
// with test data. Includes scenario presets and manual value controls.
"use client";

import { SIM_SCENARIOS } from "./TPSFields";

interface TPSSimulatorProps {
  simEnabled: boolean;
  simOverrides: Record<string, unknown>;
  onToggle: () => void;
  onApplyOverrides: (overrides: Record<string, unknown>) => void;
}

export default function TPSSimulator({
  simEnabled,
  simOverrides,
  onToggle,
  onApplyOverrides,
}: TPSSimulatorProps) {
  return (
    <details className="border border-purple-800/30 rounded-xl">
      <summary className="p-3 cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-purple-500 hover:text-purple-400">
        Simulator
        {simEnabled && <span className="ml-2 text-green-400 normal-case">(ACTIVE)</span>}
      </summary>
      <div className="px-3 pb-3 space-y-3">
        <p className="text-[10px] text-gray-600">Override live PLC readings with simulated values for testing.</p>
        <div className="flex items-center gap-3">
          <button
            onClick={onToggle}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
              simEnabled ? "bg-red-700 hover:bg-red-600 text-white" : "bg-purple-700 hover:bg-purple-600 text-white"
            }`}
          >
            {simEnabled ? "Stop" : "Start"} Simulator
          </button>
          {simEnabled && (
            <span className="text-[10px] text-green-400 font-mono">
              {(simOverrides.encoder_distance_ft as number || 0).toFixed(1)} ft | {simOverrides.plate_drop_count as number || 0} plates
            </span>
          )}
        </div>
        {simEnabled && (
          <>
            <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold">Scenarios</p>
            <div className="flex flex-wrap gap-1.5">
              {SIM_SCENARIOS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => onApplyOverrides(s.overrides)}
                  className={`${s.color} hover:brightness-110 text-white text-[10px] px-2 py-1.5 rounded-lg transition-all`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
              {[
                { key: "encoder_speed_ftpm", label: "Speed", type: "number" as const },
                { key: "camera_detections_per_min", label: "Camera Rate", type: "number" as const },
                { key: "eject_rate_per_min", label: "Eject Rate", type: "number" as const },
                { key: "modbus_response_time_ms", label: "Modbus (ms)", type: "number" as const },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="text-[10px] text-gray-600 block mb-0.5">{label}</label>
                  <input
                    type={type}
                    value={String(simOverrides[key] ?? "")}
                    onChange={(e) =>
                      onApplyOverrides({ [key]: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-300 font-mono"
                  />
                </div>
              ))}
              {[
                { key: "tps_power_loop", label: "TPS Power" },
                { key: "backup_alarm", label: "Backup" },
                { key: "drop_enable", label: "Drop" },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={!!simOverrides[key]}
                    onChange={(e) => onApplyOverrides({ [key]: e.target.checked })}
                    className="rounded"
                  />
                  <label className="text-[10px] text-gray-400">{label}</label>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
