// ---------------------------------------------------------------------------
// Print-only tables (replace visual elements in print output)
// ---------------------------------------------------------------------------

import { TimeSeriesPoint, Trip } from "../types";
import { fmtTime } from "../utils/timezone";

// ---------------------------------------------------------------------------
// Print-only data table (replaces SVG charts in print)
// ---------------------------------------------------------------------------

export function PrintDataTable({ timeSeries }: { timeSeries: TimeSeriesPoint[] }) {
  if (timeSeries.length === 0) return null;

  // Sample ~20 rows evenly for a clean table
  const step = Math.max(1, Math.floor(timeSeries.length / 20));
  const sampled = timeSeries.filter((_, i) => i % step === 0);
  // Always include last point
  if (sampled[sampled.length - 1] !== timeSeries[timeSeries.length - 1]) {
    sampled.push(timeSeries[timeSeries.length - 1]);
  }

  return (
    <table className="print-data-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>RPM</th>
          <th>Coolant °F</th>
          <th>Oil °F</th>
          <th>Speed mph</th>
          <th>Battery V</th>
        </tr>
      </thead>
      <tbody>
        {sampled.map((p, i) => (
          <tr key={i}>
            <td>{fmtTime(p.t)}</td>
            <td>{Math.round(p.rpm)}</td>
            <td>{Math.round(p.coolant_f)}</td>
            <td>{Math.round(p.oil_f)}</td>
            <td>{Math.round(p.speed_mph)}</td>
            <td>{p.battery_v.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Print-only trip table (replaces visual timeline in print)
// ---------------------------------------------------------------------------

export function PrintTripTable({ trips }: { trips: Trip[] }) {
  if (trips.length === 0) return null;

  return (
    <table className="print-data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Start</th>
          <th>End</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        {trips.map((trip, i) => (
          <tr key={i}>
            <td>{i + 1}</td>
            <td>{fmtTime(trip.startTime)}</td>
            <td>{fmtTime(trip.endTime)}</td>
            <td>{trip.durationMin} min</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
