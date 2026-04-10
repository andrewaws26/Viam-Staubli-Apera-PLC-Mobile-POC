"use client";

import React, { useState } from "react";
import { SensorSnapshot } from "@/lib/chat";
import { getGaugeStatus, getGaugeColor } from "@ironsight/shared/gauge-thresholds";

interface SnapshotCardProps {
  snapshot: SensorSnapshot;
}

const KEY_FIELDS: { key: keyof SensorSnapshot; label: string; unit: string; gaugeKey?: string }[] = [
  { key: "engine_rpm", label: "RPM", unit: "", gaugeKey: "engine_rpm" },
  { key: "coolant_temp_f", label: "Coolant", unit: "°F", gaugeKey: "coolant_temp_f" },
  { key: "oil_pressure_psi", label: "Oil Press", unit: "PSI", gaugeKey: "oil_pressure_psi" },
  { key: "battery_voltage", label: "Battery", unit: "V", gaugeKey: "battery_voltage" },
  { key: "vehicle_speed_mph", label: "Speed", unit: "mph", gaugeKey: "vehicle_speed_mph" },
  { key: "transmission_gear", label: "Gear", unit: "" },
  { key: "plate_count", label: "Plates", unit: "" },
  { key: "avg_plates_per_min", label: "Plates/min", unit: "" },
  { key: "operating_mode", label: "Mode", unit: "" },
];

export default function SnapshotCard({ snapshot }: SnapshotCardProps) {
  const [expanded, setExpanded] = useState(false);

  const entries = KEY_FIELDS.filter((f) => snapshot[f.key] != null);
  const preview = entries.slice(0, 4);
  const rest = entries.slice(4);

  const renderValue = (field: typeof KEY_FIELDS[number]) => {
    const val = snapshot[field.key];
    if (val == null) return null;

    let color = "#9ca3af"; // gray-400 default
    if (field.gaugeKey && typeof val === "number") {
      try {
        const status = getGaugeStatus(field.gaugeKey, val);
        color = getGaugeColor(status);
      } catch {
        // Key not in thresholds — use default
      }
    }

    return (
      <div key={field.key} className="flex justify-between items-center text-xs px-2 py-0.5">
        <span className="text-gray-400">{field.label}</span>
        <span style={{ color }} className="font-mono font-medium">
          {typeof val === "number" ? val.toLocaleString() : String(val)}
          {field.unit && <span className="text-gray-500 ml-0.5">{field.unit}</span>}
        </span>
      </div>
    );
  };

  // Active DTCs
  const dtcs = snapshot.active_dtcs;

  return (
    <div className="mt-1 rounded-md border border-gray-800/60 bg-gray-800/50 overflow-hidden max-w-xs">
      <div className="px-2 py-1 bg-gray-800/80 border-b border-gray-800/60 flex justify-between items-center">
        <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">
          Sensor Snapshot
        </span>
        <span className="text-xs text-gray-500">
          {new Date(snapshot.captured_at).toLocaleTimeString()}
        </span>
      </div>
      <div className="py-1">
        {preview.map(renderValue)}
        {expanded && rest.map(renderValue)}
        {dtcs && dtcs.length > 0 && (
          <div className="px-2 py-0.5 text-xs">
            <span className="text-red-400 font-medium">DTCs: </span>
            <span className="text-red-300 font-mono">{dtcs.join(", ")}</span>
          </div>
        )}
      </div>
      {rest.length > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-xs text-purple-400 hover:text-purple-300 py-0.5 border-t border-gray-800/60"
        >
          {expanded ? "Show less" : `+${rest.length} more`}
        </button>
      )}
    </div>
  );
}
