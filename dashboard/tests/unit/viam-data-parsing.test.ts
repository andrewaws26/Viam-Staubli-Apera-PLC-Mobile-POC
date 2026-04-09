/**
 * Viam Data Parsing Tests
 *
 * Tests the payload unwrapping and timestamp normalization that every
 * data-dependent feature relies on. A bug here breaks shift reports,
 * snapshots, live dashboard, and AI diagnostics simultaneously.
 */

import { describe, it, expect } from "vitest";
import { unwrapPayload, normalizeTimestamp } from "@/lib/viam-data";

// ── unwrapPayload ──────────────────────────────────────────────────

describe("unwrapPayload", () => {
  it("unwraps standard Viam nesting (payload.readings)", () => {
    const payload = {
      readings: {
        engine_rpm: 1200,
        coolant_temp_f: 195,
        _protocol: "j1939",
      },
    };

    const result = unwrapPayload(payload);
    expect(result.engine_rpm).toBe(1200);
    expect(result.coolant_temp_f).toBe(195);
    expect(result._protocol).toBe("j1939");
  });

  it("falls back to raw payload when no readings key", () => {
    const payload = { engine_rpm: 1200, vehicle_speed_mph: 55 };
    const result = unwrapPayload(payload);
    expect(result.engine_rpm).toBe(1200);
    expect(result.vehicle_speed_mph).toBe(55);
  });

  it("handles null payload", () => {
    const result = unwrapPayload(null);
    expect(result).toEqual({});
  });

  it("handles undefined payload", () => {
    const result = unwrapPayload(undefined);
    expect(result).toEqual({});
  });

  it("handles string payload (edge case)", () => {
    const result = unwrapPayload("not an object");
    expect(result).toEqual({});
  });

  it("handles empty object", () => {
    const result = unwrapPayload({});
    expect(result).toEqual({});
  });

  it("handles deeply nested readings", () => {
    const payload = {
      readings: {
        active_dtc_count: 2,
        dtc_0_spn: 520,
        dtc_0_fmi: 4,
        gps_latitude: 38.0406,
        gps_longitude: -84.5037,
      },
    };

    const result = unwrapPayload(payload);
    expect(result.active_dtc_count).toBe(2);
    expect(result.dtc_0_spn).toBe(520);
    expect(result.gps_latitude).toBe(38.0406);
  });

  it("prefers readings over top-level keys", () => {
    const payload = {
      engine_rpm: 0, // top-level (stale)
      readings: { engine_rpm: 1200 }, // nested (current)
    };

    const result = unwrapPayload(payload);
    expect(result.engine_rpm).toBe(1200);
  });

  it("handles readings: null gracefully", () => {
    const payload = { readings: null };
    const result = unwrapPayload(payload);
    // Should fall back to the raw payload (which has readings: null)
    expect(result).toBeDefined();
  });
});

// ── normalizeTimestamp ─────────────────────────────────────────────

describe("normalizeTimestamp", () => {
  it("passes Date objects through", () => {
    const d = new Date("2026-04-08T15:30:00Z");
    const result = normalizeTimestamp(d);
    expect(result).toBe(d); // same reference
    expect(result.toISOString()).toBe("2026-04-08T15:30:00.000Z");
  });

  it("converts ISO string to Date", () => {
    const result = normalizeTimestamp("2026-04-08T15:30:00Z");
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe("2026-04-08T15:30:00.000Z");
  });

  it("converts epoch-style string to Date", () => {
    const result = normalizeTimestamp("1780000000000");
    expect(result).toBeInstanceOf(Date);
  });

  it("handles Viam SDK date format", () => {
    // Viam sometimes returns dates as strings with microseconds
    const result = normalizeTimestamp("2026-04-08T15:30:00.123456Z");
    expect(result).toBeInstanceOf(Date);
    expect(result.getFullYear()).toBe(2026);
  });
});
