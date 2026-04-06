/**
 * Server-side API route for live truck diagnostic readings via Viam Data API.
 *
 * Queries the most recent captured sensor reading from the truck-diagnostic
 * machine using the shared Viam Data client (lib/viam-data.ts) over HTTPS.
 *
 * GET /api/truck-readings?component=truck-engine
 */

import { NextRequest, NextResponse } from "next/server";
import { getLatestReading, resetDataClient } from "@/lib/viam-data";
import { getTruckById, getDefaultTruck } from "@/lib/machines";
import { requireTruckAccess } from "@/lib/auth-guard";

export async function GET(request: NextRequest) {
  const componentName = request.nextUrl.searchParams.get("component");
  if (!componentName) {
    return NextResponse.json(
      { error: "Missing 'component' query parameter" },
      { status: 400 },
    );
  }

  const truckId = request.nextUrl.searchParams.get("truck_id");

  const truckDenied = await requireTruckAccess(truckId);
  if (truckDenied) return truckDenied;

  const truck = truckId ? getTruckById(truckId) : getDefaultTruck();
  if (!truck) {
    return NextResponse.json(
      { error: "truck_not_found", truck_id: truckId },
      { status: 404 },
    );
  }

  try {
    const result = await getLatestReading(truck.truckPartId, componentName);

    if (!result) {
      return NextResponse.json({
        _offline: true,
        _reason: "no_recent_data",
      });
    }

    const dataAgeSec = Math.round((Date.now() - result.timeCaptured.getTime()) / 1000);

    return NextResponse.json({
      ...result.payload,
      _data_age_seconds: dataAgeSec,
    });
  } catch (err) {
    resetDataClient();
    console.error("[API-ERROR]", "/api/truck-readings", err);
    return NextResponse.json(
      { error: "sensor_read_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
