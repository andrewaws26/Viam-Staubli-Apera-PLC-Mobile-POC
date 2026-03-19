import { SensorReadings } from "../lib/types";
import {
  PLC_DETAIL_FIELDS,
  ECAT_SIGNAL_DEFS,
  ENCODER_DETAIL_FIELDS,
  TPS_STATUS_FIELDS,
  TPS_EJECT_FIELDS,
  TPS_PRODUCTION_FIELDS,
} from "../lib/sensors";

interface Props {
  readings: SensorReadings | null;
}

export default function PlcDetailPanel({ readings }: Props) {
  if (!readings || readings.connected !== true) {
    return null;
  }

  const stateStr = String(readings.system_state ?? "unknown");
  const stateDisplay =
    stateStr === "e-stopped"
      ? "E-STOP ACTIVE"
      : stateStr === "running"
      ? "SERVO ACTIVE"
      : stateStr === "idle"
      ? "idle — awaiting servo power"
      : stateStr.toUpperCase();
  const stateColor =
    stateStr === "e-stopped"
      ? "text-red-500"
      : stateStr === "running"
      ? "text-green-400"
      : stateStr === "fault"
      ? "text-red-400"
      : "text-yellow-400";

  return (
    <div className="space-y-6">
      {/* Section 1: PLC Sensor Data */}
      <div className="border border-gray-800 rounded-2xl p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">
          PLC Sensor Data — Live
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
          {PLC_DETAIL_FIELDS.map(({ key, label, unit }) => {
            const val = readings[key];
            if (val === undefined) return null;
            const isState = key === "system_state";
            const isFault = key === "last_fault" && val !== "none";
            const isButton = key === "button_state";
            return (
              <div key={key} className="flex flex-col">
                <span className="text-xs text-gray-600 uppercase tracking-wide">
                  {label}
                </span>
                <span
                  className={[
                    "text-sm font-mono font-bold",
                    isState
                      ? stateColor
                      : isFault
                      ? "text-red-400"
                      : isButton && val === "pressed"
                      ? "text-green-400"
                      : "text-gray-200",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {isState ? stateDisplay : String(val)}
                  {unit && (
                    <span className="text-gray-600 font-normal ml-0.5">
                      {unit}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 2: Encoder / Track Distance */}
      <div className="border border-gray-800 rounded-2xl p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">
          Encoder — Track Distance
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
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
              <div key={key} className="flex flex-col">
                <span className="text-xs text-gray-600 uppercase tracking-wide">
                  {label}
                </span>
                <span
                  className={[
                    "font-mono font-bold",
                    highlight ? "text-lg text-blue-400" : "text-sm text-gray-200",
                    dirColor,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {String(val)}
                  {unit && (
                    <span className="text-gray-600 font-normal ml-0.5 text-sm">
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
      <div className="border border-gray-800 rounded-2xl p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">
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
      <div className="border border-gray-800 rounded-2xl p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">
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

      {/* Section 5: TPS Production */}
      <div className="border border-gray-800 rounded-2xl p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">
          TPS Production
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
          {TPS_PRODUCTION_FIELDS.map(({ key, label, unit, highlight }) => {
            const val = readings[key];
            if (val === undefined) return null;
            return (
              <div key={key} className="flex flex-col">
                <span className="text-xs text-gray-600 uppercase tracking-wide">
                  {label}
                </span>
                <span
                  className={[
                    "font-mono font-bold",
                    highlight ? "text-lg text-blue-400" : "text-sm text-gray-200",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {String(val)}
                  {unit && (
                    <span className="text-gray-600 font-normal ml-0.5 text-sm">
                      {unit}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 6: E-Cat Signal Status */}
      <div className="border border-gray-800 rounded-2xl p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">
          E-Cat Signal Status
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2">
          {ECAT_SIGNAL_DEFS.map(({ key, label, pin }) => {
            const rawVal = readings[key];
            const isActive = rawVal === 1 || rawVal === true;
            return (
              <div
                key={key}
                className="flex items-center gap-2 py-1"
              >
                {/* Status dot: green when 1, red when 0 */}
                <span
                  className={[
                    "inline-block w-2.5 h-2.5 rounded-full shrink-0",
                    isActive ? "bg-green-500" : "bg-red-500",
                  ].join(" ")}
                />
                <span className="text-xs text-gray-400 truncate">
                  <span className="text-gray-600 font-mono mr-1">{pin}</span>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
