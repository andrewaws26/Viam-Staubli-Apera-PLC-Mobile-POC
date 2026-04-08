// ---------------------------------------------------------------------------
// Types for the Shift Report page
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
}

export interface TimePreset {
  id: string;
  label: string;
  sub: string;
  sh: number;
  sm: number;
  eh: number;
  em: number;
}

export type StatusColor = "green" | "yellow" | "red" | "gray";
