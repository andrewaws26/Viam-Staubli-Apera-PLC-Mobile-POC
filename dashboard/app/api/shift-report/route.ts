/**
 * Shift Report API — aggregates TPS plate data + truck engine data for a
 * date/shift into a one-page summary a foreman can read in 10 seconds.
 *
 * New (custom time range):
 *   GET /api/shift-report?date=2026-04-01&startHour=6&startMin=0&endHour=18&endMin=0
 *
 * Legacy (still supported):
 *   GET /api/shift-report?date=2026-04-01&shift=day
 *   GET /api/shift-report?date=2026-04-01&shift=night
 *   GET /api/shift-report?date=2026-04-01&shift=full
 *
 * Optional: &debug=1  (includes _debug object)
 *
 * All times are interpreted in America/New_York (Louisville, KY).
 */

import { NextRequest, NextResponse } from "next/server";
import { createViamClient } from "@viamrobotics/sdk";

import type { CachedViamClient, TabularDataPoint } from "./types";
import { parseRows, timeBounds, shiftToHours, buildShiftReport } from "./aggregation";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TPS_PART_ID = process.env.VIAM_PART_ID || "7c24d42f-1d66-4cae-81a4-97e3ff9404b4";
const TRUCK_PART_ID = process.env.TRUCK_VIAM_PART_ID || "ca039781-665c-47e3-9bc5-35f603f3baf1";
const RESOURCE_SUBTYPE = "rdk:component:sensor";
const METHOD_NAME = "Readings";
const TZ = "America/New_York"; // Louisville, KY

// ---------------------------------------------------------------------------
// Viam Data API client (cached, same pattern as sensor-history/truck-history)
// ---------------------------------------------------------------------------

let _viamClient: CachedViamClient | null = null;
let _connecting = false;

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
// Request validation helpers
// ---------------------------------------------------------------------------

function parseDateParam(params: URLSearchParams): { dateStr: string; error?: string } {
  const dateStr = params.get("date") || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { dateStr, error: "Invalid date format. Use YYYY-MM-DD." };
  }
  return { dateStr };
}

function parseTimeRange(
  params: URLSearchParams,
  dateStr: string,
): { start: Date; end: Date; error?: string } {
  const startHourParam = params.get("startHour");
  const endHourParam = params.get("endHour");

  if (startHourParam !== null && endHourParam !== null) {
    const sh = Math.max(0, Math.min(23, parseInt(startHourParam, 10) || 0));
    const sm = Math.max(0, Math.min(59, parseInt(params.get("startMin") || "0", 10) || 0));
    const eh = Math.max(0, Math.min(23, parseInt(endHourParam, 10) || 0));
    const em = Math.max(0, Math.min(59, parseInt(params.get("endMin") || "0", 10) || 0));
    return timeBounds(dateStr, sh, sm, eh, em, TZ);
  }

  const shift = params.get("shift") || "full";
  if (!["day", "night", "full"].includes(shift)) {
    return { start: new Date(), end: new Date(), error: "Invalid shift. Use day, night, or full." };
  }
  const { sh, sm, eh, em } = shiftToHours(shift);
  return timeBounds(dateStr, sh, sm, eh, em, TZ);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const includeDebug = params.get("debug") === "1";

  // Validate date
  const { dateStr, error: dateError } = parseDateParam(params);
  if (dateError) {
    return NextResponse.json({ error: dateError }, { status: 400 });
  }

  // Determine time range
  const { start, end, error: timeError } = parseTimeRange(params, dateStr);
  if (timeError) {
    return NextResponse.json({ error: timeError }, { status: 400 });
  }

  const startTime_timer = Date.now();

  try {
    const dc = await getDataClient();

    // Fetch TPS + truck data in parallel
    const [tpsRows, truckRows] = await Promise.all([
      dc.exportTabularData(TPS_PART_ID, "plc-monitor", RESOURCE_SUBTYPE, METHOD_NAME, start, end)
        .catch(() => [] as TabularDataPoint[]),
      dc.exportTabularData(TRUCK_PART_ID, "truck-engine", RESOURCE_SUBTYPE, METHOD_NAME, start, end)
        .catch(() => [] as TabularDataPoint[]),
    ]);

    const tpsPoints = parseRows(tpsRows);
    const truckPoints = parseRows(truckRows);

    // Build the report via aggregation utilities
    const report = buildShiftReport(tpsPoints, truckPoints, dateStr, start, end, includeDebug, TZ);

    // Cache: historical shifts can be cached longer
    const isHistorical = end.getTime() < Date.now();
    const cacheControl = isHistorical
      ? "public, max-age=3600, s-maxage=3600"
      : "public, max-age=60, s-maxage=60";

    console.log("[API-TIMING]", "/api/shift-report", Date.now() - startTime_timer, "ms");
    return NextResponse.json(report, {
      headers: { "Cache-Control": cacheControl },
    });
  } catch (err) {
    _viamClient = null;
    console.error("[API-ERROR]", "/api/shift-report", err);
    return NextResponse.json(
      { error: "shift_report_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
