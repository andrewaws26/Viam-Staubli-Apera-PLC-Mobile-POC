/**
 * API Schema Validation Tests
 *
 * Tests the Zod schemas in lib/api-schemas.ts that validate API route inputs.
 * These schemas are the single source of truth for what each API endpoint
 * accepts — if a schema rejects valid input or accepts bad input, the
 * corresponding endpoint breaks.
 *
 * WHAT TO ADD:
 * When you add a new API route, add its schema to api-schemas.ts and
 * add validation tests here. At minimum test: valid input, missing
 * required fields, and invalid field types.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/api-schemas.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  AiChatBody,
  AiDiagnoseBody,
  TruckCommandBody,
  PlcCommandBody,
  parseBody,
} from "@/lib/api-schemas";

// ── AI Chat Body ──────────────────────────────────────────────────

describe("AiChatBody schema", () => {
  it("accepts valid chat body", () => {
    const result = parseBody(AiChatBody, {
      messages: [{ role: "user", content: "What's wrong with the truck?" }],
      readings: { engine_rpm: 1200, coolant_temp_f: 195 },
    });
    expect(result.error).toBeUndefined();
    expect(result.data!.messages).toHaveLength(1);
  });

  it("accepts body without readings (defaults to {})", () => {
    const result = parseBody(AiChatBody, {
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.error).toBeUndefined();
    expect(result.data!.readings).toEqual({});
  });

  it("rejects missing messages", () => {
    const result = parseBody(AiChatBody, { readings: {} });
    expect(result.error).toBeDefined();
    expect(result.error!.details.some((d: string) => d.includes("messages"))).toBe(true);
  });

  it("rejects empty messages array", () => {
    const result = parseBody(AiChatBody, { messages: [] });
    expect(result.error).toBeDefined();
  });

  it("rejects invalid role", () => {
    const result = parseBody(AiChatBody, {
      messages: [{ role: "system", content: "hack" }],
    });
    expect(result.error).toBeDefined();
  });

  it("rejects empty content", () => {
    const result = parseBody(AiChatBody, {
      messages: [{ role: "user", content: "" }],
    });
    expect(result.error).toBeDefined();
  });

  it("accepts multi-turn conversation", () => {
    const result = parseBody(AiChatBody, {
      messages: [
        { role: "user", content: "Check coolant temp" },
        { role: "assistant", content: "Coolant is 195°F" },
        { role: "user", content: "Is that normal?" },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.data!.messages).toHaveLength(3);
  });
});

// ── AI Diagnose Body ──────────────────────────────────────────────

describe("AiDiagnoseBody schema", () => {
  it("accepts valid diagnose body", () => {
    const result = parseBody(AiDiagnoseBody, {
      readings: { engine_rpm: 800, active_dtc_count: 2 },
    });
    expect(result.error).toBeUndefined();
  });

  it("rejects missing readings", () => {
    const result = parseBody(AiDiagnoseBody, {});
    expect(result.error).toBeDefined();
  });

  it("accepts readings with any key-value pairs", () => {
    const result = parseBody(AiDiagnoseBody, {
      readings: {
        engine_rpm: 1200,
        _protocol: "j1939",
        dtc_acm_0_spn: 3226,
        custom_flag: true,
        nested: { a: 1 },
      },
    });
    expect(result.error).toBeUndefined();
  });
});

// ── Truck Command Body ────────────────────────────────────────────

describe("TruckCommandBody schema", () => {
  it("accepts clear_dtcs command", () => {
    const result = parseBody(TruckCommandBody, { command: "clear_dtcs" });
    expect(result.error).toBeUndefined();
    expect(result.data!.command).toBe("clear_dtcs");
  });

  it("accepts request_pgn with pgn parameter", () => {
    const result = parseBody(TruckCommandBody, {
      command: "request_pgn",
      pgn: 65262,
    });
    expect(result.error).toBeUndefined();
    expect(result.data!.pgn).toBe(65262);
  });

  it("rejects unknown command", () => {
    const result = parseBody(TruckCommandBody, { command: "destroy_everything" });
    expect(result.error).toBeDefined();
  });

  it("rejects missing command", () => {
    const result = parseBody(TruckCommandBody, {});
    expect(result.error).toBeDefined();
  });

  it("rejects pgn outside valid range", () => {
    const result = parseBody(TruckCommandBody, {
      command: "request_pgn",
      pgn: -1,
    });
    expect(result.error).toBeDefined();
  });

  it("accepts get_bus_stats command", () => {
    const result = parseBody(TruckCommandBody, { command: "get_bus_stats" });
    expect(result.error).toBeUndefined();
  });
});

// ── PLC Command Body ──────────────────────────────────────────────

describe("PlcCommandBody schema", () => {
  it("accepts test_eject with output", () => {
    const result = parseBody(PlcCommandBody, {
      action: "test_eject",
      output: "Y1",
    });
    expect(result.error).toBeUndefined();
    expect(result.data!.action).toBe("test_eject");
    expect(result.data!.output).toBe("Y1");
  });

  it("accepts set_spacing with inches", () => {
    const result = parseBody(PlcCommandBody, {
      action: "set_spacing",
      inches: 19.5,
    });
    expect(result.error).toBeUndefined();
  });

  it("rejects unknown action", () => {
    const result = parseBody(PlcCommandBody, { action: "format_disk" });
    expect(result.error).toBeDefined();
  });

  it("rejects missing action", () => {
    const result = parseBody(PlcCommandBody, { output: "Y1" });
    expect(result.error).toBeDefined();
  });
});

// ── parseBody Helper ──────────────────────────────────────────────

describe("parseBody helper", () => {
  it("returns data on success", () => {
    const result = parseBody(AiDiagnoseBody, { readings: {} });
    expect(result.data).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it("returns error with details on failure", () => {
    const result = parseBody(AiDiagnoseBody, { bad: true });
    expect(result.error).toBeDefined();
    expect(result.error!.error).toBe("Validation failed");
    expect(Array.isArray(result.error!.details)).toBe(true);
    expect(result.error!.details.length).toBeGreaterThan(0);
  });

  it("handles null input", () => {
    const result = parseBody(AiChatBody, null);
    expect(result.error).toBeDefined();
  });

  it("handles undefined input", () => {
    const result = parseBody(AiChatBody, undefined);
    expect(result.error).toBeDefined();
  });
});
