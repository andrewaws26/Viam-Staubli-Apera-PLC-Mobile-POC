/**
 * AI Diagnostics Pre-Processing Tests
 *
 * Tests the automated diagnostic pattern detection that runs BEFORE
 * readings are sent to Claude. These patterns guide the AI toward
 * correct root-cause analysis instead of generic responses.
 *
 * WHY THIS MATTERS:
 * The diagnostics layer (lib/ai-diagnostics.ts) is the bridge between
 * raw CAN bus data and AI understanding. If a pattern detector is broken,
 * Claude won't get the pre-processed chain analysis and may miss critical
 * cascading failures (e.g., SCR temp → DEF dosing → efficiency collapse).
 *
 * WHAT TO ADD:
 * When you add a new pattern detector to ai-diagnostics.ts, add a test
 * here that verifies: (1) it fires on matching data, (2) it stays silent
 * on non-matching data, (3) it has the correct severity.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/ai-diagnostics.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  runDiagnostics,
  formatDiagnosticNotes,
  type DiagnosticNote,
} from "@/lib/ai-diagnostics";

// ── Test Data Factories ───────────────────────────────────────────
// These create realistic readings matching specific truck conditions.
// Each factory is named after the real-world scenario it represents.

/** Healthy running truck — no faults, all signals present */
function healthyTruckReadings(): Record<string, unknown> {
  return {
    engine_rpm: 1200,
    coolant_temp_f: 195,
    oil_temp_f: 210,
    vehicle_speed_mph: 45,
    battery_voltage: 14.2,
    oil_pressure_psi: 55,
    scr_catalyst_temp_f: 450,
    scr_efficiency_pct: 92,
    def_dose_rate_gs: 3.5,
    def_dose_commanded_gs: 3.5,
    def_level_pct: 65,
    def_level_ecm_pct: 64,
    dpf_soot_load_pct: 35,
    dpf_outlet_temp_f: 380,
    active_dtc_count: 0,
    protect_lamp_engine: 0,
    protect_lamp_acm: 0,
    red_stop_lamp_engine: 0,
    red_stop_lamp_acm: 0,
    malfunction_lamp: 0,
    nox_inlet_power_ok: true,
    nox_inlet_at_temp: true,
    nox_inlet_reading_stable: true,
    nox_outlet_power_ok: true,
    nox_outlet_at_temp: true,
    nox_outlet_reading_stable: true,
  };
}

/**
 * 2024 Mack Granite SCR failure — the exact condition found on 2026-04-03.
 * SCR temp sensor signal missing → DEF dosing disabled → efficiency collapse.
 * This is the primary cascade this system was built to detect.
 */
function mackGraniteScrFailure(): Record<string, unknown> {
  return {
    engine_rpm: 800,
    coolant_temp_f: 190,
    scr_catalyst_temp_f: null,      // NO SIGNAL — root cause
    scr_efficiency_pct: 28,         // Collapsed due to no dosing
    def_dose_rate_gs: null,         // Disabled — can't verify catalyst temp
    def_dose_commanded_gs: null,    // ECU won't command dosing without temp
    def_level_pct: 57.6,           // ACM sees DEF fine
    def_level_ecm_pct: null,       // ECM can't see DEF — secondary issue
    dpf_soot_load_pct: 45,
    protect_lamp_engine: 1,
    protect_lamp_acm: 1,
    red_stop_lamp_engine: 0,
    red_stop_lamp_acm: 0,
    active_dtc_count: 0,           // DTCs cleared but lamps persist
    epa_inducement_level: 1,       // Stage 1 — Protect Lamp only
  };
}

/** Engine off — parked truck with no running data */
function engineOffReadings(): Record<string, unknown> {
  return {
    engine_rpm: 0,
    coolant_temp_f: 85,
    vehicle_speed_mph: 0,
    battery_voltage: 12.6,
    active_dtc_count: 0,
  };
}

// ── SCR Temperature Chain Tests ───────────────────────────────────

describe("SCR temp sensor chain failure detection", () => {
  it("detects full cascade: no temp → no dosing → low efficiency", () => {
    const readings = mackGraniteScrFailure();
    const notes = runDiagnostics(readings);

    const cascade = notes.find(
      (n) => n.category === "AFTERTREATMENT CASCADE"
    );
    expect(cascade).toBeDefined();
    expect(cascade!.severity).toBe("critical");
    expect(cascade!.detail).toContain("28%");
    expect(cascade!.physical_check).toContain("SCR exhaust temp sensor");
  });

  it("warns about missing SCR temp even without full cascade", () => {
    const readings = healthyTruckReadings();
    readings.scr_catalyst_temp_f = null; // Only temp missing, dosing still OK
    readings.def_dose_rate_gs = 3.0;
    readings.scr_efficiency_pct = 85;

    const notes = runDiagnostics(readings);
    const warning = notes.find(
      (n) => n.category === "AFTERTREATMENT" && n.title.includes("not reporting")
    );
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe("warning");
  });

  it("stays silent when SCR temp is present and healthy", () => {
    const notes = runDiagnostics(healthyTruckReadings());
    const scrNotes = notes.filter(
      (n) =>
        n.category === "AFTERTREATMENT CASCADE" ||
        (n.category === "AFTERTREATMENT" && n.title.includes("SCR"))
    );
    expect(scrNotes).toHaveLength(0);
  });
});

// ── DEF Dosing Tests ──────────────────────────────────────────────

describe("DEF dosing system detection", () => {
  it("detects dosing inactive when SCR temp is present (non-temp cause)", () => {
    const readings = healthyTruckReadings();
    readings.def_dose_rate_gs = 0;
    readings.def_dose_commanded_gs = 0;

    const notes = runDiagnostics(readings);
    const dosing = notes.find(
      (n) => n.title.includes("dosing system inactive")
    );
    expect(dosing).toBeDefined();
    expect(dosing!.detail).toContain("not a missing temp signal");
  });

  it("skips dosing check when engine is off (RPM < 300)", () => {
    const readings = engineOffReadings();
    readings.scr_catalyst_temp_f = 100;
    readings.def_dose_rate_gs = 0;
    readings.def_dose_commanded_gs = 0;

    const notes = runDiagnostics(readings);
    const dosing = notes.filter((n) =>
      n.title.includes("dosing system inactive")
    );
    expect(dosing).toHaveLength(0);
  });
});

// ── EPA Inducement Tests ──────────────────────────────────────────

describe("EPA inducement stage detection", () => {
  it("detects Stage 1 as warning", () => {
    const readings = { epa_inducement_level: 1 };
    const notes = runDiagnostics(readings);
    const epa = notes.find((n) => n.category === "EPA INDUCEMENT");
    expect(epa).toBeDefined();
    expect(epa!.severity).toBe("warning");
    expect(epa!.title).toContain("Stage 1");
  });

  it("detects Stage 2 as critical (5 mph derate)", () => {
    const readings = { epa_inducement_level: 2 };
    const notes = runDiagnostics(readings);
    const epa = notes.find((n) => n.category === "EPA INDUCEMENT");
    expect(epa).toBeDefined();
    expect(epa!.severity).toBe("critical");
  });

  it("detects Stage 3 as critical (idle-only)", () => {
    const readings = { epa_inducement_level: 3 };
    const notes = runDiagnostics(readings);
    const epa = notes.find((n) => n.category === "EPA INDUCEMENT");
    expect(epa!.severity).toBe("critical");
  });

  it("stays silent when no inducement (level 0)", () => {
    const readings = { epa_inducement_level: 0 };
    const notes = runDiagnostics(readings);
    expect(notes.filter((n) => n.category === "EPA INDUCEMENT")).toHaveLength(0);
  });
});

// ── Per-ECU Lamp Correlation Tests ────────────────────────────────

describe("per-ECU lamp correlation", () => {
  it("detects Protect Lamp from both ECUs with zero DTCs", () => {
    const readings = mackGraniteScrFailure();
    const notes = runDiagnostics(readings);
    const lamp = notes.find(
      (n) => n.category === "ECU CORRELATION" && n.title.includes("ZERO stored DTCs")
    );
    expect(lamp).toBeDefined();
    expect(lamp!.severity).toBe("critical");
    expect(lamp!.detail).toContain("reasserts the lamp immediately");
  });

  it("narrows to ACM-only when engine ECM is clear", () => {
    const readings = healthyTruckReadings();
    readings.protect_lamp_engine = 0;
    readings.protect_lamp_acm = 1;
    readings.active_dtc_count = 1;

    const notes = runDiagnostics(readings);
    const acm = notes.find(
      (n) => n.title.includes("ACM only")
    );
    expect(acm).toBeDefined();
    expect(acm!.detail).toContain("aftertreatment system specifically");
  });

  it("narrows to Engine ECM-only", () => {
    const readings = healthyTruckReadings();
    readings.protect_lamp_engine = 1;
    readings.protect_lamp_acm = 0;
    readings.active_dtc_count = 1;

    const notes = runDiagnostics(readings);
    const ecm = notes.find(
      (n) => n.title.includes("Engine ECM only")
    );
    expect(ecm).toBeDefined();
    expect(ecm!.detail).toContain("engine-side protection");
  });

  it("flags red stop lamp as critical", () => {
    const readings = healthyTruckReadings();
    readings.red_stop_lamp_engine = 1;

    const notes = runDiagnostics(readings);
    const red = notes.find((n) => n.title.includes("RED STOP LAMP"));
    expect(red).toBeDefined();
    expect(red!.severity).toBe("critical");
  });
});

// ── Cross-ECU Discrepancy Tests ───────────────────────────────────

describe("cross-ECU discrepancies", () => {
  it("detects ECM missing DEF level that ACM reports", () => {
    const readings = healthyTruckReadings();
    readings.def_level_pct = 57.6;
    readings.def_level_ecm_pct = null;

    const notes = runDiagnostics(readings);
    const disc = notes.find((n) => n.category === "CROSS-ECU");
    expect(disc).toBeDefined();
    expect(disc!.detail).toContain("57.6%");
    expect(disc!.severity).toBe("info");
  });

  it("warns on large DEF level mismatch between ECUs", () => {
    const readings = healthyTruckReadings();
    readings.def_level_pct = 60;
    readings.def_level_ecm_pct = 40; // 20% difference

    const notes = runDiagnostics(readings);
    const disc = notes.find(
      (n) => n.category === "CROSS-ECU" && n.title.includes("mismatch")
    );
    expect(disc).toBeDefined();
    expect(disc!.severity).toBe("warning");
  });
});

// ── DPF Soot Load Tests ──────────────────────────────────────────

describe("DPF soot load detection", () => {
  it("flags critical above 90%", () => {
    const readings = { dpf_soot_load_pct: 92 };
    const notes = runDiagnostics(readings);
    const dpf = notes.find((n) => n.category === "DPF");
    expect(dpf).toBeDefined();
    expect(dpf!.severity).toBe("critical");
    expect(dpf!.detail).toContain("forced regen");
  });

  it("flags warning at 80-90%", () => {
    const readings = { dpf_soot_load_pct: 85 };
    const notes = runDiagnostics(readings);
    const dpf = notes.find((n) => n.category === "DPF");
    expect(dpf!.severity).toBe("warning");
  });

  it("flags info at 70-80%", () => {
    const readings = { dpf_soot_load_pct: 75 };
    const notes = runDiagnostics(readings);
    const dpf = notes.find((n) => n.category === "DPF");
    expect(dpf!.severity).toBe("info");
  });

  it("stays silent below 70%", () => {
    const readings = { dpf_soot_load_pct: 35 };
    const notes = runDiagnostics(readings);
    expect(notes.filter((n) => n.category === "DPF")).toHaveLength(0);
  });
});

// ── NOx Sensor Status Tests ───────────────────────────────────────

describe("NOx sensor status detection", () => {
  it("detects inlet sensor power failure when engine is running", () => {
    const readings = healthyTruckReadings();
    readings.nox_inlet_power_ok = false;

    const notes = runDiagnostics(readings);
    const nox = notes.find(
      (n) => n.category === "NOX SENSOR" && n.title.includes("Intake")
    );
    expect(nox).toBeDefined();
    expect(nox!.detail).toContain("power");
  });

  it("detects multiple outlet sensor issues as warning", () => {
    const readings = healthyTruckReadings();
    readings.nox_outlet_power_ok = false;
    readings.nox_outlet_at_temp = false;

    const notes = runDiagnostics(readings);
    const nox = notes.find(
      (n) => n.category === "NOX SENSOR" && n.title.includes("Outlet")
    );
    expect(nox).toBeDefined();
    expect(nox!.severity).toBe("warning"); // 2+ issues = warning
  });

  it("skips NOx checks when engine is off", () => {
    const readings = engineOffReadings();
    readings.nox_inlet_power_ok = false;

    const notes = runDiagnostics(readings);
    expect(notes.filter((n) => n.category === "NOX SENSOR")).toHaveLength(0);
  });
});

// ── Missing Signal Detection Tests ────────────────────────────────

describe("missing signal detection", () => {
  it("reports selectively missing aftertreatment signals", () => {
    const readings = healthyTruckReadings();
    readings.scr_catalyst_temp_f = 450; // Present
    readings.def_dose_rate_gs = null;   // Missing
    readings.def_dose_commanded_gs = null; // Missing
    // Keep others present so it's a selective failure

    const notes = runDiagnostics(readings);
    const missing = notes.find((n) => n.category === "SIGNAL STATUS");
    expect(missing).toBeDefined();
    expect(missing!.detail).toContain("DEF Dose Rate");
  });
});

// ── Full Mack Granite Scenario ────────────────────────────────────

describe("full Mack Granite scenario (integration)", () => {
  it("produces the complete diagnostic picture for known failure", () => {
    const readings = mackGraniteScrFailure();
    const notes = runDiagnostics(readings);

    // Should detect: cascade, EPA inducement, both-ECU lamp, cross-ECU DEF
    const categories = notes.map((n) => n.category);
    expect(categories).toContain("AFTERTREATMENT CASCADE");
    expect(categories).toContain("EPA INDUCEMENT");
    expect(categories).toContain("ECU CORRELATION");
    expect(categories).toContain("CROSS-ECU");

    // Verify critical count — at least 2 (cascade + lamp correlation)
    const criticals = notes.filter((n) => n.severity === "critical");
    expect(criticals.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Format Output Tests ───────────────────────────────────────────

describe("formatDiagnosticNotes", () => {
  it("returns empty string for no notes", () => {
    expect(formatDiagnosticNotes([])).toBe("");
  });

  it("groups notes by severity with correct headers", () => {
    const notes: DiagnosticNote[] = [
      { severity: "critical", category: "TEST", title: "Crit", detail: "d1" },
      { severity: "warning", category: "TEST", title: "Warn", detail: "d2" },
      { severity: "info", category: "TEST", title: "Info", detail: "d3" },
    ];
    const text = formatDiagnosticNotes(notes);

    expect(text).toContain(">>> CRITICAL FINDINGS:");
    expect(text).toContain(">> WARNINGS:");
    expect(text).toContain("> INFO:");
    // Critical should come before warning in output
    expect(text.indexOf("CRITICAL")).toBeLessThan(text.indexOf("WARNINGS"));
  });

  it("includes physical check when present", () => {
    const notes: DiagnosticNote[] = [
      {
        severity: "critical",
        category: "T",
        title: "T",
        detail: "D",
        physical_check: "Check the connector",
      },
    ];
    const text = formatDiagnosticNotes(notes);
    expect(text).toContain("PHYSICAL CHECK NEEDED: Check the connector");
  });
});
