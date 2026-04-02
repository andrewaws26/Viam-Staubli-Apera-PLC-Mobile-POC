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
import type { RawPoint } from "@/lib/truck-data";
import { getDataClient, resetDataClient } from "@/lib/viam-data";
import { getTruckById, getDefaultTruck } from "@/lib/machines";

/**
 * Fetch truck data for a specific part ID via the shared Viam Data client.
 * Used when truck_id targets a non-default truck (truck-data.ts is left as-is).
 */
async function fetchTruckDataForPartId(partId: string, hours: number): Promise<RawPoint[]> {
  const dc = await getDataClient();
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - hours * 3600000);

  const rows = await dc.exportTabularData(
    partId, "truck-engine", "rdk:component:sensor", "Readings", startTime, endTime,
  );

  const points: RawPoint[] = rows.map((row) => {
    const raw = (typeof row.payload === "object" && row.payload !== null ? row.payload : {}) as Record<string, unknown>;
    const readings = (typeof raw.readings === "object" && raw.readings !== null ? raw.readings : raw) as Record<string, unknown>;
    return {
      timeCaptured: row.timeCaptured instanceof Date ? row.timeCaptured : new Date(String(row.timeCaptured)),
      payload: readings,
    };
  });

  points.sort((a, b) => a.timeCaptured.getTime() - b.timeCaptured.getTime());
  return points;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const hours = Math.min(Math.max(parseFloat(params.get("hours") || "4") || 4, 0.1), 168);
  const vin = params.get("vin") || undefined;
  const truckId = params.get("truck_id");

  const truck = truckId ? getTruckById(truckId) : getDefaultTruck();
  if (!truck) {
    return NextResponse.json(
      { error: "truck_not_found", truck_id: truckId },
      { status: 404 },
    );
  }

  try {
    // Use existing fetchTruckData for default truck (backward compat),
    // inline fetch for fleet trucks (truck-data.ts is not modified)
    const points = truckId
      ? await fetchTruckDataForPartId(truck.truckPartId, hours)
      : await fetchTruckData(hours);

    // Collect distinct VINs before filtering (for the vehicle selector)
    const distinctVins = [...new Set(
      points
        .map((p) => String(p.payload.vehicle_vin || ""))
        .filter((v) => v && v !== "UNKNOWN" && v !== "0" && v !== "undefined")
    )];

    // Filter by VIN if requested (backwards compatible — no vin param returns all)
    const filtered = vin
      ? points.filter((p) => p.payload.vehicle_vin === vin)
      : points;

    const result = buildTruckSummary(filtered, hours);
    return NextResponse.json({ ...result, distinctVins });
  } catch (err) {
    resetTruckDataClient();
    resetDataClient();
    return NextResponse.json(
      { error: "truck_history_query_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
