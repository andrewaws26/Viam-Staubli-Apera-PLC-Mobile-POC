/**
 * API route to get Pi health data via Viam Data API.
 *
 * Uses createViamClient + dataClient.exportTabularData() over HTTPS.
 * No WebRTC, no NEXT_PUBLIC_ env vars — works on Vercel serverless and
 * through CGNAT (iPhone hotspot).
 *
 * GET /api/pi-health?host=tps|truck
 */

import { NextRequest, NextResponse } from "next/server";
import { createViamClient } from "@viamrobotics/sdk";
import { getTruckById, getDefaultTruck } from "@/lib/machines";

// ---------------------------------------------------------------------------
// Cached ViamClient for data queries (HTTPS only)
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
const TRUCK_PART_ID = process.env.TRUCK_VIAM_PART_ID || "ca039781-665c-47e3-9bc5-35f603f3baf1";
const RESOURCE_SUBTYPE = "rdk:component:sensor";
const METHOD_NAME = "Readings";
const DATA_WINDOW_SECONDS = 300; // Look back 5 minutes for latest reading

const HOST_CONFIGS: Record<string, { partId: string; component: string; hostname: string; tailscaleIp: string; defaultMemTotal: number }> = {
  tps: {
    partId: TPS_PART_ID,
    component: "plc-monitor",
    hostname: "viam-pi",
    tailscaleIp: "100.112.68.52",
    defaultMemTotal: 8192,
  },
  truck: {
    partId: TRUCK_PART_ID,
    component: "truck-engine",
    hostname: "truck-diagnostics",
    tailscaleIp: "100.113.196.68",
    defaultMemTotal: 512,
  },
};

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
  const host = request.nextUrl.searchParams.get("host") || "tps";
  const truckId = request.nextUrl.searchParams.get("truck_id");

  let config: { partId: string; component: string; hostname: string; tailscaleIp: string; defaultMemTotal: number };

  if (truckId) {
    const truck = getTruckById(truckId);
    if (!truck) {
      return NextResponse.json({ error: "truck_not_found", truck_id: truckId }, { status: 404 });
    }
    const isTruck = host === "truck";
    config = {
      partId: isTruck ? truck.truckPartId : truck.tpsPartId,
      component: isTruck ? "truck-engine" : "plc-monitor",
      hostname: isTruck ? `${truck.id}-truck` : `${truck.id}-tps`,
      tailscaleIp: "",
      defaultMemTotal: isTruck ? 512 : 8192,
    };
  } else {
    const c = HOST_CONFIGS[host];
    if (!c) {
      return NextResponse.json({ error: `Unknown host: ${host}` }, { status: 400 });
    }
    config = c;
  }

  try {
    const dc = await getDataClient();
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - DATA_WINDOW_SECONDS * 1000);

    const rows = await dc.exportTabularData(
      config.partId,
      config.component,
      RESOURCE_SUBTYPE,
      METHOD_NAME,
      startTime,
      endTime,
    );

    if (!rows || rows.length === 0) {
      // No recent data — report offline but with 200 so the card shows offline state
      return NextResponse.json({
        hostname: config.hostname,
        online: false,
        error: "No recent data from sensor",
        tailscale_ip: config.tailscaleIp,
      });
    }

    // Take the newest data point
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
    const r = (typeof raw.readings === "object" && raw.readings !== null
      ? raw.readings
      : raw) as Record<string, unknown>;

    const dataAgeSec = Math.round((endTime.getTime() - capturedAt.getTime()) / 1000);

    return NextResponse.json({
      hostname: config.hostname,
      cpu_temp_c: r.cpu_temp_c ?? null,
      cpu_usage_pct: r.cpu_usage_pct ?? null,
      memory_used_pct: r.memory_used_pct ?? null,
      memory_used_mb: r.memory_used_mb ?? null,
      memory_total_mb: r.memory_total_mb ?? config.defaultMemTotal,
      disk_used_pct: r.disk_used_pct ?? null,
      disk_free_gb: r.disk_free_gb ?? null,
      uptime_hours: r.uptime_seconds ? (r.uptime_seconds as number) / 3600 : null,
      wifi_ssid: r.wifi_ssid ?? null,
      wifi_signal_dbm: r.wifi_signal_dbm ?? null,
      tailscale_ip: config.tailscaleIp,
      tailscale_online: true,
      internet: true,
      load_1m: r.load_1m ?? null,
      load_5m: r.load_5m ?? null,
      online: true,
      _data_age_seconds: dataAgeSec,
    });
  } catch (err) {
    _viamClient = null;
    return NextResponse.json({
      hostname: config.hostname,
      online: false,
      error: err instanceof Error ? err.message : "Offline",
      tailscale_ip: config.tailscaleIp,
    }); // 200 so the card shows offline state, not an error
  }
}
