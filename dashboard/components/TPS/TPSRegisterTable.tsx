// TPSRegisterTable.tsx — Renders grouped register tables with freshness
// indicators and value formatting for live PLC readings.
"use client";

import { REGISTER_GROUPS, freshnessDot, fmtVal } from "./TPSFields";
import type { SensorReadings } from "./TPSFields";

interface TPSRegisterTableProps {
  readings: SensorReadings;
  lastChangeMap: Record<string, number>;
  pollMs: number;
}

export default function TPSRegisterTable({
  readings,
  lastChangeMap,
  pollMs,
}: TPSRegisterTableProps) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
        Live Readings
        <span className="ml-2 text-gray-700 normal-case tracking-normal font-normal">
          {Object.keys(readings).length} fields, {pollMs / 1000}s refresh
        </span>
      </h3>
      <div className="space-y-4">
        {REGISTER_GROUPS.map((group) => (
          <div key={group.name}>
            <h4 className="text-xs font-bold uppercase tracking-widest text-gray-700 mb-1">
              {group.name}
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <tbody>
                  {group.fields.map(({ key, label }) => {
                    const val = readings[key];
                    const lastTs = lastChangeMap[key];
                    const isHighlight = key === "ds7" || key === "ds10" || key === "ds8";
                    return (
                      <tr
                        key={key}
                        className={`border-t border-gray-900/50 ${isHighlight ? "bg-blue-950/10" : ""}`}
                      >
                        <td className="py-1 pr-2 w-4">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${freshnessDot(lastTs)}`} />
                        </td>
                        <td className="py-1 pr-3 text-gray-500 font-mono whitespace-nowrap">
                          {label}
                          <span className="text-gray-800 ml-1">({key})</span>
                        </td>
                        <td className="py-1 font-mono font-bold text-gray-200 whitespace-nowrap">
                          {fmtVal(val)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
