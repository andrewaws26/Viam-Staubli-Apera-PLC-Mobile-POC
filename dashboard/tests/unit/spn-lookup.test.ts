/**
 * SPN/FMI Lookup Table Tests
 *
 * Tests the J1939 SPN (Suspect Parameter Number) and FMI (Failure Mode
 * Identifier) lookup tables and functions used throughout the dashboard.
 *
 * WHY THIS MATTERS:
 * The SPN lookup is used by: DTCPanel (DTC display), DTCTimeline (history),
 * AIChatPanel (AI prompt injection via formatDTCHistoryForAI), and the
 * AI diagnostic endpoints. If a lookup returns garbage, mechanics see
 * "Unknown" instead of "Engine Coolant Temperature" on their dashboard.
 *
 * WHAT TO ADD:
 * When you add new SPNs to spn-lookup.ts, add them to the
 * CRITICAL_SPNS or AFTERTREATMENT_SPNS arrays below to verify they
 * resolve correctly. If you see an SPN come through from a truck that
 * returns "Unknown", add it to the lookup table AND add a test here.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/spn-lookup.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  lookupSPN,
  lookupFMI,
  SPN_LOOKUP,
  FMI_DESCRIPTIONS,
  type _SPNInfo,
} from "@/lib/spn-lookup";

// ── SPN Lookup Function Tests ─────────────────────────────────────

describe("lookupSPN", () => {
  it("returns correct info for known SPN (110 = Engine Coolant Temperature)", () => {
    const result = lookupSPN(110);
    expect(result.name).toBe("Engine Coolant Temperature");
    expect(result.severity).toBe("critical");
    expect(result.fix).toBeTruthy();
    expect(result.description).toBeTruthy();
  });

  it("returns fallback for unknown SPN", () => {
    const result = lookupSPN(99999);
    expect(result.name).toBe("SPN 99999");
    expect(result.description).toContain("Unknown");
    expect(result.severity).toBe("warning");
  });

  it("returns fallback for SPN 0", () => {
    const result = lookupSPN(0);
    expect(result.name).toBe("SPN 0");
  });

  it("returns fallback for negative SPN", () => {
    const result = lookupSPN(-1);
    expect(result.name).toBe("SPN -1");
  });
});

// ── FMI Lookup Function Tests ─────────────────────────────────────

describe("lookupFMI", () => {
  it("returns correct description for FMI 0", () => {
    expect(lookupFMI(0)).toBe("Data valid but above normal range");
  });

  it("returns correct description for FMI 18 (common aftertreatment FMI)", () => {
    expect(lookupFMI(18)).toBe("Data valid but below normal — moderately severe");
  });

  it("returns correct description for FMI 31 (condition exists)", () => {
    expect(lookupFMI(31)).toBe("Condition exists");
  });

  it("returns fallback for unknown FMI", () => {
    const result = lookupFMI(99);
    expect(result).toContain("Unknown failure mode");
    expect(result).toContain("99");
  });
});

// ── Critical SPN Coverage Tests ───────────────────────────────────
// These SPNs appear frequently on the B&B Metals fleet trucks.
// If any of these are missing from the lookup table, it's a regression.

const CRITICAL_SPNS: { spn: number; expectedName: string }[] = [
  { spn: 100, expectedName: "Engine Oil Pressure" },
  { spn: 110, expectedName: "Engine Coolant Temperature" },
  { spn: 190, expectedName: "Engine Speed" },
  { spn: 168, expectedName: "Battery Potential" },
  { spn: 175, expectedName: "Engine Oil Temperature" },
  { spn: 102, expectedName: "Boost Pressure" },
  { spn: 84, expectedName: "Vehicle Speed" },
  { spn: 91, expectedName: "Accelerator Pedal Position" },
  { spn: 92, expectedName: "Engine Load" },
  { spn: 96, expectedName: "Fuel Level" },
  { spn: 157, expectedName: "Injector Timing Rail Pressure" },
  { spn: 625, expectedName: "CAN Bus Error (J1939)" },
  { spn: 629, expectedName: "ECU Internal" },
  { spn: 630, expectedName: "ECU Power Supply" },
];

describe("critical engine SPNs are all present", () => {
  for (const { spn, expectedName } of CRITICAL_SPNS) {
    it(`SPN ${spn} = ${expectedName}`, () => {
      const result = lookupSPN(spn);
      expect(result.name).toBe(expectedName);
    });
  }
});

// ── Aftertreatment SPN Coverage Tests ─────────────────────────────
// These are the SPNs that show up during emissions/SCR/DPF/DEF issues.
// The Mack Granite SCR failure (2026-04-03) involved several of these.
// Missing coverage here means the AI won't get human-readable DTC names.

const AFTERTREATMENT_SPNS: { spn: number; expectedName: string }[] = [
  { spn: 1569, expectedName: "DPF Outlet Temperature" },
  { spn: 1761, expectedName: "DPF Differential Pressure" },
  { spn: 2631, expectedName: "DPF Active Regen" },
  { spn: 3216, expectedName: "AFT SCR Conversion" },
  { spn: 3226, expectedName: "AFT DEF Tank Level" },
  { spn: 3230, expectedName: "AFT SCR Intake NOx" },
  { spn: 3242, expectedName: "AFT DEF Quality" },
  { spn: 3246, expectedName: "AFT DEF Dosing" },
  { spn: 3251, expectedName: "AFT SCR Outlet NOx" },
  { spn: 3362, expectedName: "AFT DPF Inlet Temperature" },
  { spn: 3556, expectedName: "AFT DEF Tank Temperature" },
  { spn: 3719, expectedName: "AFT DEF Pump Pressure" },
  { spn: 3936, expectedName: "AFT DPF Soot Load" },
  { spn: 4094, expectedName: "NOx Level Exceeded" },
  { spn: 4360, expectedName: "DEF Tank Empty/Low" },
  { spn: 4363, expectedName: "DEF Quality Non-Compliant" },
  { spn: 4365, expectedName: "AT Severe Derate - 5 MPH" },
  { spn: 5394, expectedName: "SCR Conversion Efficiency" },
  { spn: 5397, expectedName: "SCR Catalyst Temp" },
];

describe("aftertreatment SPNs are all present", () => {
  for (const { spn, expectedName } of AFTERTREATMENT_SPNS) {
    it(`SPN ${spn} = ${expectedName}`, () => {
      const result = lookupSPN(spn);
      expect(result.name).toBe(expectedName);
    });
  }
});

// ── Injector SPN Coverage Tests ───────────────────────────────────
// SPNs 651-656 cover cylinders 1-6. All must be present for a 6-cylinder
// engine (Mack MP8 is an inline-6).

describe("injector SPNs cover all 6 cylinders", () => {
  for (let cyl = 1; cyl <= 6; cyl++) {
    const spn = 650 + cyl;
    it(`SPN ${spn} = Injector Cylinder ${cyl}`, () => {
      const result = lookupSPN(spn);
      expect(result.name).toBe(`Injector Cylinder ${cyl}`);
      expect(result.severity).toBe("critical");
    });
  }
});

// ── SPN Data Integrity Tests ──────────────────────────────────────

describe("SPN_LOOKUP data integrity", () => {
  it("has at least 200 entries", () => {
    const count = Object.keys(SPN_LOOKUP).length;
    expect(count).toBeGreaterThanOrEqual(200);
  });

  it("all entries have required fields", () => {
    for (const [spnStr, info] of Object.entries(SPN_LOOKUP)) {
      expect(info.name, `SPN ${spnStr} missing name`).toBeTruthy();
      expect(info.description, `SPN ${spnStr} missing description`).toBeTruthy();
      expect(info.fix, `SPN ${spnStr} missing fix`).toBeTruthy();
      expect(
        ["info", "warning", "critical"].includes(info.severity),
        `SPN ${spnStr} has invalid severity: ${info.severity}`
      ).toBe(true);
    }
  });

  it("all SPN keys are valid positive integers", () => {
    for (const key of Object.keys(SPN_LOOKUP)) {
      const num = Number(key);
      expect(Number.isInteger(num), `SPN key "${key}" is not an integer`).toBe(true);
      expect(num, `SPN key "${key}" is not positive`).toBeGreaterThan(0);
    }
  });

  it("has no duplicate SPN names (catches copy-paste errors)", () => {
    const names = new Map<string, number>();
    for (const [spnStr, info] of Object.entries(SPN_LOOKUP)) {
      const existing = names.get(info.name);
      if (existing !== undefined) {
        // Allow some known duplicates (e.g., alternate turbo speed params)
        const isKnownDup =
          (info.name.includes("Turbo Speed") || info.name.includes("Alt")) ||
          (info.name === "Crankcase Pressure"); // SPN 611 and 976
        if (!isKnownDup) {
          expect.fail(
            `SPN ${spnStr} ("${info.name}") duplicates SPN ${existing}`
          );
        }
      }
      names.set(info.name, Number(spnStr));
    }
  });
});

// ── FMI Data Integrity Tests ──────────────────────────────────────

describe("FMI_DESCRIPTIONS data integrity", () => {
  it("covers standard FMI range 0-14", () => {
    for (let fmi = 0; fmi <= 14; fmi++) {
      expect(
        FMI_DESCRIPTIONS[fmi],
        `FMI ${fmi} is missing from FMI_DESCRIPTIONS`
      ).toBeTruthy();
    }
  });

  it("covers extended FMI range 15-21", () => {
    for (let fmi = 15; fmi <= 21; fmi++) {
      expect(
        FMI_DESCRIPTIONS[fmi],
        `FMI ${fmi} is missing from FMI_DESCRIPTIONS`
      ).toBeTruthy();
    }
  });

  it("includes FMI 31 (condition exists)", () => {
    expect(FMI_DESCRIPTIONS[31]).toBe("Condition exists");
  });

  it("all descriptions are non-empty strings", () => {
    for (const [fmi, desc] of Object.entries(FMI_DESCRIPTIONS)) {
      expect(typeof desc).toBe("string");
      expect(desc.length, `FMI ${fmi} has empty description`).toBeGreaterThan(0);
    }
  });
});
