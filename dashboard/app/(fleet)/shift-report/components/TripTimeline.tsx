// ---------------------------------------------------------------------------
// Trip Timeline (screen only — shows engine on/off periods)
// ---------------------------------------------------------------------------

import { Trip } from "../types";
import { fmtTime } from "../utils/timezone";

export function TripTimeline({
  trips,
  periodStart,
  periodEnd,
}: {
  trips: Trip[];
  periodStart: string;
  periodEnd: string;
}) {
  if (trips.length === 0) {
    return <p className="text-gray-500 text-sm">No engine activity recorded</p>;
  }

  const startMs = new Date(periodStart).getTime();
  const endMs = new Date(periodEnd).getTime();
  const totalMs = endMs - startMs || 1;

  return (
    <div>
      <div className="relative h-8 bg-gray-800 rounded-lg overflow-hidden print-hide-visual">
        {trips.map((trip, i) => {
          const tripStartMs = new Date(trip.startTime).getTime();
          const tripEndMs = new Date(trip.endTime).getTime();
          const left = ((tripStartMs - startMs) / totalMs) * 100;
          const w = ((tripEndMs - tripStartMs) / totalMs) * 100;
          return (
            <div
              key={i}
              className="absolute top-0 h-full bg-green-600/70 border-x border-green-500/50"
              style={{ left: `${Math.max(0, left)}%`, width: `${Math.max(0.5, w)}%` }}
              title={`${fmtTime(trip.startTime)} — ${fmtTime(trip.endTime)} (${trip.durationMin} min)`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-500 mt-1 print-hide-visual">
        <span>{fmtTime(periodStart)}</span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-3 h-2 bg-green-600/70 rounded-sm" /> Engine On
          <span className="inline-block w-3 h-2 bg-gray-800 rounded-sm border border-gray-700" /> Off
        </span>
        <span>{fmtTime(periodEnd)}</span>
      </div>
    </div>
  );
}
