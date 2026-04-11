/**
 * Truck Engine Health Baseline System
 *
 * Real baseline ranges computed from 14,705 Viam Cloud data points.
 * Mack Granite VIN ...9830, April 8-10, 2026.
 * All data is idle/parked (vehicle_speed=0, no driving sessions).
 *
 * Warning/critical thresholds are based on mechanical engineering knowledge
 * for heavy-duty diesel engines (Mack/Volvo D13 class).
 */

// ── Types ──────────────────────────────────────────────────────────────

export type HealthCategory =
  | "engine"
  | "cooling"
  | "lubrication"
  | "electrical"
  | "fuel"
  | "transmission"
  | "emissions";

export type HealthStatus = "good" | "watch" | "warning" | "critical" | "no_data";

export interface BaselineRange {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  avg: number;
  warnLow?: number;
  critLow?: number;
  warnHigh?: number;
  critHigh?: number;
  category: HealthCategory;
  note?: string;
}

export interface MetricHealth {
  key: string;
  label: string;
  value: number | string | null;
  unit: string;
  status: HealthStatus;
  baseline: BaselineRange;
  deviation: string;
  detail: string;
}

export interface CategoryHealth {
  category: HealthCategory;
  label: string;
  status: HealthStatus;
  metrics: MetricHealth[];
  summary: string;
}

export interface TruckHealth {
  overall: HealthStatus;
  overall_summary: string;
  categories: CategoryHealth[];
  findings: string[];
  data_quality: {
    points_available: number;
    baseline_source: string;
    last_data: string;
    coverage: string;
  };
}

// ── Category labels ────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<HealthCategory, string> = {
  engine: "Engine",
  cooling: "Cooling System",
  lubrication: "Lubrication",
  electrical: "Electrical",
  fuel: "Fuel System",
  transmission: "Transmission",
  emissions: "Emissions / Intake",
};

// ── Real baselines from 14,705 data points ─────────────────────────────

export const BASELINES: BaselineRange[] = [
  // Engine
  {
    key: "engine_rpm",
    label: "Engine RPM",
    unit: "rpm",
    min: 0,
    max: 1099,
    avg: 788,
    warnHigh: 2100,
    critHigh: 2500,
    category: "engine",
    note: "Idle ~650, governed max ~2100. Baseline is idle-only data.",
  },
  {
    key: "engine_load_pct",
    label: "Engine Load",
    unit: "%",
    min: 0,
    max: 46,
    avg: 12.7,
    warnHigh: 85,
    critHigh: 95,
    category: "engine",
    note: "Mostly idle. Sustained high load normal under heavy haul.",
  },
  {
    key: "boost_pressure_psi",
    label: "Boost Pressure",
    unit: "PSI",
    min: 0,
    max: 3.77,
    avg: 0.75,
    warnHigh: 35,
    critHigh: 45,
    category: "engine",
    note: "Near zero at idle. Builds under load.",
  },
  {
    key: "engine_hours",
    label: "Engine Hours",
    unit: "hrs",
    min: 5421.6,
    max: 5427.3,
    avg: 5424.5,
    category: "engine",
    note: "~5.7 hours captured. No warn/crit thresholds — informational only.",
  },

  // Cooling
  {
    key: "coolant_temp_f",
    label: "Coolant Temp",
    unit: "\u00B0F",
    min: 82,
    max: 199,
    avg: 182,
    warnLow: 120,
    warnHigh: 210,
    critHigh: 230,
    category: "cooling",
    note: "Cold start 82\u00B0F to operating 182-199\u00B0F. Thermostat opens ~180\u00B0F.",
  },
  {
    key: "intake_manifold_temp_f",
    label: "Intake Manifold Temp",
    unit: "\u00B0F",
    min: 75.2,
    max: 181.4,
    avg: 152,
    warnHigh: 200,
    critHigh: 230,
    category: "cooling",
    note: "Intercooler performance indicator. High = intercooler restriction.",
  },
  {
    key: "ambient_temp_f",
    label: "Ambient Temp",
    unit: "\u00B0F",
    min: 68.5,
    max: 136.2,
    avg: 83.5,
    category: "cooling",
    note: "Environmental reference. 136\u00B0F max likely radiant heat from engine bay sensor.",
  },

  // Lubrication
  {
    key: "oil_pressure_psi",
    label: "Oil Pressure",
    unit: "PSI",
    min: 0.58,
    max: 63.24,
    avg: 31.32,
    warnLow: 20,
    critLow: 15,
    warnHigh: 70,
    category: "lubrication",
    note: "Cold idle ~50 PSI, warm idle ~26 PSI. Below 15 PSI = stop engine immediately.",
  },
  {
    key: "oil_temp_f",
    label: "Oil Temp",
    unit: "\u00B0F",
    min: 72.7,
    max: 230.5,
    avg: 212.8,
    warnHigh: 235,
    critHigh: 250,
    category: "lubrication",
    note: "Operating 210-230\u00B0F. Oil breakdown accelerates above 250\u00B0F.",
  },

  // Electrical
  {
    key: "battery_voltage_v",
    label: "Battery Voltage",
    unit: "V",
    min: 0,
    max: 13.95,
    avg: 13.45,
    warnLow: 13.0,
    critLow: 12.5,
    warnHigh: 15.0,
    critHigh: 16.0,
    category: "electrical",
    note: "Running: 13.8-14.0V typical. Below 12.5V = alternator failure or parasitic draw.",
  },

  // Fuel
  {
    key: "fuel_rate_gph",
    label: "Fuel Rate",
    unit: "GPH",
    min: 0,
    max: 4.25,
    avg: 1.01,
    warnHigh: 15,
    critHigh: 25,
    category: "fuel",
    note: "Idle: ~1.0 GPH. Max observed 4.25 GPH (light rev, no load).",
  },
  {
    key: "fuel_level_pct",
    label: "Fuel Level",
    unit: "%",
    min: 19.2,
    max: 30.4,
    avg: 27.0,
    warnLow: 25,
    critLow: 15,
    category: "fuel",
    note: "LOW. Range 19-30% during capture. Needs fuel.",
  },

  // Transmission
  {
    key: "trans_oil_temp_f",
    label: "Trans Oil Temp",
    unit: "\u00B0F",
    min: 74.8,
    max: 177.2,
    avg: 154.4,
    warnHigh: 200,
    critHigh: 225,
    category: "transmission",
    note: "Parked/idle only. Under load + towing, temps rise significantly.",
  },

  // Emissions / Intake — informational, thresholds from DTC count
  {
    key: "active_dtc_count",
    label: "Active DTCs",
    unit: "codes",
    min: 3,
    max: 3,
    avg: 3,
    warnHigh: 1,
    critHigh: 3,
    category: "emissions",
    note: "Always 3 active DTCs during entire capture. Likely SCR/DEF related.",
  },
  {
    key: "vehicle_speed_mph",
    label: "Vehicle Speed",
    unit: "mph",
    min: 0,
    max: 0,
    avg: 0,
    category: "engine",
    note: "Never driven during data capture. All data is stationary.",
  },
];

// ── Helpers ────────────────────────────────────────────────────────────

function num(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

function pctDev(value: number, avg: number): string {
  if (avg === 0) return value === 0 ? "at average" : "above zero baseline";
  const pct = ((value - avg) / Math.abs(avg)) * 100;
  if (Math.abs(pct) < 2) return "normal";
  const dir = pct > 0 ? "above" : "below";
  return `${Math.abs(Math.round(pct))}% ${dir} avg`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function worstStatus(statuses: HealthStatus[]): HealthStatus {
  const priority: HealthStatus[] = ["critical", "warning", "watch", "good", "no_data"];
  for (const s of priority) {
    if (statuses.includes(s)) return s;
  }
  return "no_data";
}

// ── Core assessment ────────────────────────────────────────────────────

function assessMetric(
  baseline: BaselineRange,
  value: number | null,
): MetricHealth {
  if (value === null) {
    return {
      key: baseline.key,
      label: baseline.label,
      value: null,
      unit: baseline.unit,
      status: "no_data",
      baseline,
      deviation: "no data",
      detail: `${baseline.label} — no reading available.`,
    };
  }

  const v = round1(value);
  let status: HealthStatus = "good";
  let detail = "";

  // Critical checks first
  if (baseline.critLow !== undefined && v < baseline.critLow) {
    status = "critical";
    detail = `${baseline.label} at ${v} ${baseline.unit} — CRITICAL: below ${baseline.critLow} ${baseline.unit}. ${baseline.key === "oil_pressure_psi" ? "Stop engine immediately — risk of bearing damage." : "Immediate attention required."}`;
  } else if (baseline.critHigh !== undefined && v >= baseline.critHigh) {
    status = "critical";
    detail = `${baseline.label} at ${v} ${baseline.unit} — CRITICAL: above ${baseline.critHigh} ${baseline.unit}. ${baseline.key === "coolant_temp_f" ? "Risk of head gasket failure." : baseline.key === "oil_temp_f" ? "Oil breakdown territory." : "Immediate attention required."}`;
  }
  // Warning checks
  else if (baseline.warnLow !== undefined && v < baseline.warnLow) {
    status = "warning";
    detail = `${baseline.label} at ${v} ${baseline.unit} — below warning threshold of ${baseline.warnLow} ${baseline.unit}. `;
    if (baseline.key === "oil_pressure_psi") {
      detail += `Baseline warm idle avg is ${baseline.avg} PSI. Monitor closely.`;
    } else if (baseline.key === "battery_voltage_v") {
      detail += "Check alternator output and belt tension.";
    } else if (baseline.key === "fuel_level_pct") {
      detail += "Fuel up soon to avoid running dry.";
    } else if (baseline.key === "coolant_temp_f") {
      detail += "Possible thermostat stuck open if engine is warm.";
    } else {
      detail += `Baseline avg is ${baseline.avg} ${baseline.unit}.`;
    }
  } else if (baseline.warnHigh !== undefined && v >= baseline.warnHigh) {
    status = "warning";
    detail = `${baseline.label} at ${v} ${baseline.unit} — above warning threshold of ${baseline.warnHigh} ${baseline.unit}. `;
    if (baseline.key === "coolant_temp_f") {
      detail += "Possible cooling system issue — check coolant level, fan clutch, thermostat.";
    } else if (baseline.key === "oil_temp_f") {
      detail += "Oil viscosity degrading. Check oil cooler and coolant flow.";
    } else if (baseline.key === "trans_oil_temp_f") {
      detail += "Transmission overheating. Reduce load or check trans cooler.";
    } else if (baseline.key === "intake_manifold_temp_f") {
      detail += "Intercooler may be restricted. Check for debris or boost leak.";
    } else {
      detail += `Baseline avg is ${baseline.avg} ${baseline.unit}.`;
    }
  }
  // Watch — value is in the last 20% of the gap between avg and warn threshold
  else if (
    (baseline.warnLow !== undefined && (() => {
      const gap = baseline.avg - baseline.warnLow;
      return gap > 0 && v < baseline.warnLow + gap * 0.2 && v >= baseline.warnLow;
    })()) ||
    (baseline.warnHigh !== undefined && (() => {
      const gap = baseline.warnHigh - baseline.avg;
      return gap > 0 && v > baseline.warnHigh - gap * 0.2 && v < baseline.warnHigh;
    })())
  ) {
    status = "watch";
    detail = `${baseline.label} at ${v} ${baseline.unit} — approaching threshold. Baseline avg ${baseline.avg} ${baseline.unit}.`;
  }
  // Good
  else {
    status = "good";
    detail = `${baseline.label} at ${v} ${baseline.unit} — normal. Baseline avg ${baseline.avg} ${baseline.unit}.`;
  }

  const deviation = pctDev(v, baseline.avg);

  return {
    key: baseline.key,
    label: baseline.label,
    value: v,
    unit: baseline.unit,
    status,
    baseline,
    deviation,
    detail,
  };
}

// ── Main assessment function ───────────────────────────────────────────

export function assessTruckHealth(
  readings: Record<string, unknown>,
): TruckHealth {
  // Assess each baseline metric
  const assessedMetrics: MetricHealth[] = BASELINES.map((b) => {
    const rawValue = num(readings[b.key]);
    return assessMetric(b, rawValue);
  });

  // Group by category
  const categoryMap = new Map<HealthCategory, MetricHealth[]>();
  for (const m of assessedMetrics) {
    const cat = m.baseline.category;
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(m);
  }

  const categories: CategoryHealth[] = [];
  for (const [cat, metrics] of Array.from(categoryMap.entries())) {
    const statuses = metrics
      .filter((m) => m.status !== "no_data")
      .map((m) => m.status);
    const catStatus = statuses.length > 0 ? worstStatus(statuses) : "no_data";

    // Build a summary for the category
    const issues = metrics.filter(
      (m) => m.status === "warning" || m.status === "critical",
    );
    let summary: string;
    if (issues.length === 0) {
      const watched = metrics.filter((m) => m.status === "watch");
      if (watched.length > 0) {
        summary = `${CATEGORY_LABELS[cat]}: Monitoring ${watched.map((m) => m.label).join(", ")} — approaching thresholds.`;
      } else {
        summary = `${CATEGORY_LABELS[cat]}: All readings within normal range.`;
      }
    } else {
      summary = `${CATEGORY_LABELS[cat]}: ${issues.map((m) => `${m.label} ${m.status}`).join(", ")}.`;
    }

    categories.push({
      category: cat,
      label: CATEGORY_LABELS[cat],
      status: catStatus,
      metrics,
      summary,
    });
  }

  // Sort categories: worst status first
  const statusOrder: HealthStatus[] = ["critical", "warning", "watch", "good", "no_data"];
  categories.sort(
    (a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status),
  );

  // Overall status
  const overall = worstStatus(categories.map((c) => c.status));

  // Findings — notable items beyond threshold checks
  const findings: string[] = [];

  // Note the 3 active DTCs
  const dtcVal = num(readings.active_dtc_count);
  if (dtcVal !== null && dtcVal > 0) {
    findings.push(
      `${dtcVal} active DTC(s) present. All 14,705 baseline readings showed exactly 3 DTCs — likely ongoing SCR/DEF system fault. Recommend diagnostic scan for SPN/FMI codes.`,
    );
  }

  // Note low fuel
  const fuelVal = num(readings.fuel_level_pct);
  if (fuelVal !== null && fuelVal < 30) {
    findings.push(
      `Fuel level at ${round1(fuelVal)}%. Baseline range was only 19-30% — this truck has been running low throughout the monitoring period. Fill up.`,
    );
  }

  // Note if vehicle is moving (no baseline data for driving)
  const speedVal = num(readings.vehicle_speed_mph);
  if (speedVal !== null && speedVal > 0) {
    findings.push(
      `Vehicle is moving at ${round1(speedVal)} mph. All baseline data is from stationary/idle — thresholds are calibrated for idle conditions. Under-load values will differ.`,
    );
  }

  // Note voltage if engine off
  const rpmVal = num(readings.engine_rpm);
  const voltVal = num(readings.battery_voltage_v);
  if (rpmVal !== null && rpmVal === 0 && voltVal !== null && voltVal < 12.4) {
    findings.push(
      `Engine off and battery at ${round1(voltVal)}V. Below 12.4V with engine off could indicate a weak battery or parasitic drain.`,
    );
  }

  // Overall summary
  let overallSummary: string;
  const critCount = categories.filter((c) => c.status === "critical").length;
  const warnCount = categories.filter((c) => c.status === "warning").length;
  const watchCount = categories.filter((c) => c.status === "watch").length;

  if (critCount > 0) {
    overallSummary = `CRITICAL: ${critCount} system(s) need immediate attention. ${warnCount > 0 ? `${warnCount} additional warning(s).` : ""} ${findings.length > 0 ? `${findings.length} finding(s).` : ""}`;
  } else if (warnCount > 0) {
    overallSummary = `WARNING: ${warnCount} system(s) above threshold. ${watchCount > 0 ? `${watchCount} on watch.` : ""} ${findings.length > 0 ? `${findings.length} finding(s).` : ""}`;
  } else if (watchCount > 0) {
    overallSummary = `WATCH: ${watchCount} metric(s) approaching thresholds. No immediate issues. ${findings.length > 0 ? `${findings.length} finding(s).` : ""}`;
  } else {
    overallSummary = `All systems normal. ${findings.length > 0 ? `${findings.length} finding(s) to note.` : "No findings."}`;
  }

  return {
    overall,
    overall_summary: overallSummary.trim(),
    categories,
    findings,
    data_quality: {
      points_available: 14705,
      baseline_source: "Mack Granite VIN ...9830, Viam Cloud export",
      last_data: "April 8-10, 2026",
      coverage: "idle only",
    },
  };
}
