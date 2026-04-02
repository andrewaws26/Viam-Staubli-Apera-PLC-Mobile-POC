/**
 * Shift Report API — aggregates TPS plate data + truck engine data for a
 * date/shift into a one-page summary a foreman can read in 10 seconds.
 *
 * GET /api/shift-report?date=2026-04-01&shift=day
 * GET /api/shift-report?date=2026-04-01&shift=night
 * GET /api/shift-report?date=2026-04-01               (full day)
 *
 * Optional: &tz_offset=-300  (minutes from UTC, like JS getTimezoneOffset())
 *           Defaults to -300 (US Eastern)
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

/** Compute shift time boundaries in UTC from a local date string + shift + tz offset */
function shiftBounds(dateStr: string, shift: string, tzOffsetMin: number): { start: Date; end: Date } {
  // dateStr is YYYY-MM-DD in local time. tzOffsetMin is like JS getTimezoneOffset() (positive = behind UTC).
  const [y, m, d] = dateStr.split("-").map(Number);

  // Local midnight of the given date, converted to UTC
  const localMidnightMs = Date.UTC(y, m - 1, d) + tzOffsetMin * 60000;

  if (shift === "day") {
    return { start: new Date(localMidnightMs + 6 * 3600000), end: new Date(localMidnightMs + 18 * 3600000) };
  }
  if (shift === "night") {
    return { start: new Date(localMidnightMs + 18 * 3600000), end: new Date(localMidnightMs + 30 * 3600000) };
  }
  // full day
  return { start: new Date(localMidnightMs), end: new Date(localMidnightMs + 24 * 3600000) };
}

function downsample<T>(data: T[], maxN: number): T[] {
  if (data.length <= maxN) return data;
  const step = data.length / maxN;
  const result: T[] = [];
  for (let i = 0; i < maxN; i++) result.push(data[Math.floor(i * step)]);
  if (result[result.length - 1] !== data[data.length - 1]) result.push(data[data.length - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// Shift report builder
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

interface ShiftReportData {
  date: string;
  shift: string;
  periodStart: string;
  periodEnd: string;
  truckId: string;

  // Engine
  engineHours: number;
  idleHours: number;
  idlePercent: number;

  // TPS
  totalPlates: number;
  platesPerHour: number;
  ejectFailures: number;

  // Peaks
  peakCoolantTemp: { value: number; timestamp: string } | null;
  peakOilTemp: { value: number; timestamp: string } | null;
  minBatteryVoltage: { value: number; timestamp: string } | null;

  // Events
  dtcEvents: DtcEvent[];
  trips: Trip[];
  alerts: ShiftAlert[];

  // Time series for charts (downsampled)
  timeSeries: TimeSeriesPoint[];

  // Meta
  dataPointCount: { tps: number; truck: number };
  hasTpsData: boolean;
  hasTruckData: boolean;
}

function buildShiftReport(
  tpsPoints: RawPoint[],
  truckPoints: RawPoint[],
  dateStr: string,
  shift: string,
  periodStart: Date,
  periodEnd: Date,
): ShiftReportData {
  const alerts: ShiftAlert[] = [];

  // --- Engine metrics from truck data ---
  let engineHours = 0;
  let idleHours = 0;

  let peakCoolant: { value: number; timestamp: string } | null = null;
  let peakOilTemp: { value: number; timestamp: string } | null = null;
  let minBattery: { value: number; timestamp: string } | null = null;

  const dtcMap = new Map<string, string>(); // code -> first-seen ISO
  const trips: Trip[] = [];

  if (truckPoints.length > 1) {
    // Engine/idle hours: approximate from 1Hz readings
    // Each reading ≈ time gap to next reading (or 1 second for 1Hz)
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
      const ts = pt.timeCaptured.toISOString();

      // Time delta to next point (or estimate 1s for last point)
      const dtSec = i < truckPoints.length - 1
        ? (truckPoints[i + 1].timeCaptured.getTime() - pt.timeCaptured.getTime()) / 1000
        : 1;
      // Cap individual delta at 60s to avoid counting gaps as run time
      const clampedDt = Math.min(dtSec, 60);

      const running = rpm > 0;

      if (running) {
        engineRunningSeconds += clampedDt;
        if (speed === 0) idleSeconds += clampedDt;
      }

      // Track trips
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
      if (coolant > 0 && (!peakCoolant || coolant > peakCoolant.value)) {
        peakCoolant = { value: Math.round(coolant * 10) / 10, timestamp: ts };
      }
      if (oilTemp > 0 && (!peakOilTemp || oilTemp > peakOilTemp.value)) {
        peakOilTemp = { value: Math.round(oilTemp * 10) / 10, timestamp: ts };
      }
      if (battery > 0 && (!minBattery || battery < minBattery.value)) {
        minBattery = { value: Math.round(battery * 100) / 100, timestamp: ts };
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

    // Close open trip at end of data
    if (prevRunning && tripStart) {
      const lastPt = truckPoints[truckPoints.length - 1];
      trips.push({
        startTime: tripStart.toISOString(),
        endTime: lastPt.timeCaptured.toISOString(),
        durationMin: Math.round((lastPt.timeCaptured.getTime() - tripStart.getTime()) / 60000),
      });
    }

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
    // plate_drop_count (or ds7): max - min for the period
    const plateCounts = tpsPoints.map((p) => num(p.payload.plate_drop_count || p.payload.ds7));
    const validCounts = plateCounts.filter((c) => c > 0);
    if (validCounts.length > 0) {
      totalPlates = Math.max(0, Math.max(...validCounts) - Math.min(...validCounts));
    }

    // Count eject failure transitions: detector_eject expected but didn't fire
    // We approximate by counting times drop_detector_eject went true then immediately false
    // without a plate count increment. For simplicity, count any event where
    // detector eject fired but encoder had to take over as a "failure".
    let prevDetEject = false;
    for (const pt of tpsPoints) {
      const detEject = bool(pt.payload.drop_detector_eject);
      const encEject = bool(pt.payload.drop_encoder_eject);
      // Rising edge on encoder eject while detector is NOT active = detector failed to trigger
      if (encEject && !detEject && !prevDetEject) {
        ejectFailures++;
      }
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
      message: `Coolant temp reached ${peakCoolant.value}\u00B0F`,
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

  // --- Time series for charts (from truck data, downsampled to 200 points) ---
  const sampled = downsample(truckPoints, 200);
  const timeSeries: TimeSeriesPoint[] = sampled.map((pt) => ({
    t: pt.timeCaptured.toISOString(),
    rpm: Math.round(num(pt.payload.engine_rpm)),
    coolant_f: Math.round(num(pt.payload.coolant_temp_f) * 10) / 10,
    speed_mph: Math.round(num(pt.payload.vehicle_speed_mph) * 10) / 10,
    battery_v: Math.round(num(pt.payload.battery_voltage_v) * 100) / 100,
    oil_f: Math.round(num(pt.payload.oil_temp_f) * 10) / 10,
  }));

  // DTC events array
  const dtcEvents: DtcEvent[] = [...dtcMap.entries()].map(([code, firstSeen]) => ({
    code,
    firstSeen,
  }));

  return {
    date: dateStr,
    shift,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    truckId: "Truck 1",

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

    timeSeries,

    dataPointCount: { tps: tpsPoints.length, truck: truckPoints.length },
    hasTpsData: tpsPoints.length > 0,
    hasTruckData: truckPoints.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const dateStr = params.get("date") || new Date().toISOString().slice(0, 10);
  const shift = params.get("shift") || "full";
  const tzOffset = parseInt(params.get("tz_offset") || "300", 10); // default Eastern (UTC-5 = +300 min)

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }
  if (!["day", "night", "full"].includes(shift)) {
    return NextResponse.json({ error: "Invalid shift. Use day, night, or full." }, { status: 400 });
  }

  const { start, end } = shiftBounds(dateStr, shift, tzOffset);

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

    const report = buildShiftReport(tpsPoints, truckPoints, dateStr, shift, start, end);
    return NextResponse.json(report);
  } catch (err) {
    _viamClient = null;
    return NextResponse.json(
      { error: "shift_report_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
