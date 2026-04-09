/**
 * Type definitions for the Shift Report API.
 *
 * Shared between route.ts (request handling) and aggregation.ts (data processing).
 * Viam Data API types are re-exported from the shared client module.
 */

// Re-export Viam types from the shared client so aggregation.ts doesn't
// need to know about lib/viam-data directly.
export type { CachedViamClient, TabularDataPoint, RawPoint } from "@/lib/viam-data";

// ---------------------------------------------------------------------------
// Report sub-types
// ---------------------------------------------------------------------------

export interface ShiftAlert {
  level: "warning" | "critical";
  message: string;
  timestamp: string;
  value?: number;
}

export interface Trip {
  startTime: string;
  endTime: string;
  durationMin: number;
}

export interface DtcEvent {
  code: string;
  firstSeen: string;
}

export interface TimeSeriesPoint {
  t: string;
  rpm: number;
  coolant_f: number;
  speed_mph: number;
  battery_v: number;
  oil_f: number;
}

export interface RoutePoint {
  lat: number;
  lon: number;
  t: string;
}

export interface Stop {
  lat: number;
  lon: number;
  t: string;
  durationMin: number;
}

export interface RouteData {
  hasGps: boolean;
  points: RoutePoint[];
  startLocation: { lat: number; lon: number } | null;
  endLocation: { lat: number; lon: number } | null;
  distanceMiles: number;
  distanceSource: "gps" | "speed_estimate";
  stops: Stop[];
  movingMinutes: number;
  stoppedMinutes: number;
}

export interface DebugData {
  rawTruckPoints: number;
  rawTpsPoints: number;
  firstTruckTimestamp: string | null;
  lastTruckTimestamp: string | null;
  rpmGtZeroCount: number;
  rpmGtZeroAndSpeedZeroCount: number;
  engineRunningSeconds: number;
  idleSeconds: number;
  coolantMin: number;
  coolantMax: number;
  coolantMaxTimestamp: string | null;
  oilTempMax: number;
  oilTempMaxTimestamp: string | null;
  batteryMin: number;
  batteryMinTimestamp: string | null;
  gapsOver60s: number;
  avgGapSeconds: number;
  queryStartUtc: string;
  queryEndUtc: string;
  timezoneOffset: number;
}

// ---------------------------------------------------------------------------
// Top-level shift report shape
// ---------------------------------------------------------------------------

export interface DataQualityWarning {
  section: string;
  message: string;
  severity: "info" | "warning";
}

export interface ShiftReport {
  date: string;
  periodStart: string;
  periodEnd: string;
  truckId: string;
  timezone: string;
  engineHours: number;
  idleHours: number;
  idlePercent: number;
  totalPlates: number;
  platesPerHour: number;
  ejectFailures: number;
  peakCoolantTemp: { value: number; timestamp: string } | null;
  peakOilTemp: { value: number; timestamp: string } | null;
  minBatteryVoltage: { value: number; timestamp: string } | null;
  dtcEvents: DtcEvent[];
  trips: Trip[];
  alerts: ShiftAlert[];
  route: RouteData;
  timeSeries: TimeSeriesPoint[];
  dataPointCount: { tps: number; truck: number };
  hasTpsData: boolean;
  hasTruckData: boolean;
  dataQuality: DataQualityWarning[];
  _debug?: DebugData;
}
