import { FaultEvent } from "../lib/types";

interface Props {
  events: FaultEvent[];
}

export default function FaultHistory({ events }: Props) {
  return (
    <div className="border border-gray-800 rounded-2xl p-4 sm:p-6">
      <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">
        Fault History — this session
      </h3>

      {events.length === 0 ? (
        <p className="text-gray-700 text-sm">No faults recorded.</p>
      ) : (
        <div className="space-y-0">
          {events.map((evt, idx) => {
            const isRecovery = evt.message.includes("Restored") || evt.message.includes("Released");
            return (
              <div
                key={evt.id}
                className={[
                  "flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 py-2.5 text-sm",
                  idx < events.length - 1 ? "border-b border-gray-800" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {/* Timestamp + Component on same row on mobile */}
                <div className="flex items-baseline gap-2 sm:contents">
                  <span
                    className={[
                      "font-mono text-xs shrink-0 tabular-nums",
                      isRecovery ? "text-green-500" : "text-red-500",
                    ].join(" ")}
                  >
                    {evt.timestamp.toLocaleTimeString()}
                  </span>

                  <span className="font-bold text-gray-300 shrink-0 text-xs sm:text-sm sm:w-36">
                    {evt.componentLabel}
                  </span>
                </div>

                {/* Message */}
                <span
                  className={[
                    "truncate text-xs sm:text-sm",
                    isRecovery ? "text-green-600" : "text-gray-500",
                  ].join(" ")}
                >
                  {evt.message}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
