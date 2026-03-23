import { SensorReadings } from "../lib/types";
import {
  ENCODER_DETAIL_FIELDS,
  TPS_STATUS_FIELDS,
  TPS_EJECT_FIELDS,
  TPS_PRODUCTION_FIELDS,
  OPERATING_MODE_FIELDS,
  DROP_PIPELINE_FIELDS,
  DETECTION_FIELDS,
  PLC_REGISTER_FIELDS,
} from "../lib/sensors";

interface Props {
  readings: SensorReadings | null;
}

export default function PlcDetailPanel({ readings }: Props) {
  if (!readings || readings.connected !== true) {
    return null;
  }

  const targetSpacing = 19.5; // 19.5 inches — tie plate spacing
  const detectorOffset = 607.5; // inches — distance from front camera to plate dropper
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

      {/* Section 2: Plate Drops — single consolidated view */}
      {(() => {
        const rate = (readings["plates_per_minute"] ?? 0) as number;
        const count = (readings["plate_drop_count"] ?? 0) as number;
        const lastSpacing = readings["last_drop_spacing_in"] as number | undefined;
        const avgSpacing = readings["avg_drop_spacing_in"] as number | undefined;
        const minSpacing = readings["min_drop_spacing_in"] as number | undefined;
        const maxSpacing = readings["max_drop_spacing_in"] as number | undefined;
        const distSinceLast = (readings["distance_since_last_drop_in"] ?? 0) as number;
        const target = targetSpacing && targetSpacing > 0 ? targetSpacing : 0;

        // Determine overall status
        type DropStatus = "good" | "drift" | "bad" | "idle";
        let status: DropStatus = "idle";
        let statusLabel = "No Drops Yet";

        if (dropCount > 0 && target > 0) {
          const lastDev = lastSpacing ? Math.abs(lastSpacing - target) / target : 0;
          const pctOfTarget = target > 0 ? distSinceLast / target : 0;

          if (lastDev > 0.2 || pctOfTarget > 1.2) {
            status = "bad";
            statusLabel = pctOfTarget > 1.2 ? "Drop Overdue" : "Off Target";
          } else if (lastDev > 0.1 || pctOfTarget > 1.05) {
            status = "drift";
            statusLabel = pctOfTarget > 1.05 ? "Drop Late" : "Drifting";
          } else {
            status = "good";
            statusLabel = "On Target";
          }
        } else if (rate > 0) {
          status = "good";
          statusLabel = "Dropping";
        }

        const statusConfig = {
          good:  { border: "border-green-900/50", bg: "bg-green-950/10", badge: "bg-green-500", text: "text-green-400", icon: "✓" },
          drift: { border: "border-yellow-900/50", bg: "bg-yellow-950/10", badge: "bg-yellow-500", text: "text-yellow-400", icon: "⚠" },
          bad:   { border: "border-red-900/50", bg: "bg-red-950/10", badge: "bg-red-500", text: "text-red-400", icon: "✕" },
          idle:  { border: "border-gray-800", bg: "", badge: "bg-gray-600", text: "text-gray-500", icon: "—" },
        }[status];

        const pct = target > 0 ? Math.min((distSinceLast / target) * 100, 150) : 0;
        const barColor = status === "bad" ? "bg-red-500" : status === "drift" ? "bg-yellow-500" : "bg-green-500";

        return (
          <div className={`border ${statusConfig.border} ${statusConfig.bg} rounded-2xl p-4 sm:p-6`}>
            {/* Header with status badge */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500">
                Plate Drops
              </h3>
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${statusConfig.badge}/20`}>
                <span className={`text-sm font-bold ${statusConfig.text}`}>{statusConfig.icon}</span>
                <span className={`text-xs font-bold uppercase tracking-wide ${statusConfig.text}`}>
                  {statusLabel}
                </span>
              </div>
            </div>

            {/* 3 big numbers */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="flex flex-col items-center">
                <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide">Rate</span>
                <span className="font-mono font-bold text-xl sm:text-2xl text-blue-400">
                  {rate.toFixed(1)}
                  <span className="text-gray-600 font-normal text-xs sm:text-sm ml-0.5">/min</span>
                </span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide">Last Spacing</span>
                <span className={`font-mono font-bold text-xl sm:text-2xl ${
                  lastSpacing && target > 0
                    ? Math.abs(lastSpacing - target) / target <= 0.1
                      ? "text-green-400"
                      : Math.abs(lastSpacing - target) / target <= 0.2
                      ? "text-yellow-400"
                      : "text-red-400"
                    : "text-gray-400"
                }`}>
                  {lastSpacing !== undefined ? lastSpacing.toFixed(1) : "—"}
                  <span className="text-gray-600 font-normal text-xs sm:text-sm ml-0.5">in</span>
                </span>
                {target > 0 && (
                  <span className="text-[10px] text-gray-600">
                    target {target}
                  </span>
                )}
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide">Total</span>
                <span className="font-mono font-bold text-xl sm:text-2xl text-gray-200">
                  {count}
                </span>
              </div>
            </div>

            {/* Distance vs Plates — the core accuracy metric */}
            {(() => {
              const distFt = (readings["encoder_distance_ft"] ?? 0) as number;
              const distIn = distFt * 12;
              const expectedPlates = target > 0 ? Math.floor(distIn / target) : 0;
              const actualPerPlate = count > 0 ? distIn / count : 0;
              const missed = expectedPlates - count;
              const efficiency = expectedPlates > 0 ? (count / expectedPlates) * 100 : 0;

              if (distFt < 1 || count === 0) return null;

              const effColor = efficiency >= 97 ? "text-green-400"
                : efficiency >= 90 ? "text-yellow-400" : "text-red-400";
              const perPlateColor = target > 0 && actualPerPlate > 0
                ? Math.abs(actualPerPlate - target) / target <= 0.05 ? "text-green-400"
                  : Math.abs(actualPerPlate - target) / target <= 0.15 ? "text-yellow-400"
                  : "text-red-400"
                : "text-gray-400";

              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 py-2 border-t border-b border-gray-800/50">
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] text-gray-600 uppercase">Avg Spacing</span>
                    <span className={`font-mono font-bold text-sm ${perPlateColor}`}>
                      {actualPerPlate.toFixed(1)}<span className="text-gray-600 font-normal text-[10px] ml-0.5">in</span>
                    </span>
                    <span className="text-[10px] text-gray-600">target {target}"</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] text-gray-600 uppercase">Expected</span>
                    <span className="font-mono font-bold text-sm text-gray-400">
                      {expectedPlates}
                    </span>
                    <span className="text-[10px] text-gray-600">for {distFt.toFixed(0)} ft</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] text-gray-600 uppercase">Missed</span>
                    <span className={`font-mono font-bold text-sm ${missed > 0 ? "text-red-400" : "text-green-400"}`}>
                      {missed > 0 ? missed : 0}
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] text-gray-600 uppercase">Efficiency</span>
                    <span className={`font-mono font-bold text-sm ${effColor}`}>
                      {efficiency.toFixed(0)}<span className="text-gray-600 font-normal text-[10px] ml-0.5">%</span>
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Reference values */}
            <div className="flex items-center justify-center gap-4 mb-3 text-[10px] sm:text-xs text-gray-600">
              <span>Target: <span className="text-gray-400 font-mono">{target}"</span></span>
              <span className="text-gray-700">|</span>
              <span>Detector Offset: <span className="text-gray-400 font-mono">{detectorOffset}" ({(detectorOffset / 12).toFixed(1)} ft)</span></span>
            </div>


            {/* Expandable detail stats */}
            {dropCount > 0 && (
              <details className="mt-2">
                <summary className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide cursor-pointer hover:text-gray-400 select-none">
                  Spacing Details (last {dropCount} drops) ▸
                </summary>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                  {([
                    { label: "Last", val: lastSpacing },
                    { label: "Avg", val: avgSpacing },
                    { label: "Min", val: minSpacing },
                    { label: "Max", val: maxSpacing },
                  ] as const).map(({ label, val }) => {
                    let color = "text-gray-200";
                    if (target > 0 && val !== undefined && val > 0) {
                      const dev = Math.abs(val - target) / target;
                      color = dev <= 0.1 ? "text-green-400" : dev <= 0.2 ? "text-yellow-400" : "text-red-400";
                    }
                    return (
                      <div key={label} className="flex flex-col min-w-0">
                        <span className="text-[10px] text-gray-600 uppercase">{label}</span>
                        <span className={`font-mono font-bold text-sm ${color}`}>
                          {val !== undefined ? val.toFixed(1) : "—"} in
                        </span>
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        );
      })()}

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

      {/* Section 5: Operating Mode */}
      <div className="border border-gray-800 rounded-2xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500">
            Operating Mode
          </h3>
          <span className="font-mono font-bold text-sm text-blue-400">
            {String(readings["operating_mode"] ?? "None")}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
          {OPERATING_MODE_FIELDS.filter((f) => f.type === "bool").map(({ key, label }) => {
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
                    isActive ? "bg-green-500" : "bg-gray-700",
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

      {/* Section 6: Drop Pipeline */}
      <div className="border border-gray-800 rounded-2xl p-4 sm:p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 sm:mb-4">
          Drop Pipeline
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2">
          {DROP_PIPELINE_FIELDS.map(({ key, label }) => {
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

      {/* Section 7: Detection & Control */}
      <div className="border border-gray-800 rounded-2xl p-4 sm:p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 sm:mb-4">
          Detection & Control
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2">
          {DETECTION_FIELDS.map(({ key, label }) => {
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

      {/* Section 8: PLC DS Holding Registers — collapsible raw view */}
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
