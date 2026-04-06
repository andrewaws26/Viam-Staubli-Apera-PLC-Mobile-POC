/**
 * DTC History Tracker — persists fault code lifecycle to Supabase.
 *
 * Called from /api/truck-readings on each poll. Compares current active DTCs
 * from the sensor reading against what's in the dtc_history table:
 *   - New DTCs → insert
 *   - Still active → update last_seen_at and occurrence_count
 *   - No longer active → mark cleared_at
 *
 * Fire-and-forget: errors are logged but never thrown to the caller.
 */

import { getSupabase } from "./supabase";

interface ActiveDTC {
  spn: number;
  fmi: number;
  source_address?: number;
  description?: string;
}

/**
 * Extract active J1939 DTCs from truck-engine readings payload.
 * DTCs are encoded as: dtc_{ecu}_{i}_spn, dtc_{ecu}_{i}_fmi, dtc_{ecu}_{i}_desc
 */
function extractDTCs(readings: Record<string, unknown>): ActiveDTC[] {
  const dtcs: ActiveDTC[] = [];
  const ecuPrefixes = ["engine", "trans", "abs", "acm", "body", "inst"];

  for (const ecu of ecuPrefixes) {
    const countKey = `dtc_${ecu}_count`;
    const count = typeof readings[countKey] === "number" ? readings[countKey] as number : 0;

    for (let i = 0; i < count; i++) {
      const spn = readings[`dtc_${ecu}_${i}_spn`];
      const fmi = readings[`dtc_${ecu}_${i}_fmi`];
      if (typeof spn === "number" && typeof fmi === "number") {
        const sa = readings[`dtc_${ecu}_${i}_sa`];
        const desc = readings[`dtc_${ecu}_${i}_desc`];
        dtcs.push({
          spn,
          fmi,
          source_address: typeof sa === "number" ? sa : undefined,
          description: typeof desc === "string" ? desc : undefined,
        });
      }
    }
  }

  // Also check dtc_active array format
  const dtcActive = readings.dtc_active;
  if (Array.isArray(dtcActive)) {
    for (const d of dtcActive) {
      if (d && typeof d === "object" && "spn" in d && "fmi" in d) {
        const obj = d as Record<string, unknown>;
        if (typeof obj.spn === "number" && typeof obj.fmi === "number") {
          // Avoid duplicates
          const exists = dtcs.some((x) => x.spn === obj.spn && x.fmi === obj.fmi);
          if (!exists) {
            dtcs.push({
              spn: obj.spn as number,
              fmi: obj.fmi as number,
              source_address: typeof obj.sa === "number" ? obj.sa : undefined,
              description: typeof obj.description === "string" ? obj.description : undefined,
            });
          }
        }
      }
    }
  }

  return dtcs;
}

/**
 * Track DTC state changes for a truck. Non-blocking.
 */
export function trackDTCs(truckId: string, readings: Record<string, unknown>): void {
  const activeDTCs = extractDTCs(readings);
  _trackDTCsAsync(truckId, activeDTCs).catch((err) => {
    console.error("[DTC-TRACKER]", err instanceof Error ? err.message : String(err));
  });
}

async function _trackDTCsAsync(truckId: string, activeDTCs: ActiveDTC[]): Promise<void> {
  const sb = getSupabase();
  const now = new Date().toISOString();

  // Get all currently-active DTCs for this truck from the DB
  const { data: dbActive, error: fetchErr } = await sb
    .from("dtc_history")
    .select("id, spn, fmi")
    .eq("truck_id", truckId)
    .eq("active", true);

  if (fetchErr) {
    console.error("[DTC-TRACKER] fetch error:", fetchErr.message);
    return;
  }

  const dbMap = new Map<string, string>(); // "spn:fmi" → row id
  for (const row of dbActive ?? []) {
    dbMap.set(`${row.spn}:${row.fmi}`, row.id);
  }

  const activeKeys = new Set<string>();

  for (const dtc of activeDTCs) {
    const key = `${dtc.spn}:${dtc.fmi}`;
    activeKeys.add(key);

    if (dbMap.has(key)) {
      // Still active — bump last_seen_at
      sb.from("dtc_history")
        .update({ last_seen_at: now })
        .eq("id", dbMap.get(key)!)
        .then(({ error }) => {
          if (error) console.error("[DTC-TRACKER] update error:", error.message);
        });
    } else {
      // New DTC
      sb.from("dtc_history")
        .insert({
          truck_id: truckId,
          spn: dtc.spn,
          fmi: dtc.fmi,
          source_address: dtc.source_address ?? null,
          description: dtc.description ?? null,
          first_seen_at: now,
          last_seen_at: now,
          active: true,
          occurrence_count: 1,
        })
        .then(({ error }) => {
          if (error) console.error("[DTC-TRACKER] insert error:", error.message);
        });
    }
  }

  // Mark cleared: DTCs in DB that are no longer active
  for (const [key, rowId] of dbMap) {
    if (!activeKeys.has(key)) {
      sb.from("dtc_history")
        .update({ active: false, cleared_at: now })
        .eq("id", rowId)
        .then(({ error }) => {
          if (error) console.error("[DTC-TRACKER] clear error:", error.message);
        });
    }
  }
}
