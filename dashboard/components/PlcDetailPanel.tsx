import { SensorReadings } from "../lib/types";
import { decodePlcReadings } from "../lib/sensors";

interface Props {
  readings: SensorReadings | null;
}

export default function PlcDetailPanel({ readings }: Props) {
  if (!readings || readings.connected !== true) {
    return null;
  }

  const rows = decodePlcReadings(readings);

  if (rows.length === 0) return null;

  // Color the System State value
  const stateColor = (value: string) => {
    switch (value) {
      case "running":
        return "text-green-400";
      case "fault":
      case "e-stopped":
        return "text-red-400";
      case "idle":
      case "paused":
        return "text-yellow-400";
      default:
        return "text-gray-200";
    }
  };

  return (
    <div className="border border-gray-800 rounded-2xl p-6">
      <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">
        PLC Sensor Data — Live
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
        {rows.map(({ label, value, unit }) => {
          const isState = label === "System State";
          const isFaultCoil = label === "Fault Coil" && value === "ACTIVE";
          return (
            <div key={label} className="flex flex-col">
              <span className="text-xs text-gray-600 uppercase tracking-wide">
                {label}
              </span>
              <span
                className={[
                  "text-sm font-mono font-bold",
                  isState
                    ? stateColor(value)
                    : isFaultCoil
                    ? "text-red-400"
                    : "text-gray-200",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {value}
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
