/**
 * Fleet status API — returns live status for all trucks in the registry.
 *
 * GET /api/fleet/status
 *
 * For each truck, queries Viam Data API for the latest TPS and truck-engine
 * readings. Uses Promise.allSettled so one offline truck doesn't fail the rest.
 * Results are cached for 5 seconds to avoid hammering Viam on rapid refreshes.
 */

import { NextResponse } from "next/server";
import { createViamClient } from "@viamrobotics/sdk";
import { getTruckConfigs, type TruckConfig } from "@/lib/machines";

// ---------------------------------------------------------------------------
// Viam Data Client (cached, same pattern as sensor-readings route)
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

const RESOURCE_SUBTYPE = "rdk:component:sensor";
const METHOD_NAME = "Readings";
const DATA_WINDOW_SECONDS = 300; // 5-minute lookback

async function getDataClient(): Promise<CachedViamClient["dataClient"]> {
  if (_viamClient) return _viamClient.dataClient;

  if (_connecting) {
    await new Promise((r) => setTimeout(r, 500));
    if (_viamClient) return _viamClient.dataClient;
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
// In-memory cache (5-second TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: TruckStatus[];
  timestamp: number;
}

let _cache: CacheEntry | null = null;
const CACHE_TTL_MS = 5000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TruckStatus {
  id: string;
  name: string;
  lastSeen: string | null;
  dataAgeSec: number | null;
  connected: boolean;
  // TPS fields
  tpsOnline: boolean;
  plateCount: number | null;
  platesPerMin: number | null;
  speedFtpm: number | null;
  tpsPowerOn: boolean | null;
  // Truck engine fields
  truckOnline: boolean;
  engineRpm: number | null;
  engineRunning: boolean | null;
  dtcCount: number;
  coolantTempF: number | null;
  // Capabilities
  hasTPSMonitor: boolean;
  hasTruckDiagnostics: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function unwrapReadings(payload: unknown): Record<string, unknown> {
  const raw = (typeof payload === "object" && payload !== null
    ? payload
    : {}) as Record<string, unknown>;
  const readings = (typeof raw.readings === "object" && raw.readings !== null
    ? raw.readings
    : raw) as Record<string, unknown>;
  return readings;
}

function num(val: unknown): number | null {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }
  return null;
}

function bool(val: unknown): boolean | null {
  if (typeof val === "boolean") return val;
  if (val === 1 || val === "true") return true;
  if (val === 0 || val === "false") return false;
  return null;
}

async function queryLatestReading(
  dc: CachedViamClient["dataClient"],
  partId: string,
  componentName: string,
): Promise<{ readings: Record<string, unknown>; capturedAt: Date } | null> {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - DATA_WINDOW_SECONDS * 1000);

  const rows = await dc.exportTabularData(
    partId,
    componentName,
    RESOURCE_SUBTYPE,
    METHOD_NAME,
    startTime,
    endTime,
  );

  if (!rows || rows.length === 0) return null;

  // Find the newest row
  let latest = rows[0];
  let latestTime = latest.timeCaptured instanceof Date
    ? latest.timeCaptured.getTime()
    : new Date(String(latest.timeCaptured)).getTime();

  for (let i = 1; i < rows.length; i++) {
    const t = rows[i].timeCaptured instanceof Date
      ? rows[i].timeCaptured.getTime()
      : new Date(String(rows[i].timeCaptured)).getTime();
    if (t > latestTime) {
      latest = rows[i];
      latestTime = t;
    }
  }

  return {
    readings: unwrapReadings(latest.payload),
    capturedAt: new Date(latestTime),
  };
}

// ---------------------------------------------------------------------------
// Build status for a single truck
// ---------------------------------------------------------------------------

async function fetchTruckStatus(
  dc: CachedViamClient["dataClient"],
  truck: TruckConfig,
): Promise<TruckStatus> {
  const status: TruckStatus = {
    id: truck.id,
    name: truck.name,
    lastSeen: null,
    dataAgeSec: null,
    connected: false,
    tpsOnline: false,
    plateCount: null,
    platesPerMin: null,
    speedFtpm: null,
    tpsPowerOn: null,
    truckOnline: false,
    engineRpm: null,
    engineRunning: null,
    dtcCount: 0,
    coolantTempF: null,
    hasTPSMonitor: !!truck.tpsPartId,
    hasTruckDiagnostics: !!truck.truckPartId,
    error: null,
  };

  const now = Date.now();
  let latestTimestamp: number | null = null;

  // Query TPS data
  if (truck.tpsPartId) {
    try {
      const tps = await queryLatestReading(dc, truck.tpsPartId, "plc-monitor");
      if (tps) {
        status.tpsOnline = true;
        const t = tps.capturedAt.getTime();
        if (!latestTimestamp || t > latestTimestamp) latestTimestamp = t;

        status.plateCount = num(tps.readings.plate_drop_count);
        status.platesPerMin = num(tps.readings.plates_per_minute);
        status.speedFtpm = num(tps.readings.encoder_speed_ftpm);
        status.tpsPowerOn = bool(tps.readings.tps_power_loop);
      }
    } catch (err) {
      status.error = `TPS: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Query truck engine data
  if (truck.truckPartId) {
    try {
      const eng = await queryLatestReading(dc, truck.truckPartId, "truck-engine");
      if (eng) {
        status.truckOnline = true;
        const t = eng.capturedAt.getTime();
        if (!latestTimestamp || t > latestTimestamp) latestTimestamp = t;

        status.engineRpm = num(eng.readings.engine_rpm);
        status.engineRunning = status.engineRpm !== null ? status.engineRpm > 0 : null;
        status.coolantTempF = num(eng.readings.coolant_temp_f);

        // Count active DTCs
        const dtcActive = eng.readings.dtc_active;
        if (Array.isArray(dtcActive)) {
          status.dtcCount = dtcActive.length;
        } else if (typeof dtcActive === "number") {
          status.dtcCount = dtcActive;
        }
      }
    } catch (err) {
      const existing = status.error ? status.error + "; " : "";
      status.error = existing + `Truck: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  if (latestTimestamp) {
    status.lastSeen = new Date(latestTimestamp).toISOString();
    status.dataAgeSec = Math.round((now - latestTimestamp) / 1000);
    status.connected = status.dataAgeSec < 300; // <5min = connected
  }

  return status;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET() {
  // Check cache
  if (_cache && Date.now() - _cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({
      trucks: _cache.data,
      cached: true,
      timestamp: new Date(_cache.timestamp).toISOString(),
    });
  }

  try {
    const dc = await getDataClient();
    const trucks = getTruckConfigs();

    const results = await Promise.allSettled(
      trucks.map((truck) => fetchTruckStatus(dc, truck)),
    );

    const statuses: TruckStatus[] = results.map((result, i) => {
      if (result.status === "fulfilled") return result.value;
      // If the promise itself rejected, return an error status
      return {
        id: trucks[i].id,
        name: trucks[i].name,
        lastSeen: null,
        dataAgeSec: null,
        connected: false,
        tpsOnline: false,
        plateCount: null,
        platesPerMin: null,
        speedFtpm: null,
        tpsPowerOn: null,
        truckOnline: false,
        engineRpm: null,
        engineRunning: null,
        dtcCount: 0,
        coolantTempF: null,
        hasTPSMonitor: !!trucks[i].tpsPartId,
        hasTruckDiagnostics: !!trucks[i].truckPartId,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      } satisfies TruckStatus;
    });

    // Update cache
    _cache = { data: statuses, timestamp: Date.now() };

    return NextResponse.json({
      trucks: statuses,
      cached: false,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    _viamClient = null;
    console.error("[API-ERROR]", "/api/fleet/status", err);
    return NextResponse.json(
      { error: "fleet_query_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
