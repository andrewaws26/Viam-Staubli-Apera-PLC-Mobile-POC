/**
 * Server-side API route that proxies Viam sensor readings.
 *
 * Uses the Viam Data API (no WebRTC) to fetch the most recent sensor reading.
 * This avoids WebRTC peer-to-peer connections that fail through carrier-grade
 * NAT (e.g. iPhone tethering). Data may be up to ~6 seconds old (sync interval).
 *
 * Credentials (VIAM_API_KEY, VIAM_API_KEY_ID) are loaded from server-only
 * env vars — they are NEVER sent to the browser.
 *
 * GET /api/sensor-readings?component=plc-monitor
 */

import { NextRequest, NextResponse } from "next/server";
import { getLatestReading, resetDataClient } from "@/lib/viam-data";

const DEFAULT_PART_ID = "7c24d42f-1d66-4cae-81a4-97e3ff9404b4";

export async function GET(request: NextRequest) {
  const componentName = request.nextUrl.searchParams.get("component");
  if (!componentName) {
    return NextResponse.json(
      { error: "Missing 'component' query parameter" },
      { status: 400 }
    );
  }

  try {
    const partId = process.env.VIAM_PART_ID || DEFAULT_PART_ID;
    const reading = await getLatestReading(partId, componentName);

    if (!reading) {
      // Return 200 with connected=false so the dashboard shows offline gracefully
      // instead of a 404 that triggers console errors on every poll
      return NextResponse.json({ connected: false, _offline: true, _message: "No sensor data in last 5 minutes" });
    }

    return NextResponse.json(reading.payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Component not found on the machine
    if (
      /not found/i.test(msg) ||
      /no resource/i.test(msg) ||
      /unknown/i.test(msg) ||
      /does not exist/i.test(msg) ||
      /no component/i.test(msg) ||
      /unimplemented/i.test(msg)
    ) {
      return NextResponse.json(
        { error: "component_not_found", component: componentName },
        { status: 404 }
      );
    }

    // Connection error — reset client so next request retries
    resetDataClient();
    return NextResponse.json(
      { error: "sensor_read_failed", message: msg },
      { status: 502 }
    );
  }
}
