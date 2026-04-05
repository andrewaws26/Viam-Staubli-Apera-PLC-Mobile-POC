/**
 * Fallback: query truck historical data directly from the Pi's offline JSONL buffer.
 * Used when Viam Cloud data isn't available (sync delays, connectivity issues).
 *
 * GET /api/truck-history-local?minutes=60
 */

import { NextRequest, NextResponse } from "next/server";

const PI_HOST = "100.113.196.68";
const PI_USER = "andrew";
const PI_PASS = "1111";
const BUFFER_PATH = "/home/andrew/.viam/offline-buffer/truck";

async function fetchFromPi(minutes: number) {
  // Use SSH to read recent lines from the JSONL buffer
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filePath = `${BUFFER_PATH}/readings_${dateStr}.jsonl`;

  // Read last N minutes of data (each line is ~1 second apart)
  const linesToRead = Math.min(minutes * 60, 10000);

  try {
    const { stdout } = await execAsync(
      `sshpass -p '${PI_PASS}' ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no ${PI_USER}@${PI_HOST} "sudo tail -${linesToRead} ${filePath} 2>/dev/null"`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 20000 },
    );

    const lines = stdout.trim().split("\n").filter(Boolean);
    const points: Record<string, unknown>[] = [];
    for (const line of lines) {
      try { points.push(JSON.parse(line)); } catch { /* skip bad lines */ }
    }
    return points;
  } catch (err) {
    console.error("[API-ERROR] /api/truck-history-local SSH fetch failed:", err);
    return [];
  }
}

function num(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  return 0;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const minutes = Math.min(Math.max(parseInt(params.get("minutes") || "60") || 60, 1), 600);

  const points = await fetchFromPi(minutes);

  if (points.length === 0) {
    return NextResponse.json({ totalPoints: 0, source: "offline-buffer", summary: null });
  }

  const first = points[0];
  const last = points[points.length - 1];

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const max = (arr: number[]) => arr.length ? Math.max(...arr) : 0;
  const min = (arr: number[]) => arr.length ? Math.min(...arr) : 0;

  const rpms = points.map(p => num(p.engine_rpm)).filter(v => v > 0);
  const coolants = points.map(p => num(p.coolant_temp_f)).filter(v => v > 0);
  const speeds = points.map(p => num(p.vehicle_speed_mph));
  const batteries = points.map(p => num(p.battery_voltage_v)).filter(v => v > 0);
  const fuelLevels = points.map(p => num(p.fuel_level_pct)).filter(v => v > 0);
  const shortTrims = points.map(p => num(p.short_fuel_trim_b1_pct));
  const longTrims = points.map(p => num(p.long_fuel_trim_b1_pct));
  const oilTemps = points.map(p => num(p.oil_temp_f)).filter(v => v > 0);
  const intakeTemps = points.map(p => num(p.intake_air_temp_f)).filter(v => v > 0);
  const catalystTemps = points.map(p => num(p.catalyst_temp_b1s1_f)).filter(v => v > 0);

  // DTC events
  const dtcEvents: { timestamp: string; code: string }[] = [];
  let prevDtcCount = 0;
  for (const pt of points) {
    const dtcCount = num(pt.active_dtc_count);
    if (dtcCount > 0 && dtcCount !== prevDtcCount) {
      for (let i = 0; i < Math.min(dtcCount, 5); i++) {
        const code = pt[`obd2_dtc_${i}`];
        if (code) dtcEvents.push({ timestamp: String(pt.ts || ""), code: String(code) });
      }
    }
    prevDtcCount = dtcCount;
  }

  const fuelStart = fuelLevels.length > 0 ? fuelLevels[0] : 0;
  const fuelEnd = fuelLevels.length > 0 ? fuelLevels[fuelLevels.length - 1] : 0;

  const totalMinutes = points.length > 1
    ? Math.round((num(last.epoch) - num(first.epoch)) / 60)
    : 0;

  return NextResponse.json({
    totalPoints: points.length,
    source: "offline-buffer",
    totalMinutes,
    periodStart: first.ts || "",
    periodEnd: last.ts || "",
    summary: {
      engine_rpm: { avg: Math.round(avg(rpms)), max: Math.round(max(rpms)), min: Math.round(min(rpms)) },
      coolant_temp_f: { avg: Math.round(avg(coolants) * 10) / 10, max: Math.round(max(coolants) * 10) / 10, min: Math.round(min(coolants) * 10) / 10 },
      vehicle_speed_mph: { avg: Math.round(avg(speeds) * 10) / 10, max: Math.round(max(speeds) * 10) / 10 },
      battery_voltage_v: { avg: Math.round(avg(batteries) * 100) / 100, min: Math.round(min(batteries) * 100) / 100, max: Math.round(max(batteries) * 100) / 100 },
      fuel_level_pct: { start: Math.round(fuelStart * 10) / 10, end: Math.round(fuelEnd * 10) / 10, consumed: Math.round((fuelStart - fuelEnd) * 10) / 10 },
      short_fuel_trim_b1_pct: { avg: Math.round(avg(shortTrims) * 100) / 100, min: Math.round(min(shortTrims) * 100) / 100, max: Math.round(max(shortTrims) * 100) / 100 },
      long_fuel_trim_b1_pct: { avg: Math.round(avg(longTrims) * 100) / 100, min: Math.round(min(longTrims) * 100) / 100, max: Math.round(max(longTrims) * 100) / 100 },
      oil_temp_f: oilTemps.length > 0 ? { avg: Math.round(avg(oilTemps) * 10) / 10, max: Math.round(max(oilTemps) * 10) / 10 } : null,
      intake_air_temp_f: { avg: Math.round(avg(intakeTemps) * 10) / 10, max: Math.round(max(intakeTemps) * 10) / 10 },
      catalyst_temp_b1s1_f: catalystTemps.length > 0 ? { avg: Math.round(avg(catalystTemps) * 10) / 10, max: Math.round(max(catalystTemps) * 10) / 10 } : null,
    },
    dtcEvents,
  });
}
