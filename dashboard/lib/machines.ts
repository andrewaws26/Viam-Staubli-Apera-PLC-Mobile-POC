/**
 * Fleet machine registry — maps truck IDs to Viam part IDs and machine addresses.
 *
 * Loading priority:
 *   1. config/fleet.json (version-controlled, human-editable)
 *   2. FLEET_TRUCKS env var (JSON array, for Vercel overrides)
 *   3. Single-truck fallback from individual env vars (backward compat)
 *
 * To add a new truck: edit config/fleet.json and add an entry with the
 * Part IDs from app.viam.com. The dashboard reads this at startup.
 */

import fs from "fs";
import path from "path";

export interface TruckConfig {
  id: string;
  name: string;
  tpsPartId: string;
  truckPartId: string;
  tpsMachineAddress?: string;
  truckMachineAddress?: string;
}

interface FleetFile {
  trucks: TruckConfig[];
}

/**
 * Try loading fleet.json from the repo config directory.
 * Returns null if the file doesn't exist or can't be parsed.
 */
function loadFleetFile(): TruckConfig[] | null {
  // Try multiple paths: repo root (dev) and Next.js CWD (Vercel)
  const candidates = [
    path.resolve(process.cwd(), "..", "config", "fleet.json"),  // dashboard/../config/
    path.resolve(process.cwd(), "config", "fleet.json"),         // if CWD is repo root
  ];

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf-8");
      const data: FleetFile = JSON.parse(raw);
      if (Array.isArray(data.trucks) && data.trucks.length > 0) {
        // Fill empty Part IDs from env vars (backward compat for single-truck setups)
        const trucks = data.trucks.map((t) => ({
          ...t,
          tpsPartId: t.tpsPartId || process.env.VIAM_PART_ID || "",
          truckPartId: t.truckPartId || process.env.TRUCK_VIAM_PART_ID || "",
          tpsMachineAddress: t.tpsMachineAddress || process.env.VIAM_MACHINE_ADDRESS || "",
          truckMachineAddress: t.truckMachineAddress || process.env.TRUCK_VIAM_MACHINE_ADDRESS || "",
        }));
        console.log(`[machines] Loaded ${trucks.length} truck(s) from ${filePath}`);
        return trucks;
      }
    } catch {
      // File exists but can't be parsed — fall through to next source
    }
  }
  return null;
}

/**
 * Try loading from the FLEET_TRUCKS env var (JSON array).
 * Useful for Vercel overrides without changing the repo.
 */
function loadFleetEnvVar(): TruckConfig[] | null {
  const fleetJson = process.env.FLEET_TRUCKS;
  if (!fleetJson) return null;
  try {
    const parsed = JSON.parse(fleetJson);
    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log(`[machines] Loaded ${parsed.length} truck(s) from FLEET_TRUCKS env var`);
      return parsed as TruckConfig[];
    }
  } catch (e) {
    console.error("[machines] Failed to parse FLEET_TRUCKS env var:", e);
  }
  return null;
}

/**
 * Single-truck fallback from individual env vars.
 */
function loadSingleTruckFallback(): TruckConfig[] {
  console.log("[machines] Using single-truck fallback from env vars");
  return [
    {
      id: "default",
      name: "Truck 01",
      tpsPartId: process.env.VIAM_PART_ID || "",
      truckPartId: process.env.TRUCK_VIAM_PART_ID || "",
      tpsMachineAddress: process.env.VIAM_MACHINE_ADDRESS || "",
      truckMachineAddress: process.env.TRUCK_VIAM_MACHINE_ADDRESS || "",
    },
  ];
}

function loadTruckConfigs(): TruckConfig[] {
  return loadFleetFile() ?? loadFleetEnvVar() ?? loadSingleTruckFallback();
}

let _configs: TruckConfig[] | null = null;

export function getTruckConfigs(): TruckConfig[] {
  if (!_configs) _configs = loadTruckConfigs();
  return _configs;
}

export function getTruckById(id: string): TruckConfig | null {
  return getTruckConfigs().find((t) => t.id === id) || null;
}

export function getDefaultTruck(): TruckConfig {
  return getTruckConfigs()[0];
}

export function listTrucks(): {
  id: string;
  name: string;
  hasTPSMonitor: boolean;
  hasTruckDiagnostics: boolean;
}[] {
  return getTruckConfigs().map((t) => ({
    id: t.id,
    name: t.name,
    hasTPSMonitor: !!t.tpsPartId,
    hasTruckDiagnostics: !!t.truckPartId,
  }));
}

/**
 * Reload the fleet config (e.g. after editing fleet.json).
 * Only useful in dev; Vercel serverless functions are stateless.
 */
export function reloadFleetConfig(): void {
  _configs = null;
}
