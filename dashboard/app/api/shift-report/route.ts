/**
 * Shift Report API — aggregates TPS plate data + truck engine data for a
 * date/shift into a one-page summary a foreman can read in 10 seconds.
 *
 * GET /api/shift-report?date=2026-04-01&shift=day
 * GET /api/shift-report?date=2026-04-01&shift=night
 * GET /api/shift-report?date=2026-04-01               (full day)
 * GET /api/shift-report?date=2026-04-01&debug=1        (includes _debug object)
 *
 * All times are interpreted in America/New_York (Louisville, KY).
 */

import { NextRequest, NextResponse } from "next/server";
import { createViamClient } from "@viamrobotics/sdk";

// ---------------------------------------------------------------------------
// Viam Data API client (cached, same pattern as sensor-history/truck-history)
// ---------------------------------------------------------------------------

interface CachedViamClient {
  dataClient: {
    exportTabularData(
      partId: string,
      resourceName: string,
      resourceSubtype: string,
      methodName: string,
      startTime?: Date,
      endTime?: Date,
    ): Promise<TabularDataPoint[]>;
  };
}

interface TabularDataPoint {
  timeCaptured: Date;
  payload: unknown;
  [key: string]: unknown;
}

let _viamClient: CachedViamClient | null = null;
let _connecting = false;

const TPS_PART_ID = process.env.VIAM_PART_ID || "7c24d42f-1d66-4cae-81a4-97e3ff9404b4";
const TRUCK_PART_ID = process.env.TRUCK_VIAM_PART_ID || "ca039781-665c-47e3-9bc5-35f603f3baf1";
const RESOURCE_SUBTYPE = "rdk:component:sensor";
const METHOD_NAME = "Readings";
const TZ = "America/New_York"; // Louisville, KY

function getCachedClient(): CachedViamClient | null {
  return _viamClient;
}

async function getDataClient(): Promise<CachedViamClient["dataClient"]> {
  const cached = getCachedClient();
  if (cached) return cached.dataClient;
  if (_connecting) {
    await new Promise((r) => setTimeout(r, 500));
    const retried = getCachedClient();
    if (retried) return retried.dataClient;
    throw new Error("Connection in progress");
  }

  const apiKey = process.env.VIAM_API_KEY;
  const apiKeyId = process.env.VIAM_API_KEY_ID;
  if (!apiKey || !apiKeyId) {
    throw new Error("Missing Viam API credentials (VIAM_API_KEY, VIAM_API_KEY_ID)");
  }

  _connecting = true;
  try {
    const client = await createViamClient({
      credentials: { type: "api-key", authEntity: apiKeyId, payload: apiKey },
    });
    _viamClient = client as unknown as CachedViamClient;
    return _viamClient.dataClient;
  } finally {
    _connecting = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RawPoint {
  timeCaptured: Date;
  payload: Record<string, unknown>;
}

function num(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") { const n = parseFloat(val); return isNaN(n) ? 0 : n; }
  return 0;
}

function bool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (val === 1 || val === "true") return true;
  return false;
}

function parseRows(rows: TabularDataPoint[]): RawPoint[] {
  return rows
    .map((row) => {
      const raw = (typeof row.payload === "object" && row.payload !== null ? row.payload : {}) as Record<string, unknown>;
      const readings = (typeof raw.readings === "object" && raw.readings !== null ? raw.readings : raw) as Record<string, unknown>;
      return {
        timeCaptured: row.timeCaptured instanceof Date ? row.timeCaptured : new Date(String(row.timeCaptured)),
        payload: readings,
      };
    })
    .sort((a, b) => a.timeCaptured.getTime() - b.timeCaptured.getTime());
}

/**
 * Get the UTC offset in minutes for a given date in a given timezone.
 * Positive = local is behind UTC (e.g. Eastern = 240 in EDT, 300 in EST).
 */
function getTimezoneOffsetMin(dateStr: string, tz: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const utcStr = probe.toLocaleString("en-US", { timeZone: "UTC" });
  const localStr = probe.toLocaleString("en-US", { timeZone: tz });
  return (new Date(utcStr).getTime() - new Date(localStr).getTime()) / 60000;
}

/** Compute shift time boundaries in UTC from a local date string + shift */
function shiftBounds(dateStr: string, shift: string): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const offsetMin = getTimezoneOffsetMin(dateStr, TZ);

  // Local midnight of the given date, expressed in UTC ms
  const localMidnightUtcMs = Date.UTC(y, m - 1, d) + offsetMin * 60000;

  if (shift === "day") {
    return { start: new Date(localMidnightUtcMs + 6 * 3600000), end: new Date(localMidnightUtcMs + 18 * 3600000) };
  }
  if (shift === "night") {
    // 6 PM to next-day 6 AM (crosses midnight)
    return { start: new Date(localMidnightUtcMs + 18 * 3600000), end: new Date(localMidnightUtcMs + 30 * 3600000) };
  }
  // full day: midnight to midnight
  return { start: new Date(localMidnightUtcMs), end: new Date(localMidnightUtcMs + 24 * 3600000) };
}

function downsample<T>(data: T[], maxN: number): T[] {
  if (data.length <= maxN) return data;
  const step = data.length / maxN;
  const result: T[] = [];
  for (let i = 0; i < maxN; i++) result.push(data[Math.floor(i * step)]);
  if (result[result.length - 1] !== data[data.length - 1]) result.push(data[data.length - 1]);
  return result;
}

/** Haversine distance in miles between two lat/lon pairs */
function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShiftAlert {
  level: "warning" | "critical";
  message: string;
  timestamp: string;
  value?: number;
}

interface Trip {
  startTime: string;
  endTime: string;
  durationMin: number;
}

interface DtcEvent {
  code: string;
  firstSeen: string;
}

interface TimeSeriesPoint {
  t: string;
  rpm: number;
  coolant_f: number;
  speed_mph: number;
  battery_v: number;
  oil_f: number;
}

interface RoutePoint {
  lat: number;
  lon: number;
  t: string;
}

interface Stop {
  lat: number;
  lon: number;
  t: string;
  durationMin: number;
}

interface RouteData {
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

interface DebugData {
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
// Shift report builder
// ---------------------------------------------------------------------------

function buildShiftReport(
  tpsPoints: RawPoint[],
  truckPoints: RawPoint[],
  dateStr: string,
  shift: string,
  periodStart: Date,
  periodEnd: Date,
  includeDebug: boolean,
) {
  const alerts: ShiftAlert[] = [];

  // --- Debug accumulators ---
  let dbg_rpmGtZeroCount = 0;
  let dbg_rpmGtZeroAndSpeedZeroCount = 0;
  let dbg_engineRunningSeconds = 0;
  let dbg_idleSeconds = 0;
  let dbg_coolantMin = Infinity;
  let dbg_coolantMax = -Infinity;
  let dbg_coolantMaxTs: string | null = null;
  let dbg_oilTempMax = -Infinity;
  let dbg_oilTempMaxTs: string | null = null;
  let dbg_batteryMin = Infinity;
  let dbg_batteryMinTs: string | null = null;
  let dbg_gapsOver60s = 0;
  let dbg_totalGapSec = 0;

  // --- Engine metrics from truck data ---
  let engineHours = 0;
  let idleHours = 0;

  let peakCoolant: { value: number; timestamp: string } | null = null;
  let peakOilTemp: { value: number; timestamp: string } | null = null;
  let minBattery: { value: number; timestamp: string } | null = null;

  const dtcMap = new Map<string, string>();
  const trips: Trip[] = [];

  // GPS + distance tracking
  const gpsPoints: RoutePoint[] = [];
  let gpsTotalMiles = 0;
  let speedTotalMiles = 0;
  let prevGpsLat = 0;
  let prevGpsLon = 0;
  let movingSeconds = 0;
  let stoppedSeconds = 0;

  if (truckPoints.length > 0) {
    let engineRunningSeconds = 0;
    let idleSeconds = 0;
    let tripStart: Date | null = null;
    let prevRunning = false;

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

      // Time delta
      const dtSec = i < truckPoints.length - 1
        ? (truckPoints[i + 1].timeCaptured.getTime() - pt.timeCaptured.getTime()) / 1000
        : 1;
      const clampedDt = Math.min(dtSec, 60);

      // Debug gap tracking
      if (i > 0) {
        const rawGap = (pt.timeCaptured.getTime() - truckPoints[i - 1].timeCaptured.getTime()) / 1000;
        dbg_totalGapSec += rawGap;
        if (rawGap > 60) dbg_gapsOver60s++;
      }

      const running = rpm > 0;

      // Debug counters
      if (running) dbg_rpmGtZeroCount++;
      if (running && speed === 0) dbg_rpmGtZeroAndSpeedZeroCount++;

      if (running) {
        engineRunningSeconds += clampedDt;
        if (speed === 0) idleSeconds += clampedDt;
      }

      // Moving vs stopped time
      if (speed > 0) movingSeconds += clampedDt;
      else stoppedSeconds += clampedDt;

      // Speed-based distance: speed_mph * dt_hours
      if (speed > 0) {
        speedTotalMiles += speed * (clampedDt / 3600);
      }

      // GPS tracking
      if (lat !== 0 && lon !== 0 && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        gpsPoints.push({ lat, lon, t: ts });
        if (prevGpsLat !== 0 && prevGpsLon !== 0) {
          gpsTotalMiles += haversineMiles(prevGpsLat, prevGpsLon, lat, lon);
        }
        prevGpsLat = lat;
        prevGpsLon = lon;
      }

      // Trip tracking
      if (running && !prevRunning) {
        tripStart = pt.timeCaptured;
      } else if (!running && prevRunning && tripStart) {
        trips.push({
          startTime: tripStart.toISOString(),
          endTime: pt.timeCaptured.toISOString(),
          durationMin: Math.round((pt.timeCaptured.getTime() - tripStart.getTime()) / 60000),
        });
        tripStart = null;
      }
      prevRunning = running;

      // Peaks
      if (coolant > 0) {
        if (coolant < dbg_coolantMin) dbg_coolantMin = coolant;
        if (coolant > dbg_coolantMax) { dbg_coolantMax = coolant; dbg_coolantMaxTs = ts; }
        if (!peakCoolant || coolant > peakCoolant.value) {
          peakCoolant = { value: Math.round(coolant * 10) / 10, timestamp: ts };
        }
      }
      if (oilTemp > 0) {
        if (oilTemp > dbg_oilTempMax) { dbg_oilTempMax = oilTemp; dbg_oilTempMaxTs = ts; }
        if (!peakOilTemp || oilTemp > peakOilTemp.value) {
          peakOilTemp = { value: Math.round(oilTemp * 10) / 10, timestamp: ts };
        }
      }
      if (battery > 0) {
        if (battery < dbg_batteryMin) { dbg_batteryMin = battery; dbg_batteryMinTs = ts; }
        if (!minBattery || battery < minBattery.value) {
          minBattery = { value: Math.round(battery * 100) / 100, timestamp: ts };
        }
      }

      // DTC tracking
      const dtcCount = num(pt.payload.active_dtc_count);
      if (dtcCount > 0) {
        for (let d = 0; d < Math.min(dtcCount, 5); d++) {
          const spn = pt.payload[`dtc_${d}_spn`];
          const fmi = pt.payload[`dtc_${d}_fmi`];
          if (spn !== undefined && fmi !== undefined) {
            const code = `SPN ${spn} FMI ${fmi}`;
            if (!dtcMap.has(code)) dtcMap.set(code, ts);
          }
          const obd2Code = pt.payload[`obd2_dtc_${d}`];
          if (obd2Code) {
            const code = String(obd2Code);
            if (!dtcMap.has(code)) dtcMap.set(code, ts);
          }
        }
      }
    }

    // Close open trip
    if (prevRunning && tripStart) {
      const lastPt = truckPoints[truckPoints.length - 1];
      trips.push({
        startTime: tripStart.toISOString(),
        endTime: lastPt.timeCaptured.toISOString(),
        durationMin: Math.round((lastPt.timeCaptured.getTime() - tripStart.getTime()) / 60000),
      });
    }

    dbg_engineRunningSeconds = engineRunningSeconds;
    dbg_idleSeconds = idleSeconds;
    engineHours = Math.round((engineRunningSeconds / 3600) * 100) / 100;
    idleHours = Math.round((idleSeconds / 3600) * 100) / 100;
  }

  const idlePercent = engineHours > 0
    ? Math.round((idleHours / engineHours) * 1000) / 10
    : 0;

  // --- TPS plate metrics ---
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

  const platesPerHour = engineHours > 0
    ? Math.round((totalPlates / engineHours) * 10) / 10
    : totalPlates > 0 && tpsPoints.length > 1
      ? (() => {
          const spanHours = (tpsPoints[tpsPoints.length - 1].timeCaptured.getTime() - tpsPoints[0].timeCaptured.getTime()) / 3600000;
          return spanHours > 0 ? Math.round((totalPlates / spanHours) * 10) / 10 : 0;
        })()
      : 0;

  // --- Alerts ---
  if (peakCoolant && peakCoolant.value > 220) {
    alerts.push({
      level: peakCoolant.value > 240 ? "critical" : "warning",
      message: `Coolant temp reached ${peakCoolant.value}°F`,
      timestamp: peakCoolant.timestamp,
      value: peakCoolant.value,
    });
  }
  if (minBattery && minBattery.value < 12) {
    alerts.push({
      level: minBattery.value < 11 ? "critical" : "warning",
      message: `Battery dropped to ${minBattery.value}V`,
      timestamp: minBattery.timestamp,
      value: minBattery.value,
    });
  }
  if (dtcMap.size > 0) {
    alerts.push({
      level: "critical",
      message: `${dtcMap.size} diagnostic trouble code${dtcMap.size > 1 ? "s" : ""} detected`,
      timestamp: [...dtcMap.values()][0],
    });
  }
  if (idlePercent > 40) {
    alerts.push({
      level: "warning",
      message: `High idle time: ${idlePercent}%`,
      timestamp: periodStart.toISOString(),
      value: idlePercent,
    });
  }
  if (ejectFailures > 0) {
    alerts.push({
      level: ejectFailures > 5 ? "critical" : "warning",
      message: `${ejectFailures} eject failure${ejectFailures > 1 ? "s" : ""} detected`,
      timestamp: periodStart.toISOString(),
      value: ejectFailures,
    });
  }

  // --- Time series for charts (downsampled to 200) ---
  const sampled = downsample(truckPoints, 200);
  const timeSeries: TimeSeriesPoint[] = sampled.map((pt) => ({
    t: pt.timeCaptured.toISOString(),
    rpm: Math.round(num(pt.payload.engine_rpm)),
    coolant_f: Math.round(num(pt.payload.coolant_temp_f) * 10) / 10,
    speed_mph: Math.round(num(pt.payload.vehicle_speed_mph) * 10) / 10,
    battery_v: Math.round(num(pt.payload.battery_voltage_v) * 100) / 100,
    oil_f: Math.round(num(pt.payload.oil_temp_f) * 10) / 10,
  }));

  // --- Route / location data ---
  const hasGps = gpsPoints.length > 10;
  const routeDownsampled = downsample(gpsPoints, 150);

  // Detect stops: gaps between trips where engine was off > 5 min, with GPS location
  const stops: Stop[] = [];
  for (let i = 0; i < trips.length - 1; i++) {
    const gapStart = new Date(trips[i].endTime);
    const gapEnd = new Date(trips[i + 1].startTime);
    const gapMin = (gapEnd.getTime() - gapStart.getTime()) / 60000;
    if (gapMin >= 5) {
      // Find GPS point nearest to the stop start
      const stopGps = gpsPoints.find((p) => new Date(p.t).getTime() >= gapStart.getTime());
      stops.push({
        lat: stopGps?.lat ?? 0,
        lon: stopGps?.lon ?? 0,
        t: gapStart.toISOString(),
        durationMin: Math.round(gapMin),
      });
    }
  }

  const route: RouteData = {
    hasGps,
    points: routeDownsampled,
    startLocation: hasGps ? { lat: gpsPoints[0].lat, lon: gpsPoints[0].lon } : null,
    endLocation: hasGps ? { lat: gpsPoints[gpsPoints.length - 1].lat, lon: gpsPoints[gpsPoints.length - 1].lon } : null,
    distanceMiles: hasGps
      ? Math.round(gpsTotalMiles * 10) / 10
      : Math.round(speedTotalMiles * 10) / 10,
    distanceSource: hasGps ? "gps" : "speed_estimate",
    stops,
    movingMinutes: Math.round(movingSeconds / 60),
    stoppedMinutes: Math.round(stoppedSeconds / 60),
  };

  // DTC events
  const dtcEvents: DtcEvent[] = [...dtcMap.entries()].map(([code, firstSeen]) => ({
    code, firstSeen,
  }));

  // Build result
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {
    date: dateStr,
    shift,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    truckId: "Truck 1",
    timezone: TZ,

    engineHours,
    idleHours,
    idlePercent,

    totalPlates,
    platesPerHour,
    ejectFailures,

    peakCoolantTemp: peakCoolant,
    peakOilTemp: peakOilTemp,
    minBatteryVoltage: minBattery,

    dtcEvents,
    trips,
    alerts,
    route,

    timeSeries,

    dataPointCount: { tps: tpsPoints.length, truck: truckPoints.length },
    hasTpsData: tpsPoints.length > 0,
    hasTruckData: truckPoints.length > 0,
  };

  // Debug data
  if (includeDebug) {
    const avgGap = truckPoints.length > 1 ? dbg_totalGapSec / (truckPoints.length - 1) : 0;
    const debug: DebugData = {
      rawTruckPoints: truckPoints.length,
      rawTpsPoints: tpsPoints.length,
      firstTruckTimestamp: truckPoints.length > 0 ? truckPoints[0].timeCaptured.toISOString() : null,
      lastTruckTimestamp: truckPoints.length > 0 ? truckPoints[truckPoints.length - 1].timeCaptured.toISOString() : null,
      rpmGtZeroCount: dbg_rpmGtZeroCount,
      rpmGtZeroAndSpeedZeroCount: dbg_rpmGtZeroAndSpeedZeroCount,
      engineRunningSeconds: Math.round(dbg_engineRunningSeconds),
      idleSeconds: Math.round(dbg_idleSeconds),
      coolantMin: dbg_coolantMin === Infinity ? 0 : Math.round(dbg_coolantMin * 10) / 10,
      coolantMax: dbg_coolantMax === -Infinity ? 0 : Math.round(dbg_coolantMax * 10) / 10,
      coolantMaxTimestamp: dbg_coolantMaxTs,
      oilTempMax: dbg_oilTempMax === -Infinity ? 0 : Math.round(dbg_oilTempMax * 10) / 10,
      oilTempMaxTimestamp: dbg_oilTempMaxTs,
      batteryMin: dbg_batteryMin === Infinity ? 0 : Math.round(dbg_batteryMin * 100) / 100,
      batteryMinTimestamp: dbg_batteryMinTs,
      gapsOver60s: dbg_gapsOver60s,
      avgGapSeconds: Math.round(avgGap * 10) / 10,
      queryStartUtc: periodStart.toISOString(),
      queryEndUtc: periodEnd.toISOString(),
      timezoneOffset: getTimezoneOffsetMin(dateStr, TZ),
    };
    result._debug = debug;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const dateStr = params.get("date") || new Date().toISOString().slice(0, 10);
  const shift = params.get("shift") || "full";
  const includeDebug = params.get("debug") === "1";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }
  if (!["day", "night", "full"].includes(shift)) {
    return NextResponse.json({ error: "Invalid shift. Use day, night, or full." }, { status: 400 });
  }

  const { start, end } = shiftBounds(dateStr, shift);

  try {
    const dc = await getDataClient();

    // Fetch TPS and truck data in parallel
    const [tpsRows, truckRows] = await Promise.all([
      dc.exportTabularData(TPS_PART_ID, "plc-monitor", RESOURCE_SUBTYPE, METHOD_NAME, start, end)
        .catch(() => [] as TabularDataPoint[]),
      dc.exportTabularData(TRUCK_PART_ID, "truck-engine", RESOURCE_SUBTYPE, METHOD_NAME, start, end)
        .catch(() => [] as TabularDataPoint[]),
    ]);

    const tpsPoints = parseRows(tpsRows);
    const truckPoints = parseRows(truckRows);

    const report = buildShiftReport(tpsPoints, truckPoints, dateStr, shift, start, end, includeDebug);

    // Cache completed reports for the same day (immutable once the shift is over)
    const now = new Date();
    const isHistorical = end.getTime() < now.getTime();
    const cacheControl = isHistorical
      ? "public, max-age=3600, s-maxage=3600" // Cache historical reports for 1 hour
      : "public, max-age=60, s-maxage=60";     // Current-day reports cached 1 minute

    return NextResponse.json(report, {
      headers: { "Cache-Control": cacheControl },
    });
  } catch (err) {
    _viamClient = null;
    return NextResponse.json(
      { error: "shift_report_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
