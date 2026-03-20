import { SensorReadings } from "../lib/types";
import {
  ENCODER_DETAIL_FIELDS,
  TPS_STATUS_FIELDS,
  TPS_EJECT_FIELDS,
  TPS_PRODUCTION_FIELDS,
  DROP_SPACING_FIELDS,
  PLC_REGISTER_FIELDS,
} from "../lib/sensors";

interface Props {
  readings: SensorReadings | null;
}

export default function PlcDetailPanel({ readings }: Props) {
  if (!readings || readings.connected !== true) {
    return null;
  }

  const targetSpacing = readings["ds2"] as number | undefined;
  const dropCount = (readings["drop_count_in_window"] ?? 0) as number;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Section 1: Encoder / Track Distance */}
      <div className="border border-gray-800 rounded-2xl p-4 sm:p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 sm:mb-4">
          Encoder — Track Distance
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 sm:gap-x-6 gap-y-3">
          {ENCODER_DETAIL_FIELDS.map(({ key, label, unit, highlight }) => {
            const val = readings[key];
            if (val === undefined) return null;
            const isDirection = key === "encoder_direction";
            const dirColor =
              isDirection && val === "forward"
                ? "text-green-400"
                : isDirection && val === "reverse"
                ? "text-yellow-400"
                : "";
            return (
              <div key={key} className="flex flex-col min-w-0">
                <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide truncate">
                  {label}
                </span>
                <span
                  className={[
                    "font-mono font-bold truncate",
                    highlight ? "text-base sm:text-lg text-blue-400" : "text-sm text-gray-200",
                    dirColor,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {String(val)}
                  {unit && (
                    <span className="text-gray-600 font-normal ml-0.5 text-xs sm:text-sm">
                      {unit}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 2: TPS Production */}
      <div className="border border-gray-800 rounded-2xl p-4 sm:p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 sm:mb-4">
          TPS Production
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 sm:gap-x-6 gap-y-3">
          {TPS_PRODUCTION_FIELDS.map(({ key, label, unit, highlight }) => {
            const val = readings[key];
            if (val === undefined) return null;
            return (
              <div key={key} className="flex flex-col min-w-0">
                <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide truncate">
                  {label}
                </span>
                <span
                  className={[
                    "font-mono font-bold truncate",
                    highlight ? "text-base sm:text-lg text-blue-400" : "text-sm text-gray-200",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {String(val)}
                  {unit && (
                    <span className="text-gray-600 font-normal ml-0.5 text-xs sm:text-sm">
                      {unit}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 2b: Plate Drop Spacing — sync diagnostics */}
      <div className="border border-amber-900/40 bg-amber-950/10 rounded-2xl p-4 sm:p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-amber-500 mb-3 sm:mb-4">
          Plate Drop Spacing — Sync Monitor
        </h3>

        {/* Key metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 sm:gap-x-6 gap-y-3 mb-4">
          {DROP_SPACING_FIELDS.map(({ key, label, unit, highlight }) => {
            const val = readings[key];
            if (val === undefined) return null;
            const numVal = typeof val === "number" ? val : 0;
            // Warn if spacing deviates more than 10% from target (DS2)
            const isOff =
              targetSpacing && targetSpacing > 0 && numVal > 0 &&
              key.includes("spacing") &&
              Math.abs(numVal - targetSpacing) / targetSpacing > 0.1;
            return (
              <div key={key} className="flex flex-col min-w-0">
                <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide truncate">
                  {label}
                </span>
                <span
                  className={[
                    "font-mono font-bold truncate",
                    isOff
                      ? "text-base sm:text-lg text-red-400"
                      : highlight
                      ? "text-base sm:text-lg text-amber-400"
                      : "text-sm text-gray-200",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {String(val)}
                  {unit && (
                    <span className="text-gray-600 font-normal ml-0.5 text-xs sm:text-sm">
                      {unit}
                    </span>
                  )}
                  {isOff && (
                    <span className="text-red-500 font-normal ml-1 text-xs">
                      ⚠ OFF TARGET
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* Live progress toward next drop */}
        {targetSpacing !== undefined && targetSpacing > 0 && (() => {
          const distSinceLast = (readings["distance_since_last_drop_ft"] ?? 0) as number;
          const pct = Math.min((distSinceLast / targetSpacing) * 100, 150);
          const isOverdue = pct > 105;
          const isLate = pct > 120;
          const barColor = isLate
            ? "bg-red-500"
            : isOverdue
            ? "bg-yellow-500"
            : "bg-blue-500";
          return (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide">
                  Next Drop Progress
                </span>
                <span className={[
                  "text-xs font-mono font-bold",
                  isLate ? "text-red-400" : isOverdue ? "text-yellow-400" : "text-blue-400",
                ].join(" ")}>
                  {distSinceLast.toFixed(1)} / {targetSpacing} ft
                  {isLate && " — OVERDUE"}
                  {isOverdue && !isLate && " — LATE"}
                </span>
              </div>
              <div className="w-full h-3 sm:h-4 bg-gray-800 rounded-full overflow-hidden relative">
                {/* Target marker */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10"
                  style={{ left: `${Math.min(100 / (pct > 100 ? pct / 100 : 1), 100)}%` }}
                  title={`Target: ${targetSpacing} ft`}
                />
                {/* Progress fill */}
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
                {/* Overflow indicator if past 100% */}
                {pct > 100 && (
                  <div
                    className="absolute top-0 bottom-0 right-0 bg-red-500/30 animate-pulse"
                    style={{ width: `${Math.min(pct - 100, 50)}%` }}
                  />
                )}
              </div>
            </div>
          );
        })()}

        {/* Spacing summary stats */}
        {dropCount > 0 ? (
          <div className="mt-3">
            <p className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide mb-2">
              Drop Spacing Summary — last {dropCount} drops
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Last", key: "last_drop_spacing_ft" },
                { label: "Avg", key: "avg_drop_spacing_ft" },
                { label: "Min", key: "min_drop_spacing_ft" },
                { label: "Max", key: "max_drop_spacing_ft" },
              ].map(({ label, key }) => {
                const val = readings[key] as number | undefined;
                let color = "text-gray-200";
                if (targetSpacing && targetSpacing > 0 && val !== undefined && val > 0) {
                  const deviation = Math.abs(val - targetSpacing) / targetSpacing;
                  if (deviation <= 0.1) color = "text-green-400";
                  else if (deviation <= 0.2) color = "text-yellow-400";
                  else color = "text-red-400";
                }
                return (
                  <div key={key} className="flex flex-col min-w-0">
                    <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide">{label}</span>
                    <span className={`font-mono font-bold text-sm ${color}`}>
                      {val !== undefined ? val.toFixed(1) : "—"} ft
                    </span>
                  </div>
                );
              })}
            </div>
            {targetSpacing !== undefined && targetSpacing > 0 && (
              <p className="text-[10px] text-gray-600 mt-2">
                Target: <span className="text-amber-500 font-mono">{targetSpacing}</span> (DS2)
                {" · "}
                <span className="text-green-400">■</span> ±10%
                {" "}
                <span className="text-yellow-400">■</span> ±20%
                {" "}
                <span className="text-red-400">■</span> &gt;20% off
              </p>
            )}
          </div>
        ) : (
          <p className="text-gray-700 text-sm">No plate drops recorded yet this session.</p>
        )}
      </div>

      {/* Section 3: TPS Machine Status */}
      <div className="border border-gray-800 rounded-2xl p-4 sm:p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 sm:mb-4">
          TPS Machine Status
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2">
          {TPS_STATUS_FIELDS.map(({ key, label }) => {
            const rawVal = readings[key];
            const isActive = rawVal === 1 || rawVal === true;
            return (
              <div
                key={key}
                className="flex items-center gap-2 py-1"
              >
                <span
                  className={[
                    "inline-block w-2.5 h-2.5 rounded-full shrink-0",
                    isActive ? "bg-green-500" : "bg-red-500",
                  ].join(" ")}
                />
                <span className="text-xs text-gray-400 truncate">
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 4: TPS Eject System */}
      <div className="border border-gray-800 rounded-2xl p-4 sm:p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 sm:mb-4">
          TPS Eject System
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2">
          {TPS_EJECT_FIELDS.map(({ key, label }) => {
            const rawVal = readings[key];
            const isActive = rawVal === 1 || rawVal === true;
            return (
              <div
                key={key}
                className="flex items-center gap-2 py-1"
              >
                <span
                  className={[
                    "inline-block w-2.5 h-2.5 rounded-full shrink-0",
                    isActive ? "bg-green-500" : "bg-red-500",
                  ].join(" ")}
                />
                <span className="text-xs text-gray-400 truncate">
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 5: PLC DS Holding Registers — collapsible raw view */}
      <details className="border border-gray-800/50 rounded-2xl">
        <summary className="p-3 sm:p-4 cursor-pointer text-xs font-bold uppercase tracking-widest text-gray-600 hover:text-gray-400 select-none">
          PLC Raw Registers (DS1–DS25) ▸
        </summary>
        <div className="px-4 sm:px-6 pb-4 sm:pb-6">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-4 sm:gap-x-6 gap-y-2">
            {PLC_REGISTER_FIELDS.map(({ key, label }) => {
              const val = readings[key];
              if (val === undefined) return null;
              const isNonZero = val !== 0;
              return (
                <div key={key} className="flex flex-col min-w-0">
                  <span className="text-[10px] sm:text-xs text-gray-700 uppercase tracking-wide">
                    {label}
                  </span>
                  <span
                    className={[
                      "font-mono text-xs sm:text-sm",
                      isNonZero ? "text-gray-400" : "text-gray-800",
                    ].join(" ")}
                  >
                    {String(val)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </details>
    </div>
  );
}
