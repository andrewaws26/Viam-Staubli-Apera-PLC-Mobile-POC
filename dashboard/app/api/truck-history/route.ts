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
import { fetchSensorData, resetDataClient } from "@/lib/viam-data";
import { getTruckById, getDefaultTruck } from "@/lib/machines";
import { requireTruckAccess } from "@/lib/auth-guard";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const hours = Math.min(Math.max(parseFloat(params.get("hours") || "4") || 4, 0.1), 168);
  const vin = params.get("vin") || undefined;
  const truckId = params.get("truck_id");

  const truckDenied = await requireTruckAccess(truckId);
  if (truckDenied) return truckDenied;

  const truck = truckId ? await getTruckById(truckId) : await getDefaultTruck();
  if (!truck) {
    return NextResponse.json(
      { error: "truck_not_found", truck_id: truckId },
      { status: 404 },
    );
  }

  try {
    // Use shared fetchSensorData for fleet trucks, fetchTruckData for default
    const points = truckId
      ? await fetchSensorData(truck.truckPartId, "truck-engine", hours)
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
    console.error("[API-ERROR]", "/api/truck-history", err);
    return NextResponse.json(
      { error: "truck_history_query_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
