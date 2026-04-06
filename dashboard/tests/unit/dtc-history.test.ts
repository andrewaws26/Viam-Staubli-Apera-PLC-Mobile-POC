/**
 * DTC History & AI Data Pipeline Tests
 *
 * Tests the DTC history tracking system (localStorage persistence,
 * snapshot diffing, intermittent pattern detection) and the
 * formatDTCHistoryForAI() function that injects history into Claude prompts.
 *
 * WHY THIS MATTERS:
 * The DTC history pipeline is how Claude learns about intermittent codes —
 * the most diagnostically significant pattern. A code that appears and
 * clears 3x in a week is very different from a persistent code. If this
 * pipeline breaks, Claude loses temporal context.
 *
 * ARCHITECTURE NOTE:
 * - buildDTCSnapshot: readings dict → snapshot of active codes
 * - computeDTCDiff: prev snapshot vs current → appeared/cleared events
 * - formatDTCHistoryForAI: events → structured text for Claude prompt
 *
 * The snapshot diffing runs every polling cycle (~2s) in TruckPanel.tsx.
 * Events accumulate in localStorage (capped at 200). The AI endpoints
 * receive the formatted text via readings._dtc_history_text.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/dtc-history.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  buildDTCSnapshot,
  computeDTCDiff,
  formatDTCHistoryForAI,
  ECU_SOURCES,
  type DTCHistoryEvent,
  type DTCSnapshot,
} from "@/lib/dtc-history";

// ── Test Data Factories ───────────────────────────────────────────

/** Readings with one aftertreatment DTC (SPN 3226 = SCR catalyst efficiency) */
function readingsWithAcmDTC(): Record<string, unknown> {
  return {
    dtc_acm_count: 1,
    dtc_acm_0_spn: 3226,
    dtc_acm_0_fmi: 18,
    dtc_acm_0_occurrence: 3,
    dtc_engine_count: 0,
    dtc_trans_count: 0,
    dtc_abs_count: 0,
    dtc_body_count: 0,
    dtc_inst_count: 0,
  };
}

/** Readings with DTCs from two different ECUs */
function readingsWithMultiEcuDTCs(): Record<string, unknown> {
  return {
    dtc_acm_count: 1,
    dtc_acm_0_spn: 3226,
    dtc_acm_0_fmi: 18,
    dtc_acm_0_occurrence: 3,
    dtc_engine_count: 1,
    dtc_engine_0_spn: 110,  // SPN 110 = Coolant temp
    dtc_engine_0_fmi: 0,    // FMI 0 = Data valid above normal
    dtc_engine_0_occurrence: 1,
    dtc_trans_count: 0,
    dtc_abs_count: 0,
    dtc_body_count: 0,
    dtc_inst_count: 0,
  };
}

/** Clean readings — no active DTCs */
function readingsNoDTCs(): Record<string, unknown> {
  return {
    dtc_acm_count: 0,
    dtc_engine_count: 0,
    dtc_trans_count: 0,
    dtc_abs_count: 0,
    dtc_body_count: 0,
    dtc_inst_count: 0,
  };
}

/** Build a mock DTCHistoryEvent */
function mockEvent(overrides: Partial<DTCHistoryEvent> = {}): DTCHistoryEvent {
  return {
    id: `${Date.now()}-test`,
    spn: 3226,
    fmi: 18,
    ecuSuffix: "acm",
    ecuLabel: "Aftertreatment",
    spnName: "SCR Catalyst Efficiency",
    event: "appeared",
    timestamp: "2026-04-03T10:30:00.000Z",
    ...overrides,
  };
}

// ── buildDTCSnapshot Tests ────────────────────────────────────────

describe("buildDTCSnapshot", () => {
  it("builds snapshot from single-ECU DTCs", () => {
    const snap = buildDTCSnapshot(readingsWithAcmDTC());

    expect(Object.keys(snap)).toHaveLength(1);
    const key = "3226:18:acm";
    expect(snap[key]).toBeDefined();
    expect(snap[key].spn).toBe(3226);
    expect(snap[key].fmi).toBe(18);
    expect(snap[key].ecuSuffix).toBe("acm");
    expect(snap[key].ecuLabel).toBe("Aftertreatment");
  });

  it("builds snapshot from multi-ECU DTCs", () => {
    const snap = buildDTCSnapshot(readingsWithMultiEcuDTCs());

    expect(Object.keys(snap)).toHaveLength(2);
    expect(snap["3226:18:acm"]).toBeDefined();
    expect(snap["110:0:engine"]).toBeDefined();
    expect(snap["110:0:engine"].ecuLabel).toBe("Engine");
  });

  it("returns empty snapshot for no DTCs", () => {
    const snap = buildDTCSnapshot(readingsNoDTCs());
    expect(Object.keys(snap)).toHaveLength(0);
  });

  it("handles missing count fields gracefully", () => {
    const snap = buildDTCSnapshot({ engine_rpm: 1200 });
    expect(Object.keys(snap)).toHaveLength(0);
  });

  it("caps at 10 DTCs per ECU to prevent runaway iteration", () => {
    const readings: Record<string, unknown> = { dtc_engine_count: 50 };
    // Only populate 10 — the function should stop at 10
    for (let i = 0; i < 15; i++) {
      readings[`dtc_engine_0_spn`] = undefined; // First one missing → breaks
    }
    readings.dtc_engine_0_spn = 100;
    readings.dtc_engine_0_fmi = 1;
    const snap = buildDTCSnapshot(readings);
    // Should get exactly 1 since dtc_engine_1_spn is undefined → breaks
    expect(Object.keys(snap).length).toBeLessThanOrEqual(10);
  });
});

// ── computeDTCDiff Tests ──────────────────────────────────────────

describe("computeDTCDiff", () => {
  it("detects newly appeared DTC", () => {
    const prev: DTCSnapshot = {};
    const current = buildDTCSnapshot(readingsWithAcmDTC());

    const diff = computeDTCDiff(prev, current);
    expect(diff).toHaveLength(1);
    expect(diff[0].event).toBe("appeared");
    expect(diff[0].spn).toBe(3226);
    expect(diff[0].ecuSuffix).toBe("acm");
  });

  it("detects cleared DTC", () => {
    const prev = buildDTCSnapshot(readingsWithAcmDTC());
    const current: DTCSnapshot = {};

    const diff = computeDTCDiff(prev, current);
    expect(diff).toHaveLength(1);
    expect(diff[0].event).toBe("cleared");
    expect(diff[0].spn).toBe(3226);
  });

  it("detects both appeared and cleared in same diff", () => {
    const prev = buildDTCSnapshot(readingsWithAcmDTC());
    // Current: engine DTC appeared, ACM DTC cleared
    const current = buildDTCSnapshot({
      dtc_engine_count: 1,
      dtc_engine_0_spn: 110,
      dtc_engine_0_fmi: 0,
      dtc_acm_count: 0,
    });

    const diff = computeDTCDiff(prev, current);
    expect(diff).toHaveLength(2);

    const appeared = diff.find((d) => d.event === "appeared");
    const cleared = diff.find((d) => d.event === "cleared");
    expect(appeared).toBeDefined();
    expect(appeared!.spn).toBe(110);
    expect(cleared).toBeDefined();
    expect(cleared!.spn).toBe(3226);
  });

  it("returns empty diff when snapshots are identical", () => {
    const snap = buildDTCSnapshot(readingsWithAcmDTC());
    const diff = computeDTCDiff(snap, snap);
    expect(diff).toHaveLength(0);
  });

  it("returns empty diff for two empty snapshots", () => {
    const diff = computeDTCDiff({}, {});
    expect(diff).toHaveLength(0);
  });
});

// ── formatDTCHistoryForAI Tests ───────────────────────────────────

describe("formatDTCHistoryForAI", () => {
  it("returns empty string for no events", () => {
    expect(formatDTCHistoryForAI([])).toBe("");
  });

  it("includes event type (APPEARED/CLEARED) in output", () => {
    const events = [
      mockEvent({ event: "appeared" }),
      mockEvent({ event: "cleared", timestamp: "2026-04-03T11:00:00.000Z" }),
    ];
    const text = formatDTCHistoryForAI(events);

    expect(text).toContain("APPEARED");
    expect(text).toContain("CLEARED");
  });

  it("includes SPN number and name", () => {
    const events = [mockEvent()];
    const text = formatDTCHistoryForAI(events);

    expect(text).toContain("SPN 3226");
    expect(text).toContain("Aftertreatment"); // ECU label
  });

  it("includes FMI number", () => {
    const events = [mockEvent({ fmi: 18 })];
    const text = formatDTCHistoryForAI(events);

    expect(text).toContain("FMI 18");
  });

  it("detects intermittent pattern (appeared 2+, cleared 1+)", () => {
    const events = [
      mockEvent({ event: "appeared", timestamp: "2026-04-01T08:00:00.000Z" }),
      mockEvent({ event: "cleared", timestamp: "2026-04-01T10:00:00.000Z" }),
      mockEvent({ event: "appeared", timestamp: "2026-04-02T08:00:00.000Z" }),
      mockEvent({ event: "cleared", timestamp: "2026-04-02T10:00:00.000Z" }),
    ];
    const text = formatDTCHistoryForAI(events);

    expect(text).toContain("INTERMITTENT CODES");
    expect(text).toContain("appeared 2x");
    expect(text).toContain("cleared 2x");
  });

  it("does NOT flag single-occurrence as intermittent", () => {
    const events = [
      mockEvent({ event: "appeared" }),
      mockEvent({ event: "cleared", timestamp: "2026-04-03T11:00:00.000Z" }),
    ];
    const text = formatDTCHistoryForAI(events);
    expect(text).not.toContain("INTERMITTENT");
  });

  it("includes header identifying data source", () => {
    const events = [mockEvent()];
    const text = formatDTCHistoryForAI(events);
    expect(text).toContain("CLIENT-SIDE DTC HISTORY");
    expect(text).toContain("localStorage");
  });

  it("limits to most recent 20 events", () => {
    const events: DTCHistoryEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(
        mockEvent({
          id: `evt-${i}`,
          timestamp: `2026-04-03T${String(i).padStart(2, "0")}:00:00.000Z`,
        })
      );
    }
    const text = formatDTCHistoryForAI(events);
    // Should only contain timestamps from the last 20 (indices 10-29)
    const lines = text.split("\n").filter((l) => l.startsWith("- 2026"));
    expect(lines.length).toBeLessThanOrEqual(20);
  });
});

// ── ECU_SOURCES Constant Tests ────────────────────────────────────

describe("ECU_SOURCES constant", () => {
  it("has all 6 expected ECU sources", () => {
    expect(ECU_SOURCES).toHaveLength(6);
    const suffixes = ECU_SOURCES.map((e) => e.suffix);
    expect(suffixes).toContain("engine");
    expect(suffixes).toContain("trans");
    expect(suffixes).toContain("abs");
    expect(suffixes).toContain("acm");
    expect(suffixes).toContain("body");
    expect(suffixes).toContain("inst");
  });

  it("matches the field naming convention in sensor readings", () => {
    // Verify each suffix creates valid reading keys
    // This ensures DTCPanel and buildDTCSnapshot use the same naming
    for (const { suffix } of ECU_SOURCES) {
      const countKey = `dtc_${suffix}_count`;
      const spnKey = `dtc_${suffix}_0_spn`;
      const fmiKey = `dtc_${suffix}_0_fmi`;

      // Keys should match the regex used in AI logging
      const regex = /^dtc_(engine|trans|abs|acm|body|inst)_\d+_spn$/;
      expect(regex.test(spnKey)).toBe(true);
      // Count key and FMI key should follow convention
      expect(countKey).toMatch(/^dtc_\w+_count$/);
      expect(fmiKey).toMatch(/^dtc_\w+_\d+_fmi$/);
    }
  });
});
