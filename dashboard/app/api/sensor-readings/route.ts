/**
 * Server-side API route for live TPS sensor readings via Viam Data API.
 *
 * Uses createViamClient + dataClient.exportTabularData() over HTTPS.
 * No WebRTC — works on Vercel serverless and through CGNAT (iPhone hotspot).
 *
 * GET /api/sensor-readings?component=plc-monitor
 */

import { NextRequest, NextResponse } from "next/server";
import { createViamClient } from "@viamrobotics/sdk";

// ---------------------------------------------------------------------------
// Cached ViamClient for data queries (HTTPS only, no WebRTC)
// ---------------------------------------------------------------------------

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

const TPS_PART_ID = process.env.VIAM_PART_ID || "7c24d42f-1d66-4cae-81a4-97e3ff9404b4";
const RESOURCE_SUBTYPE = "rdk:component:sensor";
const METHOD_NAME = "Readings";
const DATA_WINDOW_SECONDS = 300; // Look back 5 minutes for latest reading

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

export async function GET(request: NextRequest) {
  const componentName = request.nextUrl.searchParams.get("component");
  if (!componentName) {
    return NextResponse.json(
      { error: "Missing 'component' query parameter" },
      { status: 400 },
    );
  }

  try {
    const dc = await getDataClient();
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - DATA_WINDOW_SECONDS * 1000);

    const rows = await dc.exportTabularData(
      TPS_PART_ID,
      componentName,
      RESOURCE_SUBTYPE,
      METHOD_NAME,
      startTime,
      endTime,
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        _offline: true,
        _reason: "no_recent_data",
      });
    }

    // Take the newest data point (last in the array after sorting)
    const sorted = rows.sort((a, b) => {
      const ta = a.timeCaptured instanceof Date ? a.timeCaptured.getTime() : new Date(String(a.timeCaptured)).getTime();
      const tb = b.timeCaptured instanceof Date ? b.timeCaptured.getTime() : new Date(String(b.timeCaptured)).getTime();
      return ta - tb;
    });

    const latest = sorted[sorted.length - 1];
    const capturedAt = latest.timeCaptured instanceof Date
      ? latest.timeCaptured
      : new Date(String(latest.timeCaptured));

    // Unwrap payload.readings (Viam Cloud nesting)
    const raw = (typeof latest.payload === "object" && latest.payload !== null
      ? latest.payload
      : {}) as Record<string, unknown>;
    const readings = (typeof raw.readings === "object" && raw.readings !== null
      ? raw.readings
      : raw) as Record<string, unknown>;

    const dataAgeSec = Math.round((endTime.getTime() - capturedAt.getTime()) / 1000);

    return NextResponse.json({
      ...readings,
      _data_age_seconds: dataAgeSec,
    });
  } catch (err) {
    _viamClient = null;
    return NextResponse.json(
      { error: "sensor_read_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
