import { SensorReadings } from "../lib/types";
import {
  ENCODER_DETAIL_FIELDS,
  TPS_STATUS_FIELDS,
  TPS_EJECT_FIELDS,
  TPS_PRODUCTION_FIELDS,
  PLC_REGISTER_FIELDS,
} from "../lib/sensors";

interface Props {
  readings: SensorReadings | null;
}

export default function PlcDetailPanel({ readings }: Props) {
  if (!readings || readings.connected !== true) {
    return null;
  }

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
