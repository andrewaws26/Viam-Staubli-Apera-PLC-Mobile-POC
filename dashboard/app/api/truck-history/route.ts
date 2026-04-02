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
import { fetchTruckData, buildTruckSummary, resetTruckDataClient } from "@/lib/truck-data";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const hours = Math.min(Math.max(parseFloat(params.get("hours") || "4") || 4, 0.1), 168);

  try {
    const points = await fetchTruckData(hours);
    const result = buildTruckSummary(points, hours);
    return NextResponse.json(result);
  } catch (err) {
    resetTruckDataClient();
    return NextResponse.json(
      { error: "truck_history_query_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
