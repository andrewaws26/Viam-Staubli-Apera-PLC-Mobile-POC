/**
 * Shift Report — Data Aggregation Utilities
 *
 * Pure functions that transform raw sensor data points into shift summary
 * statistics. No I/O, no request handling — just data crunching.
 */

import type {
  RawPoint, TabularDataPoint, ShiftAlert, Trip, DtcEvent,
  TimeSeriesPoint, RoutePoint, Stop, RouteData, DebugData, ShiftReport,
} from "./types";
import { unwrapPayload, normalizeTimestamp } from "@/lib/viam-data";

// ---------------------------------------------------------------------------
// Primitive converters
// ---------------------------------------------------------------------------

export function num(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") { const n = parseFloat(val); return isNaN(n) ? 0 : n; }
  return 0;
}

export function bool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (val === 1 || val === "true") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Row parsing (unwrap Viam payload.readings nesting)
// ---------------------------------------------------------------------------

export function parseRows(rows: TabularDataPoint[]): RawPoint[] {
  return rows
    .map((row) => ({
      timeCaptured: normalizeTimestamp(row.timeCaptured),
      payload: unwrapPayload(row.payload),
    }))
    .sort((a, b) => a.timeCaptured.getTime() - b.timeCaptured.getTime());
}

// ---------------------------------------------------------------------------
// Timezone / time-range helpers
// ---------------------------------------------------------------------------

/** UTC offset in minutes for a date in a timezone. Positive = local behind UTC. */
export function getTimezoneOffsetMin(dateStr: string, tz: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const utcStr = probe.toLocaleString("en-US", { timeZone: "UTC" });
  const localStr = probe.toLocaleString("en-US", { timeZone: tz });
  return (new Date(utcStr).getTime() - new Date(localStr).getTime()) / 60000;
}

/** Compute UTC boundaries from date + local-TZ start/end hours. */
export function timeBounds(
  dateStr: string, startHour: number, startMin: number,
  endHour: number, endMin: number, tz: string,
): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const offsetMin = getTimezoneOffsetMin(dateStr, tz);
  const localMidnightUtcMs = Date.UTC(y, m - 1, d) + offsetMin * 60000;
  const startMs = localMidnightUtcMs + (startHour * 60 + startMin) * 60000;
  let endMs = localMidnightUtcMs + (endHour * 60 + endMin) * 60000;
  if (endMs <= startMs) endMs += 24 * 3600000; // crosses midnight
  return { start: new Date(startMs), end: new Date(endMs) };
}

/** Legacy shift presets -> hour/minute pairs. */
export function shiftToHours(shift: string): { sh: number; sm: number; eh: number; em: number } {
  if (shift === "day") return { sh: 6, sm: 0, eh: 18, em: 0 };
  if (shift === "night") return { sh: 18, sm: 0, eh: 6, em: 0 };
  return { sh: 0, sm: 0, eh: 0, em: 0 }; // full day
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

export function downsample<T>(data: T[], maxN: number): T[] {
  if (data.length <= maxN) return data;
  const step = data.length / maxN;
  const result: T[] = [];
  for (let i = 0; i < maxN; i++) result.push(data[Math.floor(i * step)]);
  if (result[result.length - 1] !== data[data.length - 1]) result.push(data[data.length - 1]);
  return result;
}

/** Haversine distance in miles between two lat/lon pairs. */
function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// TPS plate aggregation
// ---------------------------------------------------------------------------

interface TpsMetrics { totalPlates: number; ejectFailures: number }

function aggregateTps(tpsPoints: RawPoint[]): TpsMetrics {
  let totalPlates = 0;
  let ejectFailures = 0;
  if (tpsPoints.length > 1) {
    const plateCounts = tpsPoints.map((p) => num(p.payload.plate_drop_count || p.payload.ds7));
    const validCounts = plateCounts.filter((c) => c > 0);
    if (validCounts.length > 0) {
      totalPlates = Math.max(0, Math.max(...validCounts) - Math.min(...validCounts));
    }
    let prevDetEject = false;
    for (const pt of tpsPoints) {
      const detEject = bool(pt.payload.drop_detector_eject);
      const encEject = bool(pt.payload.drop_encoder_eject);
      if (encEject && !detEject && !prevDetEject) ejectFailures++;
      prevDetEject = detEject;
    }
  }
  return { totalPlates, ejectFailures };
}

// ---------------------------------------------------------------------------
// Truck engine / route aggregation
// ---------------------------------------------------------------------------

interface TruckMetrics {
  engineHours: number; idleHours: number;
  peakCoolant: { value: number; timestamp: string } | null;
  peakOilTemp: { value: number; timestamp: string } | null;
  minBattery: { value: number; timestamp: string } | null;
  dtcMap: Map<string, string>; trips: Trip[];
  gpsPoints: RoutePoint[]; gpsTotalMiles: number; speedTotalMiles: number;
  movingSeconds: number; stoppedSeconds: number;
  // Debug accumulators
  dbg_rpmGtZeroCount: number; dbg_rpmGtZeroAndSpeedZeroCount: number;
  dbg_engineRunningSeconds: number; dbg_idleSeconds: number;
  dbg_coolantMin: number; dbg_coolantMax: number; dbg_coolantMaxTs: string | null;
  dbg_oilTempMax: number; dbg_oilTempMaxTs: string | null;
  dbg_batteryMin: number; dbg_batteryMinTs: string | null;
  dbg_gapsOver60s: number; dbg_totalGapSec: number;
}

function aggregateTruck(truckPoints: RawPoint[]): TruckMetrics {
  const m: TruckMetrics = {
    engineHours: 0, idleHours: 0,
    peakCoolant: null, peakOilTemp: null, minBattery: null,
    dtcMap: new Map(), trips: [], gpsPoints: [],
    gpsTotalMiles: 0, speedTotalMiles: 0, movingSeconds: 0, stoppedSeconds: 0,
    dbg_rpmGtZeroCount: 0, dbg_rpmGtZeroAndSpeedZeroCount: 0,
    dbg_engineRunningSeconds: 0, dbg_idleSeconds: 0,
    dbg_coolantMin: Infinity, dbg_coolantMax: -Infinity, dbg_coolantMaxTs: null,
    dbg_oilTempMax: -Infinity, dbg_oilTempMaxTs: null,
    dbg_batteryMin: Infinity, dbg_batteryMinTs: null,
    dbg_gapsOver60s: 0, dbg_totalGapSec: 0,
  };
  if (truckPoints.length === 0) return m;

  let engineRunningSec = 0, idleSec = 0;
  let tripStart: Date | null = null, prevRunning = false;
  let prevGpsLat = 0, prevGpsLon = 0;

  for (let i = 0; i < truckPoints.length; i++) {
    const pt = truckPoints[i];
    const rpm = num(pt.payload.engine_rpm);
    const speed = num(pt.payload.vehicle_speed_mph);
    const coolant = num(pt.payload.coolant_temp_f);
    const oilTemp = num(pt.payload.oil_temp_f);
    const battery = num(pt.payload.battery_voltage_v);
    const lat = num(pt.payload.gps_latitude);
    const lon = num(pt.payload.gps_longitude);
    const ts = pt.timeCaptured.toISOString();

    const dtSec = i < truckPoints.length - 1
      ? (truckPoints[i + 1].timeCaptured.getTime() - pt.timeCaptured.getTime()) / 1000 : 1;
    const clampedDt = Math.min(dtSec, 60);

    // Gap tracking (debug)
    if (i > 0) {
      const rawGap = (pt.timeCaptured.getTime() - truckPoints[i - 1].timeCaptured.getTime()) / 1000;
      m.dbg_totalGapSec += rawGap;
      if (rawGap > 60) m.dbg_gapsOver60s++;
    }

    const running = rpm > 0;
    if (running) m.dbg_rpmGtZeroCount++;
    if (running && speed === 0) m.dbg_rpmGtZeroAndSpeedZeroCount++;

    if (running) { engineRunningSec += clampedDt; if (speed === 0) idleSec += clampedDt; }
    if (speed > 0) { m.movingSeconds += clampedDt; m.speedTotalMiles += speed * (clampedDt / 3600); }
    else m.stoppedSeconds += clampedDt;

    // GPS
    if (lat !== 0 && lon !== 0 && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      m.gpsPoints.push({ lat, lon, t: ts });
      if (prevGpsLat !== 0 && prevGpsLon !== 0) {
        m.gpsTotalMiles += haversineMiles(prevGpsLat, prevGpsLon, lat, lon);
      }
      prevGpsLat = lat; prevGpsLon = lon;
    }

    // Trip detection
    if (running && !prevRunning) tripStart = pt.timeCaptured;
    else if (!running && prevRunning && tripStart) {
      m.trips.push({ startTime: tripStart.toISOString(), endTime: ts,
        durationMin: Math.round((pt.timeCaptured.getTime() - tripStart.getTime()) / 60000) });
      tripStart = null;
    }
    prevRunning = running;

    // Peak / min tracking
    if (coolant > 0) {
      if (coolant < m.dbg_coolantMin) m.dbg_coolantMin = coolant;
      if (coolant > m.dbg_coolantMax) { m.dbg_coolantMax = coolant; m.dbg_coolantMaxTs = ts; }
      if (!m.peakCoolant || coolant > m.peakCoolant.value)
        m.peakCoolant = { value: Math.round(coolant * 10) / 10, timestamp: ts };
    }
    if (oilTemp > 0) {
      if (oilTemp > m.dbg_oilTempMax) { m.dbg_oilTempMax = oilTemp; m.dbg_oilTempMaxTs = ts; }
      if (!m.peakOilTemp || oilTemp > m.peakOilTemp.value)
        m.peakOilTemp = { value: Math.round(oilTemp * 10) / 10, timestamp: ts };
    }
    if (battery > 0) {
      if (battery < m.dbg_batteryMin) { m.dbg_batteryMin = battery; m.dbg_batteryMinTs = ts; }
      if (!m.minBattery || battery < m.minBattery.value)
        m.minBattery = { value: Math.round(battery * 100) / 100, timestamp: ts };
    }

    // DTCs
    const dtcCount = num(pt.payload.active_dtc_count);
    if (dtcCount > 0) {
      for (let d = 0; d < Math.min(dtcCount, 5); d++) {
        const spn = pt.payload[`dtc_${d}_spn`], fmi = pt.payload[`dtc_${d}_fmi`];
        if (spn !== undefined && fmi !== undefined) {
          const code = `SPN ${spn} FMI ${fmi}`;
          if (!m.dtcMap.has(code)) m.dtcMap.set(code, ts);
        }
        const obd2Code = pt.payload[`obd2_dtc_${d}`];
        if (obd2Code) { const code = String(obd2Code); if (!m.dtcMap.has(code)) m.dtcMap.set(code, ts); }
      }
    }
  }

  // Close open trip
  if (prevRunning && tripStart) {
    const last = truckPoints[truckPoints.length - 1];
    m.trips.push({ startTime: tripStart.toISOString(), endTime: last.timeCaptured.toISOString(),
      durationMin: Math.round((last.timeCaptured.getTime() - tripStart.getTime()) / 60000) });
  }

  m.dbg_engineRunningSeconds = engineRunningSec;
  m.dbg_idleSeconds = idleSec;
  m.engineHours = Math.round((engineRunningSec / 3600) * 100) / 100;
  m.idleHours = Math.round((idleSec / 3600) * 100) / 100;
  return m;
}

// ---------------------------------------------------------------------------
// Alert generation
// ---------------------------------------------------------------------------

function generateAlerts(
  truck: TruckMetrics, tps: TpsMetrics, idlePercent: number, periodStart: Date,
): ShiftAlert[] {
  const alerts: ShiftAlert[] = [];
  if (truck.peakCoolant && truck.peakCoolant.value > 220)
    alerts.push({ level: truck.peakCoolant.value > 240 ? "critical" : "warning",
      message: `Coolant temp reached ${truck.peakCoolant.value}\u00B0F`,
      timestamp: truck.peakCoolant.timestamp, value: truck.peakCoolant.value });
  if (truck.minBattery && truck.minBattery.value < 12)
    alerts.push({ level: truck.minBattery.value < 11 ? "critical" : "warning",
      message: `Battery dropped to ${truck.minBattery.value}V`,
      timestamp: truck.minBattery.timestamp, value: truck.minBattery.value });
  if (truck.dtcMap.size > 0)
    alerts.push({ level: "critical",
      message: `${truck.dtcMap.size} diagnostic trouble code${truck.dtcMap.size > 1 ? "s" : ""} detected`,
      timestamp: [...truck.dtcMap.values()][0] });
  if (idlePercent > 40)
    alerts.push({ level: "warning", message: `High idle time: ${idlePercent}%`,
      timestamp: periodStart.toISOString(), value: idlePercent });
  if (tps.ejectFailures > 0)
    alerts.push({ level: tps.ejectFailures > 5 ? "critical" : "warning",
      message: `${tps.ejectFailures} eject failure${tps.ejectFailures > 1 ? "s" : ""} detected`,
      timestamp: periodStart.toISOString(), value: tps.ejectFailures });
  return alerts;
}

// ---------------------------------------------------------------------------
// Route builder
// ---------------------------------------------------------------------------

function buildRoute(truck: TruckMetrics): RouteData {
  const hasGps = truck.gpsPoints.length > 10;
  const points = downsample(truck.gpsPoints, 150);
  const stops: Stop[] = [];
  for (let i = 0; i < truck.trips.length - 1; i++) {
    const gapStart = new Date(truck.trips[i].endTime);
    const gapEnd = new Date(truck.trips[i + 1].startTime);
    const gapMin = (gapEnd.getTime() - gapStart.getTime()) / 60000;
    if (gapMin >= 5) {
      const stopGps = truck.gpsPoints.find((p) => new Date(p.t).getTime() >= gapStart.getTime());
      stops.push({ lat: stopGps?.lat ?? 0, lon: stopGps?.lon ?? 0,
        t: gapStart.toISOString(), durationMin: Math.round(gapMin) });
    }
  }
  const gp = truck.gpsPoints;
  return {
    hasGps, points,
    startLocation: hasGps ? { lat: gp[0].lat, lon: gp[0].lon } : null,
    endLocation: hasGps ? { lat: gp[gp.length - 1].lat, lon: gp[gp.length - 1].lon } : null,
    distanceMiles: hasGps
      ? Math.round(truck.gpsTotalMiles * 10) / 10
      : Math.round(truck.speedTotalMiles * 10) / 10,
    distanceSource: hasGps ? "gps" : "speed_estimate",
    stops,
    movingMinutes: Math.round(truck.movingSeconds / 60),
    stoppedMinutes: Math.round(truck.stoppedSeconds / 60),
  };
}

// ---------------------------------------------------------------------------
// Main report builder (public API)
// ---------------------------------------------------------------------------

export function buildShiftReport(
  tpsPoints: RawPoint[], truckPoints: RawPoint[],
  dateStr: string, periodStart: Date, periodEnd: Date,
  includeDebug: boolean, tz: string,
): ShiftReport {
  const truck = aggregateTruck(truckPoints);
  const tps = aggregateTps(tpsPoints);

  const idlePercent = truck.engineHours > 0
    ? Math.round((truck.idleHours / truck.engineHours) * 1000) / 10 : 0;

  const platesPerHour = truck.engineHours > 0
    ? Math.round((tps.totalPlates / truck.engineHours) * 10) / 10
    : tps.totalPlates > 0 && tpsPoints.length > 1
      ? (() => {
          const spanH = (tpsPoints[tpsPoints.length - 1].timeCaptured.getTime() - tpsPoints[0].timeCaptured.getTime()) / 3600000;
          return spanH > 0 ? Math.round((tps.totalPlates / spanH) * 10) / 10 : 0;
        })()
      : 0;

  const alerts = generateAlerts(truck, tps, idlePercent, periodStart);
  const timeSeries: TimeSeriesPoint[] = downsample(truckPoints, 200).map((pt) => ({
    t: pt.timeCaptured.toISOString(),
    rpm: Math.round(num(pt.payload.engine_rpm)),
    coolant_f: Math.round(num(pt.payload.coolant_temp_f) * 10) / 10,
    speed_mph: Math.round(num(pt.payload.vehicle_speed_mph) * 10) / 10,
    battery_v: Math.round(num(pt.payload.battery_voltage_v) * 100) / 100,
    oil_f: Math.round(num(pt.payload.oil_temp_f) * 10) / 10,
  }));
  const route = buildRoute(truck);
  const dtcEvents: DtcEvent[] = [...truck.dtcMap.entries()].map(([code, firstSeen]) => ({ code, firstSeen }));

  const result: ShiftReport = {
    date: dateStr, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(),
    truckId: "Truck 1", timezone: tz,
    engineHours: truck.engineHours, idleHours: truck.idleHours, idlePercent,
    totalPlates: tps.totalPlates, platesPerHour, ejectFailures: tps.ejectFailures,
    peakCoolantTemp: truck.peakCoolant, peakOilTemp: truck.peakOilTemp,
    minBatteryVoltage: truck.minBattery,
    dtcEvents, trips: truck.trips, alerts, route, timeSeries,
    dataPointCount: { tps: tpsPoints.length, truck: truckPoints.length },
    hasTpsData: tpsPoints.length > 0, hasTruckData: truckPoints.length > 0,
  };

  if (includeDebug) {
    const avgGap = truckPoints.length > 1 ? truck.dbg_totalGapSec / (truckPoints.length - 1) : 0;
    result._debug = {
      rawTruckPoints: truckPoints.length, rawTpsPoints: tpsPoints.length,
      firstTruckTimestamp: truckPoints.length > 0 ? truckPoints[0].timeCaptured.toISOString() : null,
      lastTruckTimestamp: truckPoints.length > 0 ? truckPoints[truckPoints.length - 1].timeCaptured.toISOString() : null,
      rpmGtZeroCount: truck.dbg_rpmGtZeroCount,
      rpmGtZeroAndSpeedZeroCount: truck.dbg_rpmGtZeroAndSpeedZeroCount,
      engineRunningSeconds: Math.round(truck.dbg_engineRunningSeconds),
      idleSeconds: Math.round(truck.dbg_idleSeconds),
      coolantMin: truck.dbg_coolantMin === Infinity ? 0 : Math.round(truck.dbg_coolantMin * 10) / 10,
      coolantMax: truck.dbg_coolantMax === -Infinity ? 0 : Math.round(truck.dbg_coolantMax * 10) / 10,
      coolantMaxTimestamp: truck.dbg_coolantMaxTs,
      oilTempMax: truck.dbg_oilTempMax === -Infinity ? 0 : Math.round(truck.dbg_oilTempMax * 10) / 10,
      oilTempMaxTimestamp: truck.dbg_oilTempMaxTs,
      batteryMin: truck.dbg_batteryMin === Infinity ? 0 : Math.round(truck.dbg_batteryMin * 100) / 100,
      batteryMinTimestamp: truck.dbg_batteryMinTs,
      gapsOver60s: truck.dbg_gapsOver60s, avgGapSeconds: Math.round(avgGap * 10) / 10,
      queryStartUtc: periodStart.toISOString(), queryEndUtc: periodEnd.toISOString(),
      timezoneOffset: getTimezoneOffsetMin(dateStr, tz),
    } satisfies DebugData;
  }

  return result;
}
