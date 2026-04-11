/**
 * Truck Engine Health Baseline — Pure Function Tests
 *
 * Tests the assessTruckHealth logic with known readings against real baselines
 * from 14,705 Mack Granite data points.
 */

import { describe, it, expect } from "vitest";
import {
  assessTruckHealth,
  BASELINES,
  type TruckHealth,
  type HealthStatus,
} from "@/lib/truck-baseline";

// ── Helpers ────────────────────────────────────────────────────────────

/** Generate a complete set of normal warm-idle readings */
function normalReadings(): Record<string, unknown> {
  return {
    engine_rpm: 650,
    coolant_temp_f: 185,
    oil_pressure_psi: 28,
    oil_temp_f: 215,
    battery_voltage_v: 13.85,
    fuel_rate_gph: 1.0,
    fuel_level_pct: 50,
    ambient_temp_f: 78,
    trans_oil_temp_f: 155,
    engine_load_pct: 12,
    boost_pressure_psi: 0.5,
    intake_manifold_temp_f: 145,
    engine_hours: 5430,
    active_dtc_count: 0,
    vehicle_speed_mph: 0,
  };
}

// ── Baseline definitions ───────────────────────────────────────────────

describe("BASELINES array", () => {
  it("has entries for all expected metrics", () => {
    const keys = BASELINES.map((b) => b.key);
    expect(keys).toContain("engine_rpm");
    expect(keys).toContain("coolant_temp_f");
    expect(keys).toContain("oil_pressure_psi");
    expect(keys).toContain("battery_voltage_v");
    expect(keys).toContain("fuel_rate_gph");
    expect(keys).toContain("fuel_level_pct");
    expect(keys).toContain("oil_temp_f");
    expect(keys).toContain("trans_oil_temp_f");
    expect(keys).toContain("engine_load_pct");
    expect(keys).toContain("boost_pressure_psi");
    expect(keys).toContain("intake_manifold_temp_f");
    expect(keys).toContain("active_dtc_count");
    expect(keys).toContain("vehicle_speed_mph");
    expect(keys).toContain("engine_hours");
    expect(keys).toContain("ambient_temp_f");
  });

  it("has valid min <= avg <= max for each metric", () => {
    for (const b of BASELINES) {
      expect(b.min).toBeLessThanOrEqual(b.avg);
      expect(b.avg).toBeLessThanOrEqual(b.max);
    }
  });

  it("every baseline has a category", () => {
    const validCategories = [
      "engine", "cooling", "lubrication", "electrical", "fuel", "transmission", "emissions",
    ];
    for (const b of BASELINES) {
      expect(validCategories).toContain(b.category);
    }
  });

  it("warn thresholds are inside critical thresholds where both exist", () => {
    for (const b of BASELINES) {
      if (b.warnLow !== undefined && b.critLow !== undefined) {
        expect(b.warnLow).toBeGreaterThan(b.critLow);
      }
      if (b.warnHigh !== undefined && b.critHigh !== undefined) {
        expect(b.warnHigh).toBeLessThan(b.critHigh);
      }
    }
  });
});

// ── assessTruckHealth — overall structure ──────────────────────────────

describe("assessTruckHealth() structure", () => {
  it("returns all required fields", () => {
    const result = assessTruckHealth(normalReadings());
    expect(result).toHaveProperty("overall");
    expect(result).toHaveProperty("overall_summary");
    expect(result).toHaveProperty("categories");
    expect(result).toHaveProperty("findings");
    expect(result).toHaveProperty("data_quality");
    expect(result.data_quality.points_available).toBe(14705);
    expect(result.data_quality.coverage).toBe("idle only");
  });

  it("groups metrics into categories", () => {
    const result = assessTruckHealth(normalReadings());
    const cats = result.categories.map((c) => c.category);
    expect(cats).toContain("engine");
    expect(cats).toContain("cooling");
    expect(cats).toContain("lubrication");
    expect(cats).toContain("electrical");
    expect(cats).toContain("fuel");
    expect(cats).toContain("transmission");
  });

  it("every metric has deviation and detail strings", () => {
    const result = assessTruckHealth(normalReadings());
    for (const cat of result.categories) {
      for (const m of cat.metrics) {
        expect(typeof m.deviation).toBe("string");
        expect(typeof m.detail).toBe("string");
        expect(m.detail.length).toBeGreaterThan(0);
      }
    }
  });
});

// ── Status determination — normal readings ────────────────────────────

describe("assessTruckHealth() — normal readings", () => {
  it("returns overall good with normal readings", () => {
    const result = assessTruckHealth(normalReadings());
    expect(result.overall).toBe("good");
  });

  it("coolant at 185F is good", () => {
    const result = assessTruckHealth(normalReadings());
    const coolant = findMetric(result, "coolant_temp_f");
    expect(coolant?.status).toBe("good");
  });

  it("oil pressure at 28 PSI is good", () => {
    const result = assessTruckHealth(normalReadings());
    const oil = findMetric(result, "oil_pressure_psi");
    expect(oil?.status).toBe("good");
  });

  it("battery at 13.85V is good", () => {
    const result = assessTruckHealth(normalReadings());
    const batt = findMetric(result, "battery_voltage_v");
    expect(batt?.status).toBe("good");
  });
});

// ── Warning thresholds ────────────────────────────────────────────────

describe("assessTruckHealth() — warning thresholds", () => {
  it("coolant at 215F triggers warning", () => {
    const readings = { ...normalReadings(), coolant_temp_f: 215 };
    const result = assessTruckHealth(readings);
    const coolant = findMetric(result, "coolant_temp_f");
    expect(coolant?.status).toBe("warning");
  });

  it("oil pressure at 18 PSI triggers warning", () => {
    const readings = { ...normalReadings(), oil_pressure_psi: 18 };
    const result = assessTruckHealth(readings);
    const oil = findMetric(result, "oil_pressure_psi");
    expect(oil?.status).toBe("warning");
  });

  it("battery at 12.8V triggers warning", () => {
    const readings = { ...normalReadings(), battery_voltage_v: 12.8 };
    const result = assessTruckHealth(readings);
    const batt = findMetric(result, "battery_voltage_v");
    expect(batt?.status).toBe("warning");
  });

  it("oil temp at 240F triggers warning", () => {
    const readings = { ...normalReadings(), oil_temp_f: 240 };
    const result = assessTruckHealth(readings);
    const oilTemp = findMetric(result, "oil_temp_f");
    expect(oilTemp?.status).toBe("warning");
  });

  it("trans temp at 210F triggers warning", () => {
    const readings = { ...normalReadings(), trans_oil_temp_f: 210 };
    const result = assessTruckHealth(readings);
    const trans = findMetric(result, "trans_oil_temp_f");
    expect(trans?.status).toBe("warning");
  });

  it("fuel level at 20% triggers warning", () => {
    const readings = { ...normalReadings(), fuel_level_pct: 20 };
    const result = assessTruckHealth(readings);
    const fuel = findMetric(result, "fuel_level_pct");
    expect(fuel?.status).toBe("warning");
  });

  it("overall is warning when any metric is warning", () => {
    const readings = { ...normalReadings(), coolant_temp_f: 215 };
    const result = assessTruckHealth(readings);
    expect(result.overall).toBe("warning");
  });
});

// ── Critical thresholds ───────────────────────────────────────────────

describe("assessTruckHealth() — critical thresholds", () => {
  it("coolant at 235F triggers critical", () => {
    const readings = { ...normalReadings(), coolant_temp_f: 235 };
    const result = assessTruckHealth(readings);
    const coolant = findMetric(result, "coolant_temp_f");
    expect(coolant?.status).toBe("critical");
    expect(coolant?.detail).toContain("head gasket");
  });

  it("oil pressure at 12 PSI triggers critical", () => {
    const readings = { ...normalReadings(), oil_pressure_psi: 12 };
    const result = assessTruckHealth(readings);
    const oil = findMetric(result, "oil_pressure_psi");
    expect(oil?.status).toBe("critical");
    expect(oil?.detail).toContain("bearing damage");
  });

  it("battery at 12.0V triggers critical", () => {
    const readings = { ...normalReadings(), battery_voltage_v: 12.0 };
    const result = assessTruckHealth(readings);
    const batt = findMetric(result, "battery_voltage_v");
    expect(batt?.status).toBe("critical");
  });

  it("oil temp at 255F triggers critical", () => {
    const readings = { ...normalReadings(), oil_temp_f: 255 };
    const result = assessTruckHealth(readings);
    const oilTemp = findMetric(result, "oil_temp_f");
    expect(oilTemp?.status).toBe("critical");
    expect(oilTemp?.detail).toContain("breakdown");
  });

  it("overall is critical when any metric is critical", () => {
    const readings = { ...normalReadings(), coolant_temp_f: 235 };
    const result = assessTruckHealth(readings);
    expect(result.overall).toBe("critical");
  });

  it("critical summary mentions immediate attention", () => {
    const readings = { ...normalReadings(), oil_pressure_psi: 10 };
    const result = assessTruckHealth(readings);
    expect(result.overall_summary).toContain("CRITICAL");
  });
});

// ── No data handling ──────────────────────────────────────────────────

describe("assessTruckHealth() — missing data", () => {
  it("returns no_data for empty readings", () => {
    const result = assessTruckHealth({});
    for (const cat of result.categories) {
      for (const m of cat.metrics) {
        expect(m.status).toBe("no_data");
        expect(m.value).toBeNull();
      }
    }
  });

  it("handles partial readings", () => {
    const readings = { engine_rpm: 700, coolant_temp_f: 190 };
    const result = assessTruckHealth(readings);
    const rpm = findMetric(result, "engine_rpm");
    const coolant = findMetric(result, "coolant_temp_f");
    const oil = findMetric(result, "oil_pressure_psi");
    expect(rpm?.status).toBe("good");
    expect(coolant?.status).toBe("good");
    expect(oil?.status).toBe("no_data");
  });

  it("handles string values in readings", () => {
    const readings = { engine_rpm: "700", coolant_temp_f: "190.5" };
    const result = assessTruckHealth(readings);
    const rpm = findMetric(result, "engine_rpm");
    expect(rpm?.status).toBe("good");
    expect(rpm?.value).toBe(700);
  });
});

// ── Findings ──────────────────────────────────────────────────────────

describe("assessTruckHealth() — findings", () => {
  it("notes active DTCs", () => {
    const readings = { ...normalReadings(), active_dtc_count: 3 };
    const result = assessTruckHealth(readings);
    const dtcFinding = result.findings.find((f) => f.includes("DTC"));
    expect(dtcFinding).toBeDefined();
    expect(dtcFinding).toContain("3");
  });

  it("does not note DTCs when count is 0", () => {
    const readings = { ...normalReadings(), active_dtc_count: 0 };
    const result = assessTruckHealth(readings);
    const dtcFinding = result.findings.find((f) => f.includes("DTC"));
    expect(dtcFinding).toBeUndefined();
  });

  it("notes low fuel", () => {
    const readings = { ...normalReadings(), fuel_level_pct: 22 };
    const result = assessTruckHealth(readings);
    const fuelFinding = result.findings.find((f) => f.includes("Fuel level"));
    expect(fuelFinding).toBeDefined();
  });

  it("notes when vehicle is moving (no driving baseline)", () => {
    const readings = { ...normalReadings(), vehicle_speed_mph: 45 };
    const result = assessTruckHealth(readings);
    const movingFinding = result.findings.find((f) => f.includes("moving"));
    expect(movingFinding).toBeDefined();
    expect(movingFinding).toContain("45");
  });

  it("notes low battery with engine off", () => {
    const readings = { ...normalReadings(), engine_rpm: 0, battery_voltage_v: 12.2 };
    const result = assessTruckHealth(readings);
    const battFinding = result.findings.find((f) => f.includes("parasitic"));
    expect(battFinding).toBeDefined();
  });
});

// ── Category worst-status propagation ─────────────────────────────────

describe("assessTruckHealth() — category status rollup", () => {
  it("category takes worst metric status", () => {
    // Oil pressure warning, oil temp good => lubrication = warning
    const readings = { ...normalReadings(), oil_pressure_psi: 18 };
    const result = assessTruckHealth(readings);
    const lub = result.categories.find((c) => c.category === "lubrication");
    expect(lub?.status).toBe("warning");
  });

  it("categories sort worst-first", () => {
    const readings = { ...normalReadings(), coolant_temp_f: 235 };
    const result = assessTruckHealth(readings);
    expect(result.categories[0].status).toBe("critical");
  });
});

// ── Deviation calculation ─────────────────────────────────────────────

describe("assessTruckHealth() — deviation strings", () => {
  it("reports normal deviation for value near average", () => {
    const result = assessTruckHealth(normalReadings());
    const coolant = findMetric(result, "coolant_temp_f");
    // 185 vs avg 182 = ~1.6% above -> "normal" (< 2% threshold)
    expect(coolant?.deviation).toBe("normal");
  });

  it("reports percentage deviation for value far from average", () => {
    const readings = { ...normalReadings(), oil_pressure_psi: 50 };
    const result = assessTruckHealth(readings);
    const oil = findMetric(result, "oil_pressure_psi");
    // 50 vs avg 31.32 = ~60% above
    expect(oil?.deviation).toContain("above avg");
  });
});

// ── Realistic Mack Granite readings ───────────────────────────────────

describe("assessTruckHealth() — real Mack Granite scenario", () => {
  it("assesses actual baseline averages as expected", () => {
    // Feed in the actual average values from the 14,705 data points
    const readings: Record<string, unknown> = {
      engine_rpm: 788,
      coolant_temp_f: 182,
      oil_pressure_psi: 31.32,
      oil_temp_f: 212.8,
      battery_voltage_v: 13.45,
      fuel_rate_gph: 1.01,
      fuel_level_pct: 27.0,
      ambient_temp_f: 83.5,
      trans_oil_temp_f: 154.4,
      engine_load_pct: 12.7,
      boost_pressure_psi: 0.75,
      intake_manifold_temp_f: 152,
      engine_hours: 5424.5,
      active_dtc_count: 3,
      vehicle_speed_mph: 0,
    };

    const result = assessTruckHealth(readings);

    // With 3 DTCs and ~27% fuel, should have emissions critical + fuel warning
    expect(result.overall).toBe("critical");
    expect(result.findings.length).toBeGreaterThan(0);

    // Engine metrics should be good at idle averages
    const rpm = findMetric(result, "engine_rpm");
    expect(rpm?.status).toBe("good");

    // Oil pressure at average should be good
    const oil = findMetric(result, "oil_pressure_psi");
    expect(oil?.status).toBe("good");

    // DTC count of 3 triggers critical on emissions
    const dtc = findMetric(result, "active_dtc_count");
    expect(dtc?.status).toBe("critical");
  });
});

// ── Test helper ────────────────────────────────────────────────────────

function findMetric(health: TruckHealth, key: string) {
  for (const cat of health.categories) {
    const m = cat.metrics.find((m) => m.key === key);
    if (m) return m;
  }
  return undefined;
}
