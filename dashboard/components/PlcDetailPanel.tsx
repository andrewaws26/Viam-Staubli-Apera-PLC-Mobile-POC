import { SensorReadings } from "../lib/types";
import { PLC_DETAIL_FIELDS } from "../lib/sensors";

interface Props {
  readings: SensorReadings | null;
}

export default function PlcDetailPanel({ readings }: Props) {
  if (!readings || readings.connected !== true) {
    return null;
  }

  const stateStr = String(readings.system_state ?? "unknown");
  const stateColor =
    stateStr === "running"
      ? "text-green-400"
      : stateStr === "fault"
      ? "text-red-400"
      : stateStr === "e-stopped"
      ? "text-red-500"
      : "text-yellow-400";

  return (
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
                    : "text-gray-200",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {String(val)}
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
  );
}
