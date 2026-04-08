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
import { getSupabase } from "@/lib/supabase";

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
  // Location
  locationCity: string | null;
  locationRegion: string | null;
  weather: string | null;
  // Assigned personnel
  assignedPersonnel: { name: string; role: string }[];
  // Maintenance
  maintenanceOverdue: number;
  maintenanceDueSoon: number;
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
    locationCity: null,
    locationRegion: null,
    weather: null,
    assignedPersonnel: [],
    maintenanceOverdue: 0,
    maintenanceDueSoon: 0,
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
        const city = tps.payload.location_city;
        const region = tps.payload.location_region;
        const weather = tps.payload.weather;
        if (typeof city === "string" && city) status.locationCity = city;
        if (typeof region === "string" && region) status.locationRegion = region;
        if (typeof weather === "string" && weather) status.weather = weather;
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
    const trucks = await getTruckConfigs();

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
        locationCity: null,
        locationRegion: null,
        weather: null,
        assignedPersonnel: [],
        maintenanceOverdue: 0,
        maintenanceDueSoon: 0,
        hasTPSMonitor: !!trucks[i].tpsPartId,
        hasTruckDiagnostics: !!trucks[i].truckPartId,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      } satisfies TruckStatus;
    });

    // Enrich with assigned personnel from Supabase
    try {
      const sb = getSupabase();
      const { data: assignments } = await sb
        .from("truck_assignments")
        .select("truck_id, user_name, user_role");
      if (assignments) {
        const byTruck = new Map<string, { name: string; role: string }[]>();
        for (const a of assignments) {
          const list = byTruck.get(a.truck_id) || [];
          list.push({ name: a.user_name, role: a.user_role });
          byTruck.set(a.truck_id, list);
        }
        for (const s of statuses) {
          s.assignedPersonnel = byTruck.get(s.id) || [];
        }
      }
    } catch (err) {
      console.error("[API-WARN]", "fleet/status assignments lookup failed", err);
      // Non-fatal — statuses still returned without personnel
    }

    // Enrich with maintenance due/overdue counts
    try {
      const sb = getSupabase();
      const { data: maint } = await sb
        .from("maintenance_events")
        .select("truck_id, next_due_date")
        .not("next_due_date", "is", null);
      if (maint) {
        const now = Date.now();
        const fourteenDays = 14 * 24 * 60 * 60 * 1000;
        // Group by truck, only keep the latest next_due_date per truck+event
        const overdue = new Map<string, number>();
        const dueSoon = new Map<string, number>();
        for (const m of maint) {
          const due = new Date(m.next_due_date).getTime();
          if (due < now) {
            overdue.set(m.truck_id, (overdue.get(m.truck_id) || 0) + 1);
          } else if (due - now < fourteenDays) {
            dueSoon.set(m.truck_id, (dueSoon.get(m.truck_id) || 0) + 1);
          }
        }
        for (const s of statuses) {
          s.maintenanceOverdue = overdue.get(s.id) || 0;
          s.maintenanceDueSoon = dueSoon.get(s.id) || 0;
        }
      }
    } catch (err) {
      console.error("[API-WARN]", "fleet/status maintenance lookup failed", err);
    }

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
