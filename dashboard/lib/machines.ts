/**
 * Fleet machine registry — maps truck IDs to Viam part IDs and machine addresses.
 *
 * Single-Pi architecture: each truck has one Pi 5 running all modules
 * (plc-sensor, cell-sensor, j1939-sensor). One Part ID per truck.
 *
 * Loading priority:
 *   1. Supabase `fleet_trucks` table (production, managed via Admin UI)
 *   2. config/fleet.json (fallback, version-controlled)
 *   3. FLEET_TRUCKS env var (Vercel overrides)
 *   4. Single-truck fallback from individual env vars (backward compat)
 *
 * To add a new truck: use the Admin page Fleet Manager UI, or insert into
 * the fleet_trucks Supabase table. The dashboard reads from the DB on each
 * request (with a 30-second cache).
 */

import fs from "fs";
import path from "path";

export interface TruckConfig {
  id: string;
  name: string;
  tpsPartId: string;
  /** @deprecated Use tpsPartId — all components now run on one machine */
  truckPartId: string;
  tpsMachineAddress?: string;
  /** @deprecated Use tpsMachineAddress — all components now run on one machine */
  truckMachineAddress?: string;
}

// ---------------------------------------------------------------------------
// Supabase loader (primary source)
// ---------------------------------------------------------------------------

let _supabaseCache: TruckConfig[] | null = null;
let _supabaseCacheTime = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

async function loadFromSupabase(): Promise<TruckConfig[] | null> {
  // Return cached if fresh
  if (_supabaseCache && Date.now() - _supabaseCacheTime < CACHE_TTL_MS) {
    return _supabaseCache;
  }

  try {
    // Dynamic import to avoid circular deps and to keep working if Supabase isn't configured
    const { getSupabase } = await import("@/lib/supabase");
    const sb = getSupabase();

    const { data, error } = await sb
      .from("fleet_trucks")
      .select("id, name, viam_part_id, viam_machine_address, status, has_tps, has_cell, has_j1939")
      .in("status", ["active", "inactive", "maintenance"])
      .order("id", { ascending: true });

    if (error || !data || data.length === 0) return null;

    const partId = process.env.VIAM_PART_ID || "";
    const machineAddr = process.env.VIAM_MACHINE_ADDRESS || "";

    const trucks: TruckConfig[] = data.map((row) => ({
      id: row.id,
      name: row.name,
      // Use DB part ID if set, otherwise fall back to env var for backward compat
      tpsPartId: row.viam_part_id || (row.id === "01" ? partId : ""),
      truckPartId: row.viam_part_id || (row.id === "01" ? partId : ""),
      tpsMachineAddress: row.viam_machine_address || (row.id === "01" ? machineAddr : ""),
      truckMachineAddress: row.viam_machine_address || (row.id === "01" ? machineAddr : ""),
    }));

    _supabaseCache = trucks;
    _supabaseCacheTime = Date.now();
    console.log(`[machines] Loaded ${trucks.length} truck(s) from Supabase fleet_trucks`);
    return trucks;
  } catch {
    // Supabase not configured or table doesn't exist — fall through
    return null;
  }
}

// ---------------------------------------------------------------------------
// Static fallbacks (unchanged from before)
// ---------------------------------------------------------------------------

interface FleetFile {
  trucks: TruckConfig[];
}

function loadFleetFile(): TruckConfig[] | null {
  const candidates = [
    path.resolve(process.cwd(), "..", "config", "fleet.json"),
    path.resolve(process.cwd(), "config", "fleet.json"),
  ];

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf-8");
      const data: FleetFile = JSON.parse(raw);
      if (Array.isArray(data.trucks) && data.trucks.length > 0) {
        const partId = process.env.VIAM_PART_ID || "";
        const machineAddr = process.env.VIAM_MACHINE_ADDRESS || "";
        const trucks = data.trucks.map((t) => ({
          ...t,
          tpsPartId: t.tpsPartId || partId,
          truckPartId: t.truckPartId || t.tpsPartId || partId,
          tpsMachineAddress: t.tpsMachineAddress || machineAddr,
          truckMachineAddress: t.truckMachineAddress || t.tpsMachineAddress || machineAddr,
        }));
        console.log(`[machines] Loaded ${trucks.length} truck(s) from ${filePath}`);
        return trucks;
      }
    } catch {
      // fall through
    }
  }
  return null;
}

function loadFleetEnvVar(): TruckConfig[] | null {
  const fleetJson = process.env.FLEET_TRUCKS;
  if (!fleetJson) return null;
  try {
    const parsed = JSON.parse(fleetJson);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const trucks = (parsed as TruckConfig[]).map((t) => ({
        ...t,
        truckPartId: t.truckPartId || t.tpsPartId || "",
        truckMachineAddress: t.truckMachineAddress || t.tpsMachineAddress || "",
      }));
      console.log(`[machines] Loaded ${trucks.length} truck(s) from FLEET_TRUCKS env var`);
      return trucks;
    }
  } catch (e) {
    console.error("[machines] Failed to parse FLEET_TRUCKS env var:", e);
  }
  return null;
}

function loadSingleTruckFallback(): TruckConfig[] {
  const partId = process.env.VIAM_PART_ID || "";
  const machineAddr = process.env.VIAM_MACHINE_ADDRESS || "";
  console.log("[machines] Using single-truck fallback from env vars");
  return [
    {
      id: "00",
      name: "Demo Truck",
      tpsPartId: "",
      truckPartId: "",
      tpsMachineAddress: "",
      truckMachineAddress: "",
    },
    {
      id: "01",
      name: "Truck 01",
      tpsPartId: partId,
      truckPartId: process.env.TRUCK_VIAM_PART_ID || partId,
      tpsMachineAddress: machineAddr,
      truckMachineAddress: process.env.TRUCK_VIAM_MACHINE_ADDRESS || machineAddr,
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API (async — reads from Supabase first, then static fallbacks)
// ---------------------------------------------------------------------------

export async function getTruckConfigs(): Promise<TruckConfig[]> {
  const fromDb = await loadFromSupabase();
  if (fromDb) return fromDb;
  return loadFleetFile() ?? loadFleetEnvVar() ?? loadSingleTruckFallback();
}

export async function getTruckById(id: string): Promise<TruckConfig | null> {
  const configs = await getTruckConfigs();
  return configs.find((t) => t.id === id) || null;
}

export async function getDefaultTruck(): Promise<TruckConfig> {
  const configs = await getTruckConfigs();
  // Prefer the first truck with a valid Part ID (skip Demo/placeholder trucks)
  return configs.find((t) => !!t.tpsPartId) || configs[0];
}

export async function listTrucks(): Promise<{
  id: string;
  name: string;
  hasTPSMonitor: boolean;
  hasTruckDiagnostics: boolean;
}[]> {
  const configs = await getTruckConfigs();
  return configs.map((t) => ({
    id: t.id,
    name: t.name,
    hasTPSMonitor: !!t.tpsPartId,
    hasTruckDiagnostics: !!t.tpsPartId,
  }));
}

/**
 * Invalidate the Supabase cache (e.g. after adding/editing a truck).
 */
export function reloadFleetConfig(): void {
  _supabaseCache = null;
  _supabaseCacheTime = 0;
}
