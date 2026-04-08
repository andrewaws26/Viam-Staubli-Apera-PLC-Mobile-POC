/**
 * Fleet machine registry — maps truck IDs to Viam part IDs and machine addresses.
 *
 * Single-Pi architecture: each truck has one Pi 5 running all modules
 * (plc-sensor, cell-sensor, j1939-sensor). One Part ID per truck.
 *
 * Loading priority:
 *   1. config/fleet.json (version-controlled, human-editable)
 *   2. FLEET_TRUCKS env var (JSON array, for Vercel overrides)
 *   3. Single-truck fallback from individual env vars (backward compat)
 *
 * To add a new truck: edit config/fleet.json and add an entry with the
 * Part ID from app.viam.com. The dashboard reads this at startup.
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
        const partId = process.env.VIAM_PART_ID || "";
        const machineAddr = process.env.VIAM_MACHINE_ADDRESS || "";
        // Single-Pi: truckPartId defaults to tpsPartId (same machine)
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
      // Single-Pi: default truckPartId to tpsPartId
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

/**
 * Single-truck fallback from individual env vars.
 * Single-Pi: truckPartId defaults to tpsPartId (same machine).
 */
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
    hasTruckDiagnostics: !!t.tpsPartId, // Same machine now
  }));
}

/**
 * Reload the fleet config (e.g. after editing fleet.json).
 * Only useful in dev; Vercel serverless functions are stateless.
 */
export function reloadFleetConfig(): void {
  _configs = null;
}
