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
import { getLatestReading, resetDataClient } from "@/lib/viam-data";
import { getTruckConfigs, type TruckConfig } from "@/lib/machines";

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
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Build status for a single truck
// ---------------------------------------------------------------------------

async function fetchTruckStatus(truck: TruckConfig): Promise<TruckStatus> {
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
      const tps = await getLatestReading(truck.tpsPartId, "plc-monitor");
      if (tps) {
        status.tpsOnline = true;
        const t = tps.timeCaptured.getTime();
        if (!latestTimestamp || t > latestTimestamp) latestTimestamp = t;

        status.plateCount = num(tps.payload.plate_drop_count);
        status.platesPerMin = num(tps.payload.plates_per_minute);
        status.speedFtpm = num(tps.payload.encoder_speed_ftpm);
        status.tpsPowerOn = bool(tps.payload.tps_power_loop);
      }
    } catch (err) {
      status.error = `TPS: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Query truck engine data
  if (truck.truckPartId) {
    try {
      const eng = await getLatestReading(truck.truckPartId, "truck-engine");
      if (eng) {
        status.truckOnline = true;
        const t = eng.timeCaptured.getTime();
        if (!latestTimestamp || t > latestTimestamp) latestTimestamp = t;

        status.engineRpm = num(eng.payload.engine_rpm);
        status.engineRunning = status.engineRpm !== null ? status.engineRpm > 0 : null;
        status.coolantTempF = num(eng.payload.coolant_temp_f);

        // Count active DTCs
        const dtcActive = eng.payload.dtc_active;
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
    const trucks = getTruckConfigs();

    const results = await Promise.allSettled(
      trucks.map((truck) => fetchTruckStatus(truck)),
    );

    const statuses: TruckStatus[] = results.map((result, i) => {
      if (result.status === "fulfilled") return result.value;
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

    _cache = { data: statuses, timestamp: Date.now() };

    return NextResponse.json({
      trucks: statuses,
      cached: false,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    resetDataClient();
    console.error("[API-ERROR]", "/api/fleet/status", err);
    return NextResponse.json(
      { error: "fleet_query_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
