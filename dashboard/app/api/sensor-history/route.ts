/**
 * Server-side API route for historical sensor data via Viam Data API.
 *
 * Uses the shared Viam Data client (lib/viam-data.ts) to query historical
 * readings captured by the plc-monitor sensor component.
 *
 * GET /api/sensor-history?type=recent&hours=1
 * GET /api/sensor-history?type=summary&hours=8
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchSensorData, resetDataClient, type RawPoint } from "@/lib/viam-data";
import { getTruckById, getDefaultTruck } from "@/lib/machines";

const MAX_POINTS = 500;

// ---------------------------------------------------------------------------
// Types for the response payloads
// ---------------------------------------------------------------------------

interface RecentDataPoint {
  timestamp: string;
  encoder_distance_ft?: number;
  encoder_speed_ftpm?: number;
  plates_per_minute?: number;
  plate_drop_count?: number;
  tps_power_loop?: boolean;
  camera_positive?: boolean;
  backup_alarm?: boolean;
  drop_detector_eject?: boolean;
  drop_encoder_eject?: boolean;
  [key: string]: unknown;
}

interface ShiftSummary {
  periodStart: string;
  periodEnd: string;
  totalHours: number;
  totalPoints: number;
  totalDistance_ft: number;
  totalPlatesDropped: number;
  avgSpeed_ftpm: number;
  maxSpeed_ftpm: number;
  avgPlateRate: number;
  maxPlateRate: number;
  tpsPowerOnMinutes: number;
  tpsPowerOffMinutes: number;
  tpsPowerOnPct: number;
  detectorEjectCount: number;
  encoderEjectCount: number;
  cameraActiveMinutes: number;
  cameraActivePct: number;
  backupAlarmMinutes: number;
  backupAlarmTriggered: boolean;
  events: HistoryEvent[];
}

interface HistoryEvent {
  timestamp: string;
  type: "power_on" | "power_off" | "backup_alarm_start" | "backup_alarm_end" | "camera_lost" | "camera_restored";
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function bool(val: unknown): boolean {
  if (typeof val === "boolean") return val;
  if (val === 1 || val === "true") return true;
  return false;
}

function downsample<T>(data: T[], maxN: number): T[] {
  if (data.length <= maxN) return data;
  const step = data.length / maxN;
  const result: T[] = [];
  for (let i = 0; i < maxN; i++) {
    result.push(data[Math.floor(i * step)]);
  }
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Query handlers
// ---------------------------------------------------------------------------

function buildRecentResponse(points: RawPoint[]): RecentDataPoint[] {
  const sampled = downsample(points, MAX_POINTS);

  return sampled.map((pt) => {
    const p = pt.payload;
    return {
      timestamp: pt.timeCaptured.toISOString(),
      encoder_distance_ft: num(p.encoder_distance_ft),
      encoder_speed_ftpm: num(p.encoder_speed_ftpm),
      plates_per_minute: num(p.plates_per_minute),
      plate_drop_count: num(p.plate_drop_count),
      tps_power_loop: bool(p.tps_power_loop),
      camera_positive: bool(p.camera_positive),
      backup_alarm: bool(p.backup_alarm),
      drop_detector_eject: bool(p.drop_detector_eject),
      drop_encoder_eject: bool(p.drop_encoder_eject),
    };
  });
}

function buildSummaryResponse(points: RawPoint[], hours: number): ShiftSummary {
  if (points.length === 0) {
    const now = new Date();
    return {
      periodStart: new Date(now.getTime() - hours * 3600000).toISOString(),
      periodEnd: now.toISOString(),
      totalHours: hours,
      totalPoints: 0,
      totalDistance_ft: 0,
      totalPlatesDropped: 0,
      avgSpeed_ftpm: 0,
      maxSpeed_ftpm: 0,
      avgPlateRate: 0,
      maxPlateRate: 0,
      tpsPowerOnMinutes: 0,
      tpsPowerOffMinutes: hours * 60,
      tpsPowerOnPct: 0,
      detectorEjectCount: 0,
      encoderEjectCount: 0,
      cameraActiveMinutes: 0,
      cameraActivePct: 0,
      backupAlarmMinutes: 0,
      backupAlarmTriggered: false,
      events: [],
    };
  }

  const first = points[0];
  const last = points[points.length - 1];
  const periodStart = first.timeCaptured.toISOString();
  const periodEnd = last.timeCaptured.toISOString();
  const totalSpanMs = last.timeCaptured.getTime() - first.timeCaptured.getTime();
  const totalMinutes = totalSpanMs / 60000;

  const distances = points.map((p) => num(p.payload.encoder_distance_ft));
  const totalDistance_ft = Math.max(0, Math.max(...distances) - Math.min(...distances));

  const plateCounts = points.map((p) => num(p.payload.plate_drop_count));
  const totalPlatesDropped = Math.max(0, Math.max(...plateCounts) - Math.min(...plateCounts));

  const speeds = points.map((p) => num(p.payload.encoder_speed_ftpm));
  const nonZeroSpeeds = speeds.filter((s) => s > 0);
  const avgSpeed_ftpm = nonZeroSpeeds.length > 0
    ? nonZeroSpeeds.reduce((a, b) => a + b, 0) / nonZeroSpeeds.length
    : 0;
  const maxSpeed_ftpm = Math.max(0, ...speeds);

  const rates = points.map((p) => num(p.payload.plates_per_minute));
  const nonZeroRates = rates.filter((r) => r > 0);
  const avgPlateRate = nonZeroRates.length > 0
    ? nonZeroRates.reduce((a, b) => a + b, 0) / nonZeroRates.length
    : 0;
  const maxPlateRate = Math.max(0, ...rates);

  let tpsPowerOnCount = 0;
  let cameraActiveCount = 0;
  let backupAlarmCount = 0;
  let detectorEjectTransitions = 0;
  let encoderEjectTransitions = 0;

  const events: HistoryEvent[] = [];
  let prevPower: boolean | null = null;
  let prevAlarm: boolean | null = null;
  let prevCamera: boolean | null = null;
  let prevDetEject = false;
  let prevEncEject = false;

  for (const pt of points) {
    const p = pt.payload;
    const power = bool(p.tps_power_loop);
    const camera = bool(p.camera_positive);
    const alarm = bool(p.backup_alarm);
    const detEject = bool(p.drop_detector_eject);
    const encEject = bool(p.drop_encoder_eject);

    if (power) tpsPowerOnCount++;
    if (camera) cameraActiveCount++;
    if (alarm) backupAlarmCount++;

    if (detEject && !prevDetEject) detectorEjectTransitions++;
    if (encEject && !prevEncEject) encoderEjectTransitions++;
    prevDetEject = detEject;
    prevEncEject = encEject;

    const ts = pt.timeCaptured.toISOString();

    if (prevPower !== null && power !== prevPower) {
      events.push({
        timestamp: ts,
        type: power ? "power_on" : "power_off",
        message: power ? "TPS Power ON" : "TPS Power OFF",
      });
    }

    if (prevAlarm !== null && alarm !== prevAlarm) {
      events.push({
        timestamp: ts,
        type: alarm ? "backup_alarm_start" : "backup_alarm_end",
        message: alarm ? "Backup Alarm triggered" : "Backup Alarm cleared",
      });
    }

    if (prevCamera !== null && camera !== prevCamera) {
      events.push({
        timestamp: ts,
        type: camera ? "camera_restored" : "camera_lost",
        message: camera ? "Camera detection restored" : "Camera stopped detecting",
      });
    }

    prevPower = power;
    prevAlarm = alarm;
    prevCamera = camera;
  }

  const tpsPowerOnMinutes = totalMinutes > 0
    ? (tpsPowerOnCount / points.length) * totalMinutes
    : 0;
  const cameraActiveMinutes = totalMinutes > 0
    ? (cameraActiveCount / points.length) * totalMinutes
    : 0;
  const backupAlarmMinutes = totalMinutes > 0
    ? (backupAlarmCount / points.length) * totalMinutes
    : 0;

  const trimmedEvents = events.slice(-50);

  return {
    periodStart,
    periodEnd,
    totalHours: hours,
    totalPoints: points.length,
    totalDistance_ft: Math.round(totalDistance_ft * 10) / 10,
    totalPlatesDropped,
    avgSpeed_ftpm: Math.round(avgSpeed_ftpm * 10) / 10,
    maxSpeed_ftpm: Math.round(maxSpeed_ftpm * 10) / 10,
    avgPlateRate: Math.round(avgPlateRate * 10) / 10,
    maxPlateRate: Math.round(maxPlateRate * 10) / 10,
    tpsPowerOnMinutes: Math.round(tpsPowerOnMinutes),
    tpsPowerOffMinutes: Math.round(totalMinutes - tpsPowerOnMinutes),
    tpsPowerOnPct: totalMinutes > 0
      ? Math.round((tpsPowerOnMinutes / totalMinutes) * 1000) / 10
      : 0,
    detectorEjectCount: detectorEjectTransitions,
    encoderEjectCount: encoderEjectTransitions,
    cameraActiveMinutes: Math.round(cameraActiveMinutes),
    cameraActivePct: totalMinutes > 0
      ? Math.round((cameraActiveMinutes / totalMinutes) * 1000) / 10
      : 0,
    backupAlarmMinutes: Math.round(backupAlarmMinutes),
    backupAlarmTriggered: backupAlarmCount > 0,
    events: trimmedEvents,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const type = params.get("type") || "summary";
  const hours = Math.min(Math.max(parseFloat(params.get("hours") || "8") || 8, 0.1), 168);

  const truckId = params.get("truck_id");
  const truck = truckId ? getTruckById(truckId) : getDefaultTruck();
  if (!truck) {
    return NextResponse.json(
      { error: "truck_not_found", truck_id: truckId },
      { status: 404 },
    );
  }

  try {
    const points = await fetchSensorData(truck.tpsPartId, "plc-monitor", hours);

    if (type === "recent") {
      const data = buildRecentResponse(points);
      return NextResponse.json({
        type: "recent",
        hours,
        count: data.length,
        data,
      });
    }

    const summary = buildSummaryResponse(points, hours);
    return NextResponse.json({
      type: "summary",
      ...summary,
    });
  } catch (err) {
    resetDataClient();
    console.error("[API-ERROR]", "/api/sensor-history", err);
    return NextResponse.json(
      {
        error: "data_query_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
