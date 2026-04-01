/**
 * Server-side API route for historical truck diagnostic data via Viam Data API.
 *
 * Queries the truck-diagnostic machine's captured sensor readings over a
 * configurable time window. Returns time-series data and computed summaries
 * for use in reports and trend analysis.
 *
 * GET /api/truck-history?hours=1        — last hour of readings
 * GET /api/truck-history?hours=24       — last 24 hours
 */

import { NextRequest, NextResponse } from "next/server";
import { createViamClient } from "@viamrobotics/sdk";

// Cached ViamClient for data queries
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

const TRUCK_PART_ID = "ca039781-665c-47e3-9bc5-35f603f3baf1";
const RESOURCE_NAME = "truck-engine";
const RESOURCE_SUBTYPE = "rdk:component:sensor";
const METHOD_NAME = "Readings";
const MAX_POINTS = 500;

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

  // Use location-level key for data queries (machine-level keys lack data read permissions)
  const apiKey = process.env.VIAM_API_KEY;
  const apiKeyId = process.env.VIAM_API_KEY_ID;

  if (!apiKey || !apiKeyId) {
    throw new Error("Missing Viam API credentials for truck data query");
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

function num(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  return 0;
}

function downsample<T>(data: T[], maxN: number): T[] {
  if (data.length <= maxN) return data;
  const step = data.length / maxN;
  const result: T[] = [];
  for (let i = 0; i < maxN; i++) result.push(data[Math.floor(i * step)]);
  if (result[result.length - 1] !== data[data.length - 1]) result.push(data[data.length - 1]);
  return result;
}

interface RawPoint {
  timeCaptured: Date;
  payload: Record<string, unknown>;
}

async function fetchTruckData(hours: number): Promise<RawPoint[]> {
  const dc = await getDataClient();
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - hours * 3600000);

  const rows = await dc.exportTabularData(
    TRUCK_PART_ID, RESOURCE_NAME, RESOURCE_SUBTYPE, METHOD_NAME, startTime, endTime,
  );

  const points: RawPoint[] = rows.map((row) => ({
    timeCaptured: row.timeCaptured instanceof Date ? row.timeCaptured : new Date(String(row.timeCaptured)),
    payload: (typeof row.payload === "object" && row.payload !== null ? row.payload : {}) as Record<string, unknown>,
  }));

  points.sort((a, b) => a.timeCaptured.getTime() - b.timeCaptured.getTime());
  return points;
}

function buildTruckSummary(points: RawPoint[], hours: number) {
  if (points.length === 0) {
    return { totalPoints: 0, hours, periodStart: null, periodEnd: null, summary: null, timeSeries: [] };
  }

  const first = points[0];
  const last = points[points.length - 1];
  const totalMinutes = (last.timeCaptured.getTime() - first.timeCaptured.getTime()) / 60000;

  // Extract key metrics — support both J1939 and OBD2 field names
  const rpms = points.map(p => num(p.payload.engine_rpm));
  const coolants = points.map(p => num(p.payload.coolant_temp_f));
  const speeds = points.map(p => num(p.payload.vehicle_speed_mph));
  const batteries = points.map(p => num(p.payload.battery_voltage_v));
  const fuelLevels = points.map(p => num(p.payload.fuel_level_pct));
  const oilTemps = points.map(p => num(p.payload.oil_temp_f));
  // J1939 fields
  const oilPressures = points.map(p => num(p.payload.oil_pressure_psi));
  const boostPressures = points.map(p => num(p.payload.boost_pressure_psi));
  const fuelRates = points.map(p => num(p.payload.fuel_rate_gph));
  const loads = points.map(p => num(p.payload.engine_load_pct));
  const intakeTemps = points.map(p => num(p.payload.intake_manifold_temp_f || p.payload.intake_air_temp_f));
  const dpfSoot = points.map(p => num(p.payload.dpf_soot_load_pct));
  const defLevels = points.map(p => num(p.payload.def_level_pct));
  // OBD2 fields (fallback for passenger vehicles)
  const throttles = points.map(p => num(p.payload.throttle_position_pct || p.payload.accel_pedal_pos_pct));
  const shortTrims = points.map(p => num(p.payload.short_fuel_trim_b1_pct));
  const longTrims = points.map(p => num(p.payload.long_fuel_trim_b1_pct));

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const max = (arr: number[]) => arr.length ? Math.max(...arr) : 0;
  const min = (arr: number[]) => arr.length ? Math.min(...arr) : 0;

  // DTC events — support both J1939 (SPN/FMI) and OBD2 (P-codes)
  const dtcEvents: { timestamp: string; code: string }[] = [];
  let prevDtcCount = 0;
  for (const pt of points) {
    const dtcCount = num(pt.payload.active_dtc_count);
    if (dtcCount > 0 && dtcCount !== prevDtcCount) {
      for (let i = 0; i < Math.min(dtcCount, 5); i++) {
        // J1939 format: dtc_N_spn + dtc_N_fmi
        const spn = pt.payload[`dtc_${i}_spn`];
        const fmi = pt.payload[`dtc_${i}_fmi`];
        if (spn !== undefined && fmi !== undefined) {
          dtcEvents.push({ timestamp: pt.timeCaptured.toISOString(), code: `SPN ${spn} FMI ${fmi}` });
        }
        // OBD2 format: obd2_dtc_N
        const obd2Code = pt.payload[`obd2_dtc_${i}`];
        if (obd2Code) dtcEvents.push({ timestamp: pt.timeCaptured.toISOString(), code: String(obd2Code) });
      }
    }
    prevDtcCount = dtcCount;
  }

  // Fuel consumption (start vs end level)
  const fuelStart = fuelLevels[0];
  const fuelEnd = fuelLevels[fuelLevels.length - 1];

  // Time-series for charts (downsampled)
  const sampled = downsample(points, MAX_POINTS);
  const timeSeries = sampled.map(pt => ({
    t: pt.timeCaptured.toISOString(),
    rpm: num(pt.payload.engine_rpm),
    coolant_f: num(pt.payload.coolant_temp_f),
    speed_mph: num(pt.payload.vehicle_speed_mph),
    battery_v: num(pt.payload.battery_voltage_v),
    fuel_pct: num(pt.payload.fuel_level_pct),
    oil_psi: num(pt.payload.oil_pressure_psi),
    oil_f: num(pt.payload.oil_temp_f),
    boost_psi: num(pt.payload.boost_pressure_psi),
    fuel_rate: num(pt.payload.fuel_rate_gph),
    load_pct: num(pt.payload.engine_load_pct),
    intake_f: num(pt.payload.intake_manifold_temp_f || pt.payload.intake_air_temp_f),
    dpf_soot: num(pt.payload.dpf_soot_load_pct),
    def_pct: num(pt.payload.def_level_pct),
    // GPS
    lat: num(pt.payload.gps_latitude),
    lon: num(pt.payload.gps_longitude),
    // OBD2 fallback
    throttle_pct: num(pt.payload.throttle_position_pct || pt.payload.accel_pedal_pos_pct),
    short_trim: num(pt.payload.short_fuel_trim_b1_pct),
    long_trim: num(pt.payload.long_fuel_trim_b1_pct),
    dtc_count: num(pt.payload.active_dtc_count),
  }));

  return {
    totalPoints: points.length,
    hours,
    periodStart: first.timeCaptured.toISOString(),
    periodEnd: last.timeCaptured.toISOString(),
    totalMinutes: Math.round(totalMinutes),
    summary: {
      engine_rpm: { avg: Math.round(avg(rpms)), max: Math.round(max(rpms)), min: Math.round(min(rpms)) },
      coolant_temp_f: { avg: Math.round(avg(coolants) * 10) / 10, max: Math.round(max(coolants) * 10) / 10, min: Math.round(min(coolants) * 10) / 10 },
      vehicle_speed_mph: { avg: Math.round(avg(speeds) * 10) / 10, max: Math.round(max(speeds) * 10) / 10 },
      battery_voltage_v: { avg: Math.round(avg(batteries) * 100) / 100, min: Math.round(min(batteries) * 100) / 100, max: Math.round(max(batteries) * 100) / 100 },
      fuel_level_pct: { start: Math.round(fuelStart * 10) / 10, end: Math.round(fuelEnd * 10) / 10, consumed: Math.round((fuelStart - fuelEnd) * 10) / 10 },
      // J1939 specific
      oil_pressure_psi: { avg: Math.round(avg(oilPressures) * 10) / 10, min: Math.round(min(oilPressures) * 10) / 10, max: Math.round(max(oilPressures) * 10) / 10 },
      boost_pressure_psi: { avg: Math.round(avg(boostPressures) * 10) / 10, max: Math.round(max(boostPressures) * 10) / 10 },
      fuel_rate_gph: { avg: Math.round(avg(fuelRates) * 100) / 100, max: Math.round(max(fuelRates) * 100) / 100 },
      engine_load_pct: { avg: Math.round(avg(loads) * 10) / 10, max: Math.round(max(loads) * 10) / 10 },
      oil_temp_f: { avg: Math.round(avg(oilTemps) * 10) / 10, max: Math.round(max(oilTemps) * 10) / 10 },
      intake_temp_f: { avg: Math.round(avg(intakeTemps) * 10) / 10, max: Math.round(max(intakeTemps) * 10) / 10 },
      dpf_soot_load_pct: { avg: Math.round(avg(dpfSoot) * 10) / 10, max: Math.round(max(dpfSoot) * 10) / 10 },
      def_level_pct: { avg: Math.round(avg(defLevels) * 10) / 10, min: Math.round(min(defLevels) * 10) / 10 },
      // OBD2 specific (only populated for passenger vehicles)
      throttle_pct: { avg: Math.round(avg(throttles) * 10) / 10, max: Math.round(max(throttles) * 10) / 10 },
      short_fuel_trim_b1_pct: { avg: Math.round(avg(shortTrims) * 100) / 100, min: Math.round(min(shortTrims) * 100) / 100, max: Math.round(max(shortTrims) * 100) / 100 },
      long_fuel_trim_b1_pct: { avg: Math.round(avg(longTrims) * 100) / 100, min: Math.round(min(longTrims) * 100) / 100, max: Math.round(max(longTrims) * 100) / 100 },
    },
    dtcEvents,
    timeSeries,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const hours = Math.min(Math.max(parseFloat(params.get("hours") || "4") || 4, 0.1), 168);

  try {
    const points = await fetchTruckData(hours);
    const result = buildTruckSummary(points, hours);
    return NextResponse.json(result);
  } catch (err) {
    _viamClient = null;
    return NextResponse.json(
      { error: "truck_history_query_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
