// ---------------------------------------------------------------------------
// Time range presets and helpers
// ---------------------------------------------------------------------------

import { TimePreset } from "../types";

export const PRESETS: TimePreset[] = [
  { id: "day",   label: "Day Shift",  sub: "6A – 6P", sh: 6,  sm: 0, eh: 18, em: 0 },
  { id: "night", label: "Night Shift", sub: "6P – 6A", sh: 18, sm: 0, eh: 6,  em: 0 },
  { id: "full",  label: "Full Day",   sub: "12A – 12A", sh: 0,  sm: 0, eh: 0,  em: 0 },
];

export function matchPreset(sh: number, sm: number, eh: number, em: number): string {
  for (const p of PRESETS) {
    if (p.sh === sh && p.sm === sm && p.eh === eh && p.em === em) return p.id;
  }
  return "custom";
}

/** Convert HH:MM string to { h, m } */
export function parseTimeInput(val: string): { h: number; m: number } {
  const [h, m] = val.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

/** Convert hours+minutes to HH:MM for input value */
export function toTimeInput(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
