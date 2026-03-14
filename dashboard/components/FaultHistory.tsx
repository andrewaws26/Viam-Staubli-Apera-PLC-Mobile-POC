import { FaultEvent } from "../lib/types";

interface Props {
  events: FaultEvent[];
}

export default function FaultHistory({ events }: Props) {
  return (
    <div className="border border-gray-800 rounded-2xl p-6">
      <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4">
        Fault History — this session
      </h3>

      {events.length === 0 ? (
        <p className="text-gray-700 text-sm">No faults recorded.</p>
      ) : (
        <div className="space-y-0">
          {events.map((evt, idx) => (
            <div
              key={evt.id}
              className={[
                "flex items-baseline gap-4 py-2.5 text-sm",
                idx < events.length - 1 ? "border-b border-gray-800" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {/* Timestamp */}
              <span className="font-mono text-xs text-red-500 shrink-0 tabular-nums">
                {evt.timestamp.toLocaleTimeString()}
              </span>

              {/* Component */}
              <span className="font-bold text-gray-300 shrink-0 w-36">
                {evt.componentLabel}
              </span>

              {/* Message */}
              <span className="text-gray-500 truncate">{evt.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
