/**
 * Vehicle-specific history notes for AI prompts.
 *
 * Currently a static config keyed by VIN. Move to Supabase
 * when the fleet grows beyond a handful of trucks.
 */

export interface VehicleHistory {
  vin: string;
  year: number;
  make: string;
  model: string;
  engine: string;
  engineHours?: number;
  engineHoursAsOf?: string;
  knownIssues: string[];
  fleetNotes: string[];
}

const VEHICLES: Record<string, VehicleHistory> = {
  "1M2GR4GC7RM039830": {
    vin: "1M2GR4GC7RM039830",
    year: 2024,
    make: "Mack",
    model: "Granite",
    engine: "MP8",
    engineHours: 786,
    engineHoursAsOf: "April 2026",
    knownIssues: [
      "SCR exhaust temp sensor signal missing, causing DEF dosing disabled, 28% SCR efficiency, EPA Stage 1 inducement. Repair pending: inspect sensor/wiring/connector between DPF outlet and SCR catalyst inlet (driver side of aftertreatment assembly, MP8).",
      "ECM cannot see DEF level that ACM reads fine (57.6%).",
    ],
    fleetNotes: [
      "B&B Metals fleet truck. Repairs done in-house, NOT at a dealer.",
      "35.6% idle time typical (280 of 786 hrs). 190.5 gal ($723) burned at idle.",
    ],
  },
};

const FLEET_NOTES = [
  "This is a B&B Metals fleet. Repairs are done in-house, NOT at a dealer.",
  "Fleet-wide: 35.6% idle time is typical for these trucks.",
];

/**
 * Build the VEHICLE HISTORY NOTES section for an AI prompt.
 * Tries to match by VIN from readings; falls back to all known vehicles + fleet notes.
 */
export function getVehicleHistoryText(readings?: Record<string, unknown>): string {
  const lines: string[] = ["VEHICLE HISTORY NOTES:"];

  const vin = readings?._vin as string | undefined;
  const vehicle = vin ? VEHICLES[vin] : undefined;

  if (vehicle) {
    const hoursNote = vehicle.engineHours
      ? `, ${vehicle.engineHours} engine hours as of ${vehicle.engineHoursAsOf}`
      : "";
    lines.push(
      `- VIN ${vehicle.vin} (${vehicle.year} ${vehicle.make} ${vehicle.model}${hoursNote}): Known issues:`
    );
    for (const issue of vehicle.knownIssues) {
      lines.push(`  - ${issue}`);
    }
    for (const note of vehicle.fleetNotes) {
      lines.push(`- ${note}`);
    }
  } else {
    // No VIN match — include all known vehicles + fleet-wide notes
    for (const v of Object.values(VEHICLES)) {
      const hoursNote = v.engineHours
        ? `, ${v.engineHours} engine hours as of ${v.engineHoursAsOf}`
        : "";
      lines.push(`- VIN ${v.vin} (${v.year} ${v.make} ${v.model}${hoursNote}): Known issues:`);
      for (const issue of v.knownIssues) {
        lines.push(`  - ${issue}`);
      }
    }
    for (const note of FLEET_NOTES) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}
