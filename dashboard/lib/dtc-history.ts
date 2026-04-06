/**
 * DTC History — tracks when trouble codes appear and clear.
 *
 * Persists to localStorage so mechanics can see patterns like
 * "this code comes and goes every morning when it's cold."
 * Capped at 200 events (~40KB).
 */

import { lookupSPN, lookupFMI } from "./spn-lookup";

// J1939 ECU sources — shared with DTCPanel.tsx
export const ECU_SOURCES = [
  { suffix: "engine", label: "Engine" },
  { suffix: "trans", label: "Transmission" },
  { suffix: "abs", label: "ABS" },
  { suffix: "acm", label: "Aftertreatment" },
  { suffix: "body", label: "Body" },
  { suffix: "inst", label: "Instrument" },
] as const;

export interface DTCHistoryEvent {
  id: string;
  spn: number;
  fmi: number;
  ecuSuffix: string;
  ecuLabel: string;
  spnName: string;
  event: "appeared" | "cleared";
  timestamp: string; // ISO 8601
}

// Snapshot key: "spn:fmi:ecuSuffix"
export interface DTCSnapshot {
  [key: string]: { spn: number; fmi: number; ecuSuffix: string; ecuLabel: string; spnName: string };
}

const STORAGE_KEY = "ironsight_dtc_history";
const MAX_EVENTS = 200;

export function loadDTCHistory(): DTCHistoryEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(-MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

export function saveDTCHistory(events: DTCHistoryEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // localStorage full or unavailable — silent fail
  }
}

export function clearDTCHistory(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/** Build a snapshot of currently active DTCs from readings. */
export function buildDTCSnapshot(readings: Record<string, unknown>): DTCSnapshot {
  const snap: DTCSnapshot = {};
  for (const { suffix, label } of ECU_SOURCES) {
    const count = Number(readings[`dtc_${suffix}_count`]) || 0;
    for (let i = 0; i < Math.min(count, 10); i++) {
      const spn = readings[`dtc_${suffix}_${i}_spn`] as number | undefined;
      const fmi = readings[`dtc_${suffix}_${i}_fmi`] as number | undefined;
      if (spn === undefined) break;
      const key = `${spn}:${fmi ?? 0}:${suffix}`;
      snap[key] = { spn, fmi: fmi ?? 0, ecuSuffix: suffix, ecuLabel: label, spnName: lookupSPN(spn).name };
    }
  }
  return snap;
}

/** Compare previous and current snapshots, return new history events. */
export function computeDTCDiff(prev: DTCSnapshot, current: DTCSnapshot): DTCHistoryEvent[] {
  const now = new Date().toISOString();
  const events: DTCHistoryEvent[] = [];

  // Appeared: in current but not in prev
  for (const [key, dtc] of Object.entries(current)) {
    if (!(key in prev)) {
      events.push({
        id: `${Date.now()}-${key}`,
        spn: dtc.spn,
        fmi: dtc.fmi,
        ecuSuffix: dtc.ecuSuffix,
        ecuLabel: dtc.ecuLabel,
        spnName: dtc.spnName,
        event: "appeared",
        timestamp: now,
      });
    }
  }

  // Cleared: in prev but not in current
  for (const [key, dtc] of Object.entries(prev)) {
    if (!(key in current)) {
      events.push({
        id: `${Date.now()}-clear-${key}`,
        spn: dtc.spn,
        fmi: dtc.fmi,
        ecuSuffix: dtc.ecuSuffix,
        ecuLabel: dtc.ecuLabel,
        spnName: dtc.spnName,
        event: "cleared",
        timestamp: now,
      });
    }
  }

  return events;
}

/** Format DTC history for AI prompt injection. */
export function formatDTCHistoryForAI(events: DTCHistoryEvent[]): string {
  if (events.length === 0) return "";
  const lines: string[] = ["CLIENT-SIDE DTC HISTORY (from dashboard localStorage):"];
  // Show most recent 20 events
  const recent = events.slice(-20);
  for (const e of recent) {
    const fmiText = lookupFMI(e.fmi);
    lines.push(
      `- ${e.timestamp.slice(0, 16).replace("T", " ")} — SPN ${e.spn} (${e.spnName}) / FMI ${e.fmi} (${fmiText}) [${e.ecuLabel}] ${e.event.toUpperCase()}`
    );
  }
  // Count patterns
  const counts: Record<string, { appeared: number; cleared: number }> = {};
  for (const e of events) {
    const key = `${e.spn}:${e.fmi}:${e.ecuSuffix}`;
    if (!counts[key]) counts[key] = { appeared: 0, cleared: 0 };
    counts[key][e.event]++;
  }
  const intermittent = Object.entries(counts).filter(([, c]) => c.appeared > 1 && c.cleared > 0);
  if (intermittent.length > 0) {
    lines.push("");
    lines.push("INTERMITTENT CODES (appeared multiple times then cleared):");
    for (const [key, c] of intermittent) {
      const [spn] = key.split(":");
      const name = lookupSPN(Number(spn)).name;
      lines.push(`- SPN ${spn} (${name}): appeared ${c.appeared}x, cleared ${c.cleared}x — possible intermittent fault`);
    }
  }
  return lines.join("\n");
}
