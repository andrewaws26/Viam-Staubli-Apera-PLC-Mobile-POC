/**
 * Shift Report Aggregation — Pure Function Tests
 *
 * Tests the actual computation logic in aggregation.ts with hardcoded sample data.
 * These catch math bugs in trip detection, idle %, fuel rates, and data quality warnings.
 *
 * WHY: Previously the only "tests" read source code as strings. A math bug in
 * idle percentage or trip merge threshold would pass all tests and break in prod.
 */

import { describe, it, expect } from "vitest";
import {
  num, bool, parseRows, timeBounds, shiftToHours, downsample,
  getTimezoneOffsetMin, buildShiftReport,
} from "@/app/api/shift-report/aggregation";
import type { RawPoint } from "@/app/api/shift-report/types";

// ── Primitive converters ───────────────────────────────────────────

describe("num() converter", () => {
  it("returns number as-is", () => {
    expect(num(42)).toBe(42);
    expect(num(0)).toBe(0);
    expect(num(-5.5)).toBe(-5.5);
  });

  it("parses string to number", () => {
    expect(num("42")).toBe(42);
    expect(num("3.14")).toBeCloseTo(3.14);
    expect(num("-7")).toBe(-7);
  });

  it("returns 0 for non-numeric", () => {
    expect(num("abc")).toBe(0);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num({})).toBe(0);
    expect(num(true)).toBe(0);
  });
});

describe("bool() converter", () => {
  it("returns boolean as-is", () => {
    expect(bool(true)).toBe(true);
    expect(bool(false)).toBe(false);
  });

  it("converts truthy values", () => {
    expect(bool(1)).toBe(true);
    expect(bool("true")).toBe(true);
  });

  it("returns false for other values", () => {
    expect(bool(0)).toBe(false);
    expect(bool("false")).toBe(false);
    expect(bool(null)).toBe(false);
    expect(bool(undefined)).toBe(false);
  });
});

// ── Time helpers ───────────────────────────────────────────────────

describe("shiftToHours()", () => {
  it("day shift = 6am to 6pm", () => {
    const { sh, sm, eh, em } = shiftToHours("day");
    expect(sh).toBe(6);
    expect(sm).toBe(0);
    expect(eh).toBe(18);
    expect(em).toBe(0);
  });

  it("night shift = 6pm to 6am", () => {
    const { sh, sm, eh, em } = shiftToHours("night");
    expect(sh).toBe(18);
    expect(sm).toBe(0);
    expect(eh).toBe(6);
    expect(em).toBe(0);
  });

  it("unknown shift = full day", () => {
    const { sh, sm, eh, em } = shiftToHours("full");
    expect(sh).toBe(0);
    expect(sm).toBe(0);
    expect(eh).toBe(0);
    expect(em).toBe(0);
  });
});

describe("timeBounds()", () => {
  it("produces UTC start/end for a date + time range", () => {
    const { start, end } = timeBounds("2026-04-08", 6, 0, 18, 0, "America/New_York");
    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);
    // Day shift = 12 hours
    expect(end.getTime() - start.getTime()).toBe(12 * 3600000);
  });

  it("handles night shift crossing midnight", () => {
    const { start, end } = timeBounds("2026-04-08", 18, 0, 6, 0, "America/New_York");
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    // Night shift = 12 hours
    expect(end.getTime() - start.getTime()).toBe(12 * 3600000);
  });
});

describe("getTimezoneOffsetMin()", () => {
  it("returns a number for EDT", () => {
    const offset = getTimezoneOffsetMin("2026-04-08", "America/New_York");
    // EDT = UTC-4 = 240 minutes
    expect(offset).toBe(240);
  });

  it("returns a number for UTC", () => {
    const offset = getTimezoneOffsetMin("2026-04-08", "UTC");
    expect(offset).toBe(0);
  });
});

// ── Downsample ────────────────────────────────────────────────────

describe("downsample()", () => {
  it("returns data as-is when under limit", () => {
    const data = [1, 2, 3, 4, 5];
    expect(downsample(data, 10)).toEqual(data);
  });

  it("reduces data to target size", () => {
    const data = Array.from({ length: 1000 }, (_, i) => i);
    const result = downsample(data, 100);
    expect(result.length).toBeLessThanOrEqual(101); // +1 for last element
    expect(result[0]).toBe(0);
    expect(result[result.length - 1]).toBe(999);
  });

  it("preserves first and last elements", () => {
    const data = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const result = downsample(data, 3);
    expect(result[0]).toBe(10);
    expect(result[result.length - 1]).toBe(100);
  });
});

// ── parseRows ─────────────────────────────────────────────────────

describe("parseRows()", () => {
  it("unwraps Viam payload nesting and sorts by time", () => {
    const rows = [
      {
        timeCaptured: new Date("2026-04-08T15:00:00Z"),
        payload: { readings: { engine_rpm: 1200, coolant_temp_f: 195 } },
      },
      {
        timeCaptured: new Date("2026-04-08T14:59:00Z"),
        payload: { readings: { engine_rpm: 1100, coolant_temp_f: 190 } },
      },
    ];

    const result = parseRows(rows);
    expect(result).toHaveLength(2);
    // Should be sorted oldest first
    expect(result[0].timeCaptured.getTime()).toBeLessThan(result[1].timeCaptured.getTime());
    // Should unwrap readings
    expect(result[0].payload.engine_rpm).toBe(1100);
    expect(result[1].payload.engine_rpm).toBe(1200);
  });

  it("handles string timestamps", () => {
    const rows = [
      {
        timeCaptured: "2026-04-08T15:00:00Z" as unknown as Date,
        payload: { readings: { engine_rpm: 800 } },
      },
    ];

    const result = parseRows(rows);
    expect(result[0].timeCaptured).toBeInstanceOf(Date);
    expect(result[0].payload.engine_rpm).toBe(800);
  });
});

// ── buildShiftReport: Full integration ────────────────────────────

function makePoint(time: string, data: Record<string, unknown>): RawPoint {
  return { timeCaptured: new Date(time), payload: data };
}

/** Generate N seconds of truck data at 1Hz starting from a time. */
function generateTruckData(
  startIso: string,
  seconds: number,
  overrides?: Partial<Record<string, unknown>>,
): RawPoint[] {
  const start = new Date(startIso).getTime();
  const points: RawPoint[] = [];
  for (let i = 0; i < seconds; i++) {
    points.push(makePoint(new Date(start + i * 1000).toISOString(), {
      engine_rpm: 1200,
      vehicle_speed_mph: 35,
      coolant_temp_f: 195,
      oil_temp_f: 210,
      battery_voltage_v: 13.8,
      gps_latitude: 38.0 + i * 0.0001,
      gps_longitude: -84.5 + i * 0.0001,
      active_dtc_count: 0,
      ...overrides,
    }));
  }
  return points;
}

describe("buildShiftReport(): Engine hours and idle time", () => {
  it("calculates engine hours from RPM > 0 data", () => {
    // 3600 seconds of engine running = 1.0 hour
    const truckData = generateTruckData("2026-04-08T14:00:00Z", 3600);
    const report = buildShiftReport(
      [], truckData,
      "2026-04-08",
      new Date("2026-04-08T14:00:00Z"),
      new Date("2026-04-08T18:00:00Z"),
      false, "America/New_York",
    );

    expect(report.engineHours).toBeCloseTo(1.0, 1);
    expect(report.hasTruckData).toBe(true);
  });

  it("calculates idle time when speed = 0", () => {
    // 1800s running + moving, then 1800s running + idle (speed=0)
    const moving = generateTruckData("2026-04-08T14:00:00Z", 1800);
    const idle = generateTruckData("2026-04-08T14:30:00Z", 1800, { vehicle_speed_mph: 0 });
    const truckData = [...moving, ...idle];

    const report = buildShiftReport(
      [], truckData,
      "2026-04-08",
      new Date("2026-04-08T14:00:00Z"),
      new Date("2026-04-08T18:00:00Z"),
      false, "America/New_York",
    );

    expect(report.engineHours).toBeCloseTo(1.0, 1);
    expect(report.idleHours).toBeCloseTo(0.5, 1);
    expect(report.idlePercent).toBeCloseTo(50, 5);
  });

  it("reports zero hours when engine is off", () => {
    const truckData = generateTruckData("2026-04-08T14:00:00Z", 300, { engine_rpm: 0 });
    const report = buildShiftReport(
      [], truckData,
      "2026-04-08",
      new Date("2026-04-08T14:00:00Z"),
      new Date("2026-04-08T18:00:00Z"),
      false, "America/New_York",
    );

    expect(report.engineHours).toBe(0);
    expect(report.idleHours).toBe(0);
  });
});

describe("buildShiftReport(): Trip detection and merge", () => {
  it("detects a single continuous trip", () => {
    const truckData = generateTruckData("2026-04-08T14:00:00Z", 600);
    const report = buildShiftReport(
      [], truckData,
      "2026-04-08",
      new Date("2026-04-08T14:00:00Z"),
      new Date("2026-04-08T18:00:00Z"),
      false, "America/New_York",
    );

    expect(report.trips.length).toBe(1);
    expect(report.trips[0].durationMin).toBe(10); // 600s = 10min
  });

  it("merges trips separated by gaps under 60 seconds", () => {
    // Trip 1: 5 minutes running
    const trip1 = generateTruckData("2026-04-08T14:00:00Z", 300);
    // 30-second gap (engine off)
    const gap = generateTruckData("2026-04-08T14:05:00Z", 30, { engine_rpm: 0 });
    // Trip 2: 5 minutes running
    const trip2 = generateTruckData("2026-04-08T14:05:30Z", 300);

    const report = buildShiftReport(
      [], [...trip1, ...gap, ...trip2],
      "2026-04-08",
      new Date("2026-04-08T14:00:00Z"),
      new Date("2026-04-08T18:00:00Z"),
      false, "America/New_York",
    );

    // Should merge into 1 trip since gap < 60s
    expect(report.trips.length).toBe(1);
  });

  it("keeps trips separated by gaps over 60 seconds as distinct", () => {
    // Trip 1: 5 minutes running
    const trip1 = generateTruckData("2026-04-08T14:00:00Z", 300);
    // 120-second gap (engine off)
    const gap = generateTruckData("2026-04-08T14:05:00Z", 120, { engine_rpm: 0 });
    // Trip 2: 5 minutes running
    const trip2 = generateTruckData("2026-04-08T14:07:00Z", 300);

    const report = buildShiftReport(
      [], [...trip1, ...gap, ...trip2],
      "2026-04-08",
      new Date("2026-04-08T14:00:00Z"),
      new Date("2026-04-08T18:00:00Z"),
      false, "America/New_York",
    );

    expect(report.trips.length).toBe(2);
  });

  it("eliminates 0-minute phantom trips from RPM flicker", () => {
    // Simulate RPM flicker: running, 1s off, running, 1s off...
    const points: RawPoint[] = [];
    const start = new Date("2026-04-08T14:00:00Z").getTime();
    for (let i = 0; i < 600; i++) {
      const rpm = i % 20 === 10 ? 0 : 1200; // 1-second dip every 20 seconds
      points.push(makePoint(new Date(start + i * 1000).toISOString(), {
        engine_rpm: rpm,
        vehicle_speed_mph: rpm > 0 ? 35 : 0,
        coolant_temp_f: 195,
        oil_temp_f: 210,
        battery_voltage_v: 13.8,
        gps_latitude: 0,
        gps_longitude: 0,
        active_dtc_count: 0,
      }));
    }

    const report = buildShiftReport(
      [], points,
      "2026-04-08",
      new Date("2026-04-08T14:00:00Z"),
      new Date("2026-04-08T18:00:00Z"),
      false, "America/New_York",
    );

    // All gaps are < 60s, so everything should merge into 1 trip
    expect(report.trips.length).toBe(1);
  });
});

describe("buildShiftReport(): Peak/min tracking", () => {
  it("tracks peak coolant temperature", () => {
    const points = [
      makePoint("2026-04-08T14:00:00Z", { engine_rpm: 1200, coolant_temp_f: 190, vehicle_speed_mph: 30, oil_temp_f: 0, battery_voltage_v: 0, gps_latitude: 0, gps_longitude: 0, active_dtc_count: 0 }),
      makePoint("2026-04-08T14:01:00Z", { engine_rpm: 1200, coolant_temp_f: 230, vehicle_speed_mph: 30, oil_temp_f: 0, battery_voltage_v: 0, gps_latitude: 0, gps_longitude: 0, active_dtc_count: 0 }),
      makePoint("2026-04-08T14:02:00Z", { engine_rpm: 1200, coolant_temp_f: 200, vehicle_speed_mph: 30, oil_temp_f: 0, battery_voltage_v: 0, gps_latitude: 0, gps_longitude: 0, active_dtc_count: 0 }),
    ];

    const report = buildShiftReport([], points, "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), false, "America/New_York");
    expect(report.peakCoolantTemp).not.toBeNull();
    expect(report.peakCoolantTemp!.value).toBe(230);
  });

  it("tracks minimum battery voltage", () => {
    const points = [
      makePoint("2026-04-08T14:00:00Z", { engine_rpm: 1200, coolant_temp_f: 0, vehicle_speed_mph: 30, oil_temp_f: 0, battery_voltage_v: 13.8, gps_latitude: 0, gps_longitude: 0, active_dtc_count: 0 }),
      makePoint("2026-04-08T14:01:00Z", { engine_rpm: 1200, coolant_temp_f: 0, vehicle_speed_mph: 30, oil_temp_f: 0, battery_voltage_v: 11.2, gps_latitude: 0, gps_longitude: 0, active_dtc_count: 0 }),
      makePoint("2026-04-08T14:02:00Z", { engine_rpm: 1200, coolant_temp_f: 0, vehicle_speed_mph: 30, oil_temp_f: 0, battery_voltage_v: 12.5, gps_latitude: 0, gps_longitude: 0, active_dtc_count: 0 }),
    ];

    const report = buildShiftReport([], points, "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), false, "America/New_York");
    expect(report.minBatteryVoltage).not.toBeNull();
    expect(report.minBatteryVoltage!.value).toBe(11.2);
  });
});

describe("buildShiftReport(): DTC detection", () => {
  it("detects DTCs from active_dtc_count + spn/fmi fields", () => {
    const points = [
      makePoint("2026-04-08T14:00:00Z", {
        engine_rpm: 1200, vehicle_speed_mph: 30, coolant_temp_f: 195,
        oil_temp_f: 210, battery_voltage_v: 13.8, gps_latitude: 0, gps_longitude: 0,
        active_dtc_count: 2,
        dtc_0_spn: 520, dtc_0_fmi: 4,
        dtc_1_spn: 3251, dtc_1_fmi: 2,
      }),
    ];

    const report = buildShiftReport([], points, "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), false, "America/New_York");
    expect(report.dtcEvents).toHaveLength(2);
    expect(report.dtcEvents[0].code).toBe("SPN 520 FMI 4");
    expect(report.dtcEvents[1].code).toBe("SPN 3251 FMI 2");
  });

  it("deduplicates repeated DTCs", () => {
    const points = [
      makePoint("2026-04-08T14:00:00Z", { engine_rpm: 1200, vehicle_speed_mph: 30, coolant_temp_f: 195, oil_temp_f: 0, battery_voltage_v: 0, gps_latitude: 0, gps_longitude: 0, active_dtc_count: 1, dtc_0_spn: 520, dtc_0_fmi: 4 }),
      makePoint("2026-04-08T14:01:00Z", { engine_rpm: 1200, vehicle_speed_mph: 30, coolant_temp_f: 195, oil_temp_f: 0, battery_voltage_v: 0, gps_latitude: 0, gps_longitude: 0, active_dtc_count: 1, dtc_0_spn: 520, dtc_0_fmi: 4 }),
      makePoint("2026-04-08T14:02:00Z", { engine_rpm: 1200, vehicle_speed_mph: 30, coolant_temp_f: 195, oil_temp_f: 0, battery_voltage_v: 0, gps_latitude: 0, gps_longitude: 0, active_dtc_count: 1, dtc_0_spn: 520, dtc_0_fmi: 4 }),
    ];

    const report = buildShiftReport([], points, "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), false, "America/New_York");
    expect(report.dtcEvents).toHaveLength(1);
  });
});

describe("buildShiftReport(): Data quality warnings", () => {
  it("warns when no truck data", () => {
    const report = buildShiftReport([], [], "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), false, "America/New_York");
    expect(report.dataQuality.length).toBeGreaterThan(0);
    expect(report.dataQuality.some(w => w.section === "Truck")).toBe(true);
  });

  it("warns when sparse truck data (< 60 points)", () => {
    const truckData = generateTruckData("2026-04-08T14:00:00Z", 30);
    const report = buildShiftReport([], truckData, "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), false, "America/New_York");
    expect(report.dataQuality.some(w => w.message.includes("incomplete"))).toBe(true);
  });

  it("warns when no GPS data", () => {
    const truckData = generateTruckData("2026-04-08T14:00:00Z", 120, {
      gps_latitude: 0, gps_longitude: 0,
    });
    const report = buildShiftReport([], truckData, "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), false, "America/New_York");
    expect(report.dataQuality.some(w => w.section === "GPS")).toBe(true);
  });

  it("warns about no TPS data (info level)", () => {
    const truckData = generateTruckData("2026-04-08T14:00:00Z", 120);
    const report = buildShiftReport([], truckData, "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), false, "America/New_York");
    const tpsWarning = report.dataQuality.find(w => w.section === "TPS");
    expect(tpsWarning).toBeDefined();
    expect(tpsWarning!.severity).toBe("info");
  });

  it("no warnings for healthy dataset", () => {
    const truckData = generateTruckData("2026-04-08T14:00:00Z", 3600);
    const tpsData = generateTruckData("2026-04-08T14:00:00Z", 3600);
    const report = buildShiftReport(tpsData, truckData, "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), false, "America/New_York");
    // Should only have TPS "info" since TPS doesn't have plate_drop_count
    const warnings = report.dataQuality.filter(w => w.severity === "warning");
    expect(warnings.length).toBe(0);
  });
});

describe("buildShiftReport(): Alerts", () => {
  it("generates critical alert for coolant > 240F", () => {
    const points = [
      makePoint("2026-04-08T14:00:00Z", { engine_rpm: 1200, vehicle_speed_mph: 30, coolant_temp_f: 250, oil_temp_f: 0, battery_voltage_v: 13.8, gps_latitude: 0, gps_longitude: 0, active_dtc_count: 0 }),
    ];
    const report = buildShiftReport([], points, "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), false, "America/New_York");
    const coolantAlert = report.alerts.find(a => a.message.includes("Coolant"));
    expect(coolantAlert).toBeDefined();
    expect(coolantAlert!.level).toBe("critical");
  });

  it("generates warning alert for battery < 12V", () => {
    const points = [
      makePoint("2026-04-08T14:00:00Z", { engine_rpm: 1200, vehicle_speed_mph: 30, coolant_temp_f: 195, oil_temp_f: 0, battery_voltage_v: 11.5, gps_latitude: 0, gps_longitude: 0, active_dtc_count: 0 }),
    ];
    const report = buildShiftReport([], points, "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), false, "America/New_York");
    const battAlert = report.alerts.find(a => a.message.includes("Battery"));
    expect(battAlert).toBeDefined();
    expect(battAlert!.level).toBe("warning");
  });
});

describe("buildShiftReport(): Debug data", () => {
  it("includes debug data when requested", () => {
    const truckData = generateTruckData("2026-04-08T14:00:00Z", 120);
    const report = buildShiftReport([], truckData, "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), true, "America/New_York");
    expect(report._debug).toBeDefined();
    expect(report._debug!.rawTruckPoints).toBe(120);
    expect(report._debug!.rpmGtZeroCount).toBe(120);
  });

  it("omits debug data when not requested", () => {
    const truckData = generateTruckData("2026-04-08T14:00:00Z", 60);
    const report = buildShiftReport([], truckData, "2026-04-08", new Date("2026-04-08T14:00:00Z"), new Date("2026-04-08T18:00:00Z"), false, "America/New_York");
    expect(report._debug).toBeUndefined();
  });
});
