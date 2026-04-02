/**
 * Server-side API route for truck J1939 CAN bus sensor readings.
 *
 * Uses the Viam Data API (no WebRTC) to fetch the most recent sensor reading.
 * This avoids WebRTC peer-to-peer connections that fail through carrier-grade
 * NAT (e.g. iPhone tethering). Data may be up to ~6 seconds old (sync interval).
 *
 * GET /api/truck-readings?component=truck-engine
 */

import { NextRequest, NextResponse } from "next/server";
import { getLatestReading, resetDataClient } from "@/lib/viam-data";

const DEFAULT_TRUCK_PART_ID = "";

export async function GET(request: NextRequest) {
  const componentName = request.nextUrl.searchParams.get("component");
  if (!componentName) {
    return NextResponse.json(
      { error: "Missing 'component' query parameter" },
      { status: 400 }
    );
  }

  const partId = process.env.TRUCK_VIAM_PART_ID || DEFAULT_TRUCK_PART_ID;
  if (!partId) {
    return NextResponse.json(
      { error: "missing_config", message: "TRUCK_VIAM_PART_ID not configured" },
      { status: 500 }
    );
  }

  try {
    const reading = await getLatestReading(partId, componentName);

    if (!reading) {
      // Return 200 with _bus_connected=false so TruckPanel shows offline gracefully
      return NextResponse.json({ _bus_connected: false, _offline: true, _message: "No sensor data in last 5 minutes" });
    }

    return NextResponse.json(reading.payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (
      /not found/i.test(msg) ||
      /no resource/i.test(msg) ||
      /does not exist/i.test(msg)
    ) {
      return NextResponse.json(
        { error: "component_not_found", component: componentName },
        { status: 404 }
      );
    }

    resetDataClient();
    return NextResponse.json(
      { error: "sensor_read_failed", message: msg },
      { status: 502 }
    );
  }
}
