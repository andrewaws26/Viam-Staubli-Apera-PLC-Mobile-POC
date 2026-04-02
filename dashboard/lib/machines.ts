/**
 * Fleet machine registry — maps truck IDs to Viam part IDs and machine addresses.
 *
 * Phase 1: Static config loaded from FLEET_TRUCKS env var (JSON array).
 * When FLEET_TRUCKS is not set, constructs a single-truck config from the
 * existing per-machine env vars for full backward compatibility.
 *
 * Phase 2 (future): Load from Viam App API or database.
 */

export interface TruckConfig {
  id: string;
  name: string;
  tpsPartId: string;
  truckPartId: string;
  tpsMachineAddress?: string;
  truckMachineAddress?: string;
}

function loadTruckConfigs(): TruckConfig[] {
  const fleetJson = process.env.FLEET_TRUCKS;
  if (fleetJson) {
    try {
      const parsed = JSON.parse(fleetJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as TruckConfig[];
      }
    } catch (e) {
      console.error("[machines] Failed to parse FLEET_TRUCKS env var:", e);
    }
  }

  // Fallback: single-truck config from existing env vars
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
