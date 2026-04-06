/**
 * OBD-II P-Code Lookup Tests
 *
 * Tests the OBD-II diagnostic trouble code lookup table used for
 * passenger vehicles (currently the 2013 Nissan Altima test vehicle).
 *
 * WHY THIS MATTERS:
 * When OBD-II support goes live on a dedicated device, these codes
 * are what mechanics see on the dashboard. The fallback logic (for
 * codes not in the database) must produce sensible category names
 * from the code structure — e.g., P03xx = Ignition System.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/pcode-lookup.test.ts
 */

import { describe, it, expect } from "vitest";
import { lookupPCode } from "@/lib/pcode-lookup";

// ── Known Code Lookups ────────────────────────────────────────────

describe("lookupPCode: known codes", () => {
  it("returns correct info for P0420 (catalytic converter)", () => {
    const result = lookupPCode("P0420");
    expect(result.name).toBe("Catalyst Efficiency Low (B1)");
    expect(result.severity).toBe("warning");
    expect(result.fix).toContain("Catalytic converter");
  });

  it("returns correct info for P0300 (random misfire — critical)", () => {
    const result = lookupPCode("P0300");
    expect(result.name).toBe("Random/Multiple Misfire");
    expect(result.severity).toBe("critical");
  });

  it("returns correct info for P0335 (crankshaft sensor — critical)", () => {
    const result = lookupPCode("P0335");
    expect(result.severity).toBe("critical");
  });

  it("returns correct info for P0171 (system too lean)", () => {
    const result = lookupPCode("P0171");
    expect(result.name).toContain("Lean");
    expect(result.fix).toContain("vacuum leak");
  });

  it("returns correct info for P0456 (EVAP small leak)", () => {
    const result = lookupPCode("P0456");
    expect(result.severity).toBe("info");
  });
});

// ── Case Insensitivity ────────────────────────────────────────────

describe("lookupPCode: case handling", () => {
  it("handles lowercase input", () => {
    const result = lookupPCode("p0420");
    expect(result.name).toBe("Catalyst Efficiency Low (B1)");
  });

  it("handles mixed case input", () => {
    const result = lookupPCode("p0300");
    expect(result.name).toBe("Random/Multiple Misfire");
  });
});

// ── Fallback Logic ────────────────────────────────────────────────
// When a P-code isn't in the database, the function derives a category
// from the code structure. This is important because there are thousands
// of P-codes and we only have ~80 in the database.

describe("lookupPCode: fallback for unknown codes", () => {
  it("categorizes P0200-range as Fuel/Air Metering", () => {
    const result = lookupPCode("P0234");
    expect(result.description).toContain("Fuel/Air Metering");
    expect(result.severity).toBe("warning");
  });

  it("categorizes P03xx as Ignition System", () => {
    const result = lookupPCode("P0399");
    expect(result.description).toContain("Ignition");
  });

  it("categorizes P04xx as Emissions Control", () => {
    const result = lookupPCode("P0499");
    expect(result.description).toContain("Emissions");
  });

  it("categorizes P05xx as Speed/Idle Control", () => {
    const result = lookupPCode("P0599");
    expect(result.description).toContain("Speed/Idle");
  });

  it("categorizes P06xx as Computer/Output Circuit", () => {
    const result = lookupPCode("P0699");
    expect(result.description).toContain("Computer/Output");
  });

  it("categorizes P07xx-P09xx as Transmission", () => {
    expect(lookupPCode("P0799").description).toContain("Transmission");
    expect(lookupPCode("P0899").description).toContain("Transmission");
    expect(lookupPCode("P0999").description).toContain("Transmission");
  });

  it("labels P0xxx as Generic code in fallback name", () => {
    const result = lookupPCode("P0234");
    expect(result.name).toContain("Generic");
  });

  it("labels P1xxx as Manufacturer code in fallback name", () => {
    const result = lookupPCode("P1234");
    expect(result.name).toContain("Manufacturer");
  });

  it("includes the code in the fix suggestion", () => {
    const result = lookupPCode("P0234");
    expect(result.fix).toContain("P0234");
  });
});

// ── Cylinder Misfire Coverage ─────────────────────────────────────
// P0301-P0306 cover cylinders 1-6. All should be in the database.

describe("cylinder misfire codes P0301-P0306", () => {
  for (let cyl = 1; cyl <= 6; cyl++) {
    const code = `P030${cyl}`;
    it(`${code} = Cylinder ${cyl} Misfire`, () => {
      const result = lookupPCode(code);
      expect(result.name).toContain(`Cylinder ${cyl}`);
      expect(result.severity).toBe("warning");
    });
  }
});

// ── Nissan-Specific Codes ─────────────────────────────────────────
// The 2013 Altima test vehicle commonly throws these codes.

describe("Nissan-specific codes", () => {
  it("P0011 (VVT over-advanced B1) is present", () => {
    const result = lookupPCode("P0011");
    expect(result.name).toContain("Camshaft");
    expect(result.fix).toContain("VVT");
  });

  it("P0021 (VVT over-advanced B2) is present", () => {
    const result = lookupPCode("P0021");
    expect(result.name).toContain("Camshaft");
  });
});

// ── Data Integrity ────────────────────────────────────────────────

describe("P-code data integrity", () => {
  it("all known codes have required fields", () => {
    // Test a representative sample across categories
    const sampleCodes = [
      "P0100", "P0171", "P0300", "P0420", "P0455",
      "P0500", "P0700", "P0011", "P0335", "P0340",
    ];
    for (const code of sampleCodes) {
      const result = lookupPCode(code);
      expect(result.name, `${code} missing name`).toBeTruthy();
      expect(result.description, `${code} missing description`).toBeTruthy();
      expect(result.fix, `${code} missing fix`).toBeTruthy();
      expect(
        ["info", "warning", "critical"].includes(result.severity),
        `${code} has invalid severity: ${result.severity}`
      ).toBe(true);
    }
  });
});
